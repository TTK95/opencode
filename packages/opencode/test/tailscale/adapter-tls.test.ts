import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Hono } from "hono"
import { adapter } from "../../src/server/adapter.bun"

/**
 * Verifies that the Bun adapter's new `tls` passthrough actually produces
 * an HTTPS listener. We only need a smoke test — Bun's TLS itself is not
 * our responsibility — but this covers the wiring change on this branch.
 */

let tmpDir: string
let certPem: string
let keyPem: string

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "opencode-tls-"))
  const keyPath = path.join(tmpDir, "key.pem")
  const certPath = path.join(tmpDir, "cert.pem")
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-nodes",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "pipe" },
  )
  if (result.status !== 0) {
    throw new Error(`openssl failed: ${result.stderr.toString()}`)
  }
  certPem = readFileSync(certPath, "utf8")
  keyPem = readFileSync(keyPath, "utf8")
})

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
})

describe("adapter TLS passthrough (bun)", () => {
  it("listens over HTTPS when `tls` is provided", async () => {
    const app = new Hono().get("/hello", (c) => c.text("hi"))
    const runtime = adapter.create(app)
    const listener = await runtime.listen({
      port: 0,
      hostname: "127.0.0.1",
      tls: { cert: certPem, key: keyPem },
    })

    try {
      const res = await fetch(`https://127.0.0.1:${listener.port}/hello`, {
        // Bun fetch accepts a custom TLS config for tests; the server is self-signed.
        tls: { rejectUnauthorized: false },
      } as RequestInit & { tls?: unknown })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe("hi")
    } finally {
      await listener.stop(true)
    }
  })

  it("still listens over plain HTTP when `tls` is omitted", async () => {
    const app = new Hono().get("/hello", (c) => c.text("bye"))
    const runtime = adapter.create(app)
    const listener = await runtime.listen({ port: 0, hostname: "127.0.0.1" })
    try {
      const res = await fetch(`http://127.0.0.1:${listener.port}/hello`)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe("bye")
    } finally {
      await listener.stop(true)
    }
  })
})
