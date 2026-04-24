/**
 * Thin wrapper around the `tailscaled` local API. Used by `opencode tailscale`
 * to discover the device's MagicDNS name + tailnet domain without forcing the
 * user to copy/paste it from `tailscale status`.
 *
 * On Linux/macOS the daemon listens on a Unix socket (root-owned by default,
 * but readable by members of the `tailscale` group on most distros). When the
 * socket isn't reachable — non-root users, sandboxed installs, or Windows —
 * we fall back to parsing `tailscale status --json` from the CLI.
 *
 * We keep the shape small on purpose: only the fields we use are typed.
 */
import { spawn } from "node:child_process"

export type TailscaleSelf = {
  /** Fully-qualified MagicDNS name, e.g. `pine-laptop.mycorp.ts.net.` (trailing dot per DNS). */
  DNSName: string
  /** Comma-separated tailnet IPv4/IPv6 addresses for this node. */
  TailscaleIPs: string[]
  HostName?: string
  /** Login email of the user this node is signed in as. */
  UserID?: number
}

export type TailscaleStatus = {
  /** Tailnet domain part, e.g. `mycorp.ts.net`. */
  MagicDNSSuffix: string
  /** True when the daemon is up and the node is signed in. */
  BackendState: string
  Self: TailscaleSelf
  /** Logged-in user record, keyed by UserID. */
  User?: Record<string, { LoginName: string; DisplayName: string }>
  /** Number of currently-online peers. */
  Peer?: Record<string, { Online: boolean }>
}

const SOCKET_PATH = (() => {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\ProtectedPrefix\\Administrators\\Tailscale\\tailscaled"
  }
  if (process.platform === "darwin") {
    // Sandboxed Mac App Store install puts the socket inside a per-user dir.
    // The CLI binary handles the discovery; we just default to the standalone
    // path and fall back to the CLI on failure.
    return "/var/run/tailscaled.socket"
  }
  return "/var/run/tailscale/tailscaled.sock"
})()

export type ClientOptions = {
  /** Override the socket path (mainly for tests). */
  socketPath?: string
  /** Override the CLI binary name (mainly for tests). */
  cliBinary?: string
}

export class TailscaleNotInstalledError extends Error {
  readonly code = "TAILSCALE_NOT_INSTALLED"
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "TailscaleNotInstalledError"
  }
}

export class TailscaleNotRunningError extends Error {
  readonly code = "TAILSCALE_NOT_RUNNING"
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "TailscaleNotRunningError"
  }
}

export class TailscaleClient {
  private socketPath: string
  private cliBinary: string

  constructor(opts: ClientOptions = {}) {
    this.socketPath = opts.socketPath ?? SOCKET_PATH
    this.cliBinary = opts.cliBinary ?? "tailscale"
  }

  async status(): Promise<TailscaleStatus> {
    const raw = await this.fetchJson("/localapi/v0/status").catch(async (err) => {
      // The local API rejects anything except a few tailnet-specific Host
      // headers; on Bun the unix-socket fetch may also fail with EPERM for
      // non-root users. Fall back to the CLI in either case.
      try {
        return await this.statusViaCli()
      } catch (cliErr) {
        if (cliErr instanceof TailscaleNotInstalledError) throw cliErr
        // Surface the original socket error if the CLI also fails so the user
        // sees the underlying reason.
        throw err
      }
    })
    return parseStatus(raw)
  }

  async whois(addr: string): Promise<{ login: string; node: string } | null> {
    const raw = await this.fetchJson(`/localapi/v0/whois?addr=${encodeURIComponent(addr)}`).catch(() => null)
    if (!raw || typeof raw !== "object") return null
    const userProfile = (raw as any).UserProfile
    const node = (raw as any).Node
    const login = userProfile?.LoginName
    const name = node?.ComputedName ?? node?.Name
    if (typeof login !== "string" || typeof name !== "string") return null
    return { login, node: name }
  }

  private async fetchJson(path: string): Promise<unknown> {
    // Bun supports `unix:` as a fetch option; Node's global fetch (undici) does
    // not, so on Node we fall back to the CLI. Hostname is required by the
    // local API but the daemon doesn't actually validate it.
    const url = `http://local-tailscaled.sock${path}`
    const init: RequestInit & { unix?: string } = { unix: this.socketPath }
    let res: Response
    try {
      res = await fetch(url, init as RequestInit)
    } catch (err) {
      throw new TailscaleNotRunningError(`failed to reach tailscaled at ${this.socketPath}`, { cause: err })
    }
    if (!res.ok) {
      throw new TailscaleNotRunningError(`tailscaled returned HTTP ${res.status} for ${path}`)
    }
    return res.json()
  }

  private async statusViaCli(): Promise<unknown> {
    const stdout = await runCommand(this.cliBinary, ["status", "--json"])
    return JSON.parse(stdout)
  }
}

/**
 * Parse the ipnstate.Status JSON into the subset we care about. The wire
 * format uses Go-style PascalCase keys; we keep them as-is so `JSON.parse`
 * → object lands in our typed shape directly.
 */
export function parseStatus(raw: unknown): TailscaleStatus {
  if (!raw || typeof raw !== "object") throw new Error("invalid tailscaled status response")
  const obj = raw as any
  const backendState = typeof obj.BackendState === "string" ? obj.BackendState : "Unknown"
  if (backendState === "NeedsLogin" || backendState === "NoState") {
    throw new TailscaleNotRunningError(
      "Tailscale is installed but this device isn't signed in. Run `tailscale up`.",
    )
  }
  if (backendState === "Stopped") {
    throw new TailscaleNotRunningError("Tailscale is stopped. Run `tailscale up` to bring it online.")
  }
  const self = obj.Self
  if (!self || typeof self !== "object") throw new Error("tailscaled status missing Self")
  const dnsName = typeof self.DNSName === "string" ? self.DNSName : ""
  if (!dnsName) {
    throw new TailscaleNotRunningError(
      "Tailscale is installed but this device has no MagicDNS name. Check `tailscale status`.",
    )
  }
  const magicSuffix =
    typeof obj.MagicDNSSuffix === "string"
      ? obj.MagicDNSSuffix
      : // Fall back to deriving the suffix from the FQDN. DNSName is `host.suffix.`
        dnsName.replace(/\.$/, "").split(".").slice(1).join(".")
  return {
    MagicDNSSuffix: magicSuffix,
    BackendState: backendState,
    Self: {
      DNSName: dnsName,
      TailscaleIPs: Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.filter((ip: unknown) => typeof ip === "string") : [],
      HostName: typeof self.HostName === "string" ? self.HostName : undefined,
      UserID: typeof self.UserID === "number" ? self.UserID : undefined,
    },
    User: typeof obj.User === "object" && obj.User !== null ? obj.User : undefined,
    Peer: typeof obj.Peer === "object" && obj.Peer !== null ? obj.Peer : undefined,
  }
}

export function shortDNSName(status: TailscaleStatus): string {
  return status.Self.DNSName.replace(/\.$/, "")
}

export function loginEmail(status: TailscaleStatus): string | undefined {
  if (status.Self.UserID == null || !status.User) return undefined
  return status.User[String(status.Self.UserID)]?.LoginName
}

export function onlinePeerCount(status: TailscaleStatus): number {
  if (!status.Peer) return 0
  return Object.values(status.Peer).filter((p) => p.Online).length
}

export async function runCommand(bin: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()))
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()))
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new TailscaleNotInstalledError(
            `'${bin}' not found on PATH. Install Tailscale: https://tailscale.com/download`,
            { cause: err },
          ),
        )
        return
      }
      reject(err)
    })
    child.on("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${bin} ${args.join(" ")} exited ${code}: ${stderr.trim()}`))
    })
  })
}
