import { spawn } from "node:child_process"

import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "container.docker" })

export type RunArgs = {
  name: string
  image: string
  workdir: string
  mount: { source: string; target: string }
  network: string
  memory?: string
  cpus?: string
  pids?: number
  runAsCurrentUser: boolean
  labels: Record<string, string>
}

function run(cmd: string, args: string[], opts: { input?: string; timeoutMs?: number } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d) => (stdout += d.toString()))
    proc.stderr.on("data", (d) => (stderr += d.toString()))
    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs) {
      timer = setTimeout(() => proc.kill("SIGKILL"), opts.timeoutMs)
    }
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    proc.on("error", (err) => {
      if (timer) clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: stderr + String(err) })
    })
    if (opts.input !== undefined) {
      proc.stdin.end(opts.input)
    } else {
      proc.stdin.end()
    }
  })
}

export async function available(): Promise<boolean> {
  const res = await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeoutMs: 5000 })
  if (res.code !== 0) {
    log.warn("docker unavailable", { stderr: res.stderr.trim().slice(0, 200) })
    return false
  }
  return true
}

export async function ensureImage(image: string): Promise<void> {
  const inspect = await run("docker", ["image", "inspect", image])
  if (inspect.code === 0) return
  log.info("pulling image", { image })
  const pull = await run("docker", ["pull", image], { timeoutMs: 10 * 60 * 1000 })
  if (pull.code !== 0) {
    throw new Error(`Failed to pull docker image ${image}: ${pull.stderr.trim() || pull.stdout.trim()}`)
  }
}

function labelArgs(labels: Record<string, string>) {
  return Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`])
}

export async function runBackground(args: RunArgs): Promise<string> {
  const userArgs: string[] = []
  if (args.runAsCurrentUser && process.platform !== "win32") {
    userArgs.push("--user", `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`)
  }

  const extra: string[] = []
  if (args.memory) extra.push("--memory", args.memory)
  if (args.cpus) extra.push("--cpus", args.cpus)
  if (args.pids && args.pids > 0) extra.push("--pids-limit", String(args.pids))

  const cli = [
    "run",
    "-d",
    "--rm",
    "--name",
    args.name,
    "--workdir",
    args.workdir,
    "--network",
    args.network,
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    "-v",
    `${args.mount.source}:${args.mount.target}`,
    ...userArgs,
    ...extra,
    ...labelArgs(args.labels),
    "--entrypoint",
    "sh",
    args.image,
    "-c",
    "sleep infinity",
  ]

  const res = await run("docker", cli)
  if (res.code !== 0) {
    throw new Error(`Failed to start container: ${res.stderr.trim() || res.stdout.trim()}`)
  }
  return res.stdout.trim()
}

export async function remove(containerID: string): Promise<void> {
  const res = await run("docker", ["rm", "-f", containerID], { timeoutMs: 30_000 })
  if (res.code !== 0) {
    log.warn("container remove failed", {
      containerID: containerID.slice(0, 12),
      stderr: res.stderr.trim().slice(0, 200),
    })
  }
}

export async function sweepStale(label: string): Promise<number> {
  const ls = await run("docker", ["ps", "-aq", "--filter", `label=${label}`])
  if (ls.code !== 0) return 0
  const ids = ls.stdout.split("\n").map((x) => x.trim()).filter(Boolean)
  if (ids.length === 0) return 0
  const rm = await run("docker", ["rm", "-f", ...ids])
  if (rm.code !== 0) {
    log.warn("sweep rm failed", { stderr: rm.stderr.trim().slice(0, 200) })
    return 0
  }
  return ids.length
}
