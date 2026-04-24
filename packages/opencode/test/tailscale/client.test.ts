import { describe, expect, it } from "bun:test"
import {
  loginEmail,
  onlinePeerCount,
  parseStatus,
  shortDNSName,
  TailscaleClient,
  TailscaleNotInstalledError,
  TailscaleNotRunningError,
} from "../../src/tailscale/client"

const SAMPLE_STATUS = {
  BackendState: "Running",
  MagicDNSSuffix: "mycorp.ts.net",
  Self: {
    DNSName: "pine-laptop.mycorp.ts.net.",
    TailscaleIPs: ["100.64.0.1", "fd7a:115c:a1e0::1"],
    HostName: "pine-laptop",
    UserID: 4242,
  },
  User: {
    "4242": { LoginName: "alex@mycorp.com", DisplayName: "Alex" },
  },
  Peer: {
    "node-a": { Online: true },
    "node-b": { Online: false },
    "node-c": { Online: true },
  },
}

describe("parseStatus", () => {
  it("extracts the expected fields from a real-shaped payload", () => {
    const status = parseStatus(SAMPLE_STATUS)
    expect(status.MagicDNSSuffix).toBe("mycorp.ts.net")
    expect(status.Self.DNSName).toBe("pine-laptop.mycorp.ts.net.")
    expect(status.Self.TailscaleIPs).toEqual(["100.64.0.1", "fd7a:115c:a1e0::1"])
    expect(status.BackendState).toBe("Running")
  })

  it("derives MagicDNSSuffix from the FQDN when missing", () => {
    const { MagicDNSSuffix: _drop, ...withoutSuffix } = SAMPLE_STATUS
    const status = parseStatus(withoutSuffix)
    expect(status.MagicDNSSuffix).toBe("mycorp.ts.net")
  })

  it("throws when the device isn't signed in (BackendState=NeedsLogin)", () => {
    const unsigned = { ...SAMPLE_STATUS, BackendState: "NeedsLogin" }
    expect(() => parseStatus(unsigned)).toThrow(TailscaleNotRunningError)
  })

  it("throws a different message when tailscaled is stopped", () => {
    const stopped = { ...SAMPLE_STATUS, BackendState: "Stopped" }
    expect(() => parseStatus(stopped)).toThrow(/stopped/)
  })

  it("throws when BackendState is Running but DNSName is missing", () => {
    const blank = { ...SAMPLE_STATUS, Self: { ...SAMPLE_STATUS.Self, DNSName: "" } }
    expect(() => parseStatus(blank)).toThrow(TailscaleNotRunningError)
  })

  it("rejects garbage payloads", () => {
    expect(() => parseStatus(null)).toThrow()
    expect(() => parseStatus({ Self: null })).toThrow()
  })
})

describe("status helpers", () => {
  const status = parseStatus(SAMPLE_STATUS)
  it("strips the trailing dot from DNSName", () => {
    expect(shortDNSName(status)).toBe("pine-laptop.mycorp.ts.net")
  })
  it("looks up the login email by UserID", () => {
    expect(loginEmail(status)).toBe("alex@mycorp.com")
  })
  it("counts only online peers", () => {
    expect(onlinePeerCount(status)).toBe(2)
  })
})

describe("TailscaleClient with bogus socket", () => {
  it("surfaces TailscaleNotInstalledError when the CLI fallback can't find the binary", async () => {
    const client = new TailscaleClient({
      socketPath: "/nonexistent/path.sock",
      cliBinary: "definitely-not-tailscale-aaaa",
    })
    await expect(client.status()).rejects.toBeInstanceOf(TailscaleNotInstalledError)
  })
})
