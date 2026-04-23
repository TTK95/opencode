import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import {
  loginEmail,
  onlinePeerCount,
  shortDNSName,
  TailscaleClient,
  TailscaleNotInstalledError,
  TailscaleNotRunningError,
} from "../../tailscale/client"
import { tailscaleCert } from "../../tailscale/cert"

const DEFAULT_PORT = 4096

export const TailscaleCommand = cmd({
  command: "tailscale",
  describe: "serve opencode over your tailnet — open the printed URL on any tailnet device",
  builder: (yargs) =>
    yargs
      .option("port", {
        type: "number",
        describe: "port to listen on",
        default: DEFAULT_PORT,
      })
      .option("hostname", {
        type: "string",
        describe: "hostname to bind (default 0.0.0.0 so tailnet peers can reach it)",
        default: "0.0.0.0",
      })
      .option("tls", {
        type: "boolean",
        describe: "fetch a Tailscale-issued cert and listen over HTTPS",
        default: false,
      })
      .option("cors", {
        type: "string",
        array: true,
        describe: "additional domains to allow for CORS",
        default: [] as string[],
      }),
  handler: async (args) => {
    const client = new TailscaleClient()

    let status
    try {
      status = await client.status()
    } catch (err) {
      printTailscaleSetupError(err)
      process.exit(1)
    }

    const host = shortDNSName(status)
    const tailnet = status.MagicDNSSuffix
    const email = loginEmail(status)
    const peers = onlinePeerCount(status)

    let tls
    if (args.tls) {
      try {
        const issued = await tailscaleCert({ host })
        tls = { cert: issued.cert, key: issued.key }
      } catch (err) {
        UI.println(UI.Style.TEXT_DANGER_BOLD + "  failed to obtain TLS cert: " + (err as Error).message)
        process.exit(1)
      }
    }

    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      UI.println(
        UI.Style.TEXT_DIM +
          "  Note: OPENCODE_SERVER_PASSWORD is not set. Anyone on this tailnet who knows the URL can control the session.",
      )
    }

    const server = await Server.listen({
      port: args.port,
      hostname: args.hostname,
      cors: args.cors as string[],
      tls,
    })

    const scheme = tls ? "https" : "http"
    const url = `${scheme}://${host}:${server.port}/ui/`

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Tailnet:    ", UI.Style.TEXT_NORMAL, tailnet)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Device:     ", UI.Style.TEXT_NORMAL, host)
    if (email) UI.println(UI.Style.TEXT_INFO_BOLD + "  Signed in:  ", UI.Style.TEXT_NORMAL, email)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Open on any tailnet device:")
    UI.println("    " + UI.Style.TEXT_HIGHLIGHT_BOLD + url)
    UI.empty()
    if (peers > 0) {
      UI.println(UI.Style.TEXT_DIM + `  ${peers} other tailnet device${peers === 1 ? "" : "s"} can reach this.`)
    }
    UI.println(UI.Style.TEXT_DIM + "  Press Ctrl+C to stop.")
    UI.empty()

    let stopping: Promise<void> | undefined
    const shutdown = () => {
      if (stopping) return
      stopping = server.stop(true)
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (stopping) {
          clearInterval(interval)
          resolve()
        }
      }, 250)
    })
    if (stopping) await stopping
  },
})

function printTailscaleSetupError(err: unknown): void {
  if (err instanceof TailscaleNotInstalledError) {
    UI.println(UI.Style.TEXT_DANGER_BOLD + "  Tailscale isn't installed.")
    UI.println(UI.Style.TEXT_NORMAL + "  Install it from https://tailscale.com/download and run `tailscale up`.")
    return
  }
  if (err instanceof TailscaleNotRunningError) {
    UI.println(UI.Style.TEXT_DANGER_BOLD + "  " + err.message)
    UI.println(UI.Style.TEXT_NORMAL + "  Try `sudo tailscale up`, or `tailscale switch` if you're between accounts.")
    return
  }
  UI.println(UI.Style.TEXT_DANGER_BOLD + "  Failed to query Tailscale: " + (err as Error).message)
}
