/**
 * Wraps `tailscale cert` to obtain a Let's Encrypt cert/key pair for a
 * MagicDNS hostname. Tailscale renews the underlying certs automatically
 * and the CLI is idempotent, so we just shell out and read the resulting
 * files.
 *
 * Caches the most recent cert under `~/.opencode/data/tls/<host>/` so
 * repeat starts of `opencode tailscale --tls` don't have to re-issue.
 */
import { mkdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Global } from "../global"
import { runCommand, TailscaleNotInstalledError } from "./client"

export type TailscaleCert = {
  cert: string
  key: string
  certPath: string
  keyPath: string
}

/** Tailscale-issued certs are valid for 90 days; renew when ≤ 14 days remain. */
const RENEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export type TailscaleCertOptions = {
  /** Host whose cert we want, e.g. `pine-laptop.mycorp.ts.net`. */
  host: string
  /** Override the CLI binary name (mainly for tests). */
  cliBinary?: string
}

export async function tailscaleCert(opts: TailscaleCertOptions): Promise<TailscaleCert> {
  const dir = path.join(Global.Path.data, "tls", opts.host)
  const certPath = path.join(dir, "cert.crt")
  const keyPath = path.join(dir, "key.key")

  const existing = await readIfFresh(certPath, keyPath)
  if (existing) return { ...existing, certPath, keyPath }

  await mkdir(dir, { recursive: true })

  // `tailscale cert` writes to the working directory by default; the
  // `--cert-file` / `--key-file` flags target absolute paths instead.
  await runCommand(opts.cliBinary ?? "tailscale", [
    "cert",
    "--cert-file",
    certPath,
    "--key-file",
    keyPath,
    opts.host,
  ]).catch((err) => {
    if (err instanceof TailscaleNotInstalledError) throw err
    throw new Error(
      `tailscale cert failed for ${opts.host}: ${err instanceof Error ? err.message : String(err)}\n` +
        `Make sure HTTPS certs are enabled for your tailnet (Admin → DNS → HTTPS Certificates).`,
    )
  })

  const [cert, key] = await Promise.all([readFile(certPath, "utf8"), readFile(keyPath, "utf8")])
  return { cert, key, certPath, keyPath }
}

async function readIfFresh(certPath: string, keyPath: string): Promise<{ cert: string; key: string } | undefined> {
  try {
    const info = await stat(certPath)
    // Use mtime as a cheap freshness proxy. We could parse the cert's NotAfter
    // for accuracy, but the CLI is idempotent so over-renewing is harmless.
    if (Date.now() - info.mtime.getTime() > 90 * 24 * 60 * 60 * 1000 - RENEW_WINDOW_MS) return undefined
    const [cert, key] = await Promise.all([readFile(certPath, "utf8"), readFile(keyPath, "utf8")])
    if (!cert || !key) return undefined
    return { cert, key }
  } catch {
    return undefined
  }
}

