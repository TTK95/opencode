import type { Argv } from "yargs"
import path from "path"

import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"
import { Container } from "../../container"

const BASE = path.join(Global.Path.data, "container")

const StatusCommand = cmd({
  command: "status",
  describe: "show running opencode sandbox containers",
  handler: async () => {
    const { spawnSync } = await import("child_process")
    const res = spawnSync(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        `label=${Container.SESSION_LABEL}`,
        "--format",
        "{{.ID}}\t{{.Status}}\t{{.Names}}\t{{.Image}}",
      ],
      { encoding: "utf-8" },
    )
    if (res.status !== 0) {
      UI.error(res.stderr || "docker ps failed")
      process.exit(1)
    }
    const lines = res.stdout.trim()
    if (!lines) {
      UI.println("no opencode containers")
      return
    }
    UI.println(lines)
  },
})

const PruneCommand = cmd({
  command: "prune",
  describe: "remove stale opencode sandbox containers",
  handler: async () => {
    const removed = await Container.Docker.sweepStale(Container.SESSION_LABEL)
    UI.println(`removed ${removed} container(s)`)
  },
})

const ExportCommand = cmd({
  command: "export <sessionID>",
  describe: "diff or apply changes from a copy-mode sandbox workspace back to a host directory",
  builder: (yargs: Argv) =>
    yargs
      .positional("sessionID", {
        type: "string",
        describe: "session id of the sandbox (folder name under .local/share/opencode/container)",
      })
      .option("source", {
        type: "string",
        describe: "host source directory to compare against (defaults to current directory)",
      })
      .option("apply", {
        type: "boolean",
        default: false,
        describe: "apply the diff back to the source directory",
      })
      .option("exclude", {
        type: "string",
        array: true,
        describe: "patterns to exclude from comparison (relative paths or basenames)",
      }),
  handler: async (args) => {
    const sessionID = args.sessionID as string
    if (!sessionID) {
      UI.error("sessionID is required")
      process.exit(1)
    }
    const target = path.join(BASE, sessionID, "workspace")
    const source = args.source ? path.resolve(process.cwd(), args.source as string) : process.cwd()

    const entries = await Container.Copy.diff(source, target, (args.exclude as string[] | undefined) ?? [])
    if (entries.length === 0) {
      UI.println("no changes")
      return
    }

    for (const entry of entries) {
      const icon = entry.status === "added" ? "+" : entry.status === "removed" ? "-" : "~"
      UI.println(`${icon} ${entry.path}`)
    }

    if (!args.apply) {
      UI.println("")
      UI.println(`(${entries.length} change(s). Re-run with --apply to write them back to ${source}.)`)
      return
    }

    await Container.Copy.apply(target, source, entries)
    UI.println(`applied ${entries.length} change(s) to ${source}`)
  },
})

export const ContainerCommand = cmd({
  command: "container <command>",
  describe: "manage opencode Docker sandboxes",
  builder: (yargs: Argv) =>
    yargs
      .command(StatusCommand)
      .command(PruneCommand)
      .command(ExportCommand)
      .demandCommand(1),
  handler: () => {},
})
