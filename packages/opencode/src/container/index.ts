import path from "path"
import fs from "fs/promises"
import { ChildProcess } from "effect/unstable/process"
import type { SpawnOptions } from "child_process"

import { Global } from "../global"
import { Log } from "../util"
import * as DockerNs from "./docker"
import * as CopyNs from "./copy"

export namespace Container {
  export const Docker = DockerNs
  export const Copy = CopyNs
  export type Mode = "off" | "mount" | "copy"

  export const SESSION_LABEL = "opencode.session"
  export const WORKSPACE_TARGET = "/workspace"
  const PS_NAMES = new Set(["powershell", "pwsh"])

  export type Config = {
    mode: Mode
    image: string
    network: "none" | "bridge" | "host"
    memory?: string
    cpus?: string
    pids?: number
    runAsCurrentUser: boolean
    exclude: string[]
  }

  export const DEFAULTS: Config = {
    mode: "off",
    image: "node:22-alpine",
    network: "none",
    memory: "2g",
    cpus: "2",
    pids: 256,
    runAsCurrentUser: true,
    exclude: [],
  }

  export type SpawnArgs = {
    file: string
    args: string[]
    opts: { shell?: string | boolean; cwd?: string; env: NodeJS.ProcessEnv; detached: boolean }
  }

  export interface Runtime {
    readonly mode: Mode
    readonly containerID: string | null
    readonly hostWorkdir: string
    readonly originalHostDir: string
    readonly copyTempDir: string | null
    readonly config: Config
    spawnArgs(shell: string, name: string, command: string, cwd: string, env: NodeJS.ProcessEnv): SpawnArgs
    destroy(): Promise<void>
  }

  export function merge(base: Config, patch: Partial<Config> | undefined): Config {
    if (!patch) return { ...base }
    return { ...base, ...patch }
  }

  const log = Log.create({ service: "container" })

  function mapContainerPath(hostWorkdir: string, hostCwd: string): string {
    const norm = path.resolve(hostCwd)
    if (norm === hostWorkdir) return WORKSPACE_TARGET
    const rel = path.relative(hostWorkdir, norm)
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      log.warn("cwd outside container workspace; falling back to workspace root", { hostCwd, hostWorkdir })
      return WORKSPACE_TARGET
    }
    const posixRel = rel.split(path.sep).join("/")
    return `${WORKSPACE_TARGET}/${posixRel}`
  }

  const ENV_SKIP = new Set(["PWD", "OLDPWD", "HOME", "SHELL", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME"])

  function envArgs(env: NodeJS.ProcessEnv): string[] {
    const out: string[] = []
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) continue
      if (ENV_SKIP.has(k)) continue
      if (k.startsWith("BASH_") || k.startsWith("ZSH_")) continue
      out.push("-e", `${k}=${v}`)
    }
    return out
  }

  function localSpawnArgs(
    shell: string,
    name: string,
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): SpawnArgs {
    if (process.platform === "win32" && PS_NAMES.has(name)) {
      return {
        file: shell,
        args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
        opts: { cwd, env, detached: false },
      }
    }
    return {
      file: command,
      args: [],
      opts: { shell, cwd, env, detached: process.platform !== "win32" },
    }
  }

  function makeLocal(hostDir: string, config: Config): Runtime {
    return {
      mode: "off",
      containerID: null,
      hostWorkdir: hostDir,
      originalHostDir: hostDir,
      copyTempDir: null,
      config,
      spawnArgs: localSpawnArgs,
      async destroy() {},
    }
  }

  function makeDocker(opts: {
    mode: "mount" | "copy"
    containerID: string
    hostWorkdir: string
    originalHostDir: string
    copyTempDir: string | null
    config: Config
  }): Runtime {
    const { mode, containerID, hostWorkdir, originalHostDir, copyTempDir, config } = opts
    return {
      mode,
      containerID,
      hostWorkdir,
      originalHostDir,
      copyTempDir,
      config,
      spawnArgs(_shell, _name, command, cwd, env) {
        const workdir = mapContainerPath(hostWorkdir, cwd)
        const args = ["exec", "-w", workdir, ...envArgs(env), containerID, "sh", "-lc", command]
        return {
          file: "docker",
          args,
          opts: { env, detached: process.platform !== "win32" },
        }
      },
      async destroy() {
        await Docker.remove(containerID)
        if (copyTempDir) await Copy.cleanup(copyTempDir).catch(() => {})
      },
    }
  }

  export function toChildProcessCommand(args: SpawnArgs): ChildProcess.Command {
    return ChildProcess.make(args.file, args.args, {
      shell: typeof args.opts.shell === "string" ? args.opts.shell : undefined,
      cwd: args.opts.cwd,
      env: args.opts.env,
      stdin: "ignore",
      detached: args.opts.detached,
    })
  }

  export function toNodeSpawnOptions(args: SpawnArgs, stdio: SpawnOptions["stdio"]): SpawnOptions {
    return {
      shell: args.opts.shell,
      cwd: args.opts.cwd,
      env: args.opts.env,
      stdio,
      detached: args.opts.detached,
      windowsHide: process.platform === "win32",
    }
  }

  export async function prepare(sessionID: string, hostDir: string, cfg: Config): Promise<Runtime> {
    if (cfg.mode === "off") return makeLocal(hostDir, cfg)

    if (!(await Docker.available())) {
      throw new Error(
        "Docker is not available. Install Docker or start the daemon, or run without --container.",
      )
    }

    await Docker.ensureImage(cfg.image)

    // Fire-and-forget sweep of stale containers from crashed sessions.
    Docker.sweepStale(Container.SESSION_LABEL).catch(() => {})

    let mountSource = hostDir
    let copyTempDir: string | null = null

    if (cfg.mode === "copy") {
      copyTempDir = path.join(Global.Path.data, "container", sessionID, "workspace")
      await fs.mkdir(path.dirname(copyTempDir), { recursive: true })
      await Copy.sync(hostDir, copyTempDir, cfg.exclude)
      mountSource = copyTempDir
    }

    const name = `opencode-${sessionID.slice(0, 12)}-${Date.now()}`
    const containerID = await Docker.runBackground({
      name,
      image: cfg.image,
      workdir: WORKSPACE_TARGET,
      mount: { source: mountSource, target: WORKSPACE_TARGET },
      network: cfg.network,
      memory: cfg.memory,
      cpus: cfg.cpus,
      pids: cfg.pids,
      runAsCurrentUser: cfg.runAsCurrentUser,
      labels: {
        [Container.SESSION_LABEL]: sessionID,
        "opencode.mode": cfg.mode,
      },
    })

    log.info("container started", { containerID: containerID.slice(0, 12), mode: cfg.mode, mountSource })

    return makeDocker({
      mode: cfg.mode,
      containerID,
      hostWorkdir: mountSource,
      originalHostDir: hostDir,
      copyTempDir,
      config: cfg,
    })
  }

  export function fromEnv(): Mode | undefined {
    const value = process.env["OPENCODE_CONTAINER"]?.toLowerCase()
    if (value === undefined) return undefined
    if (value === "off" || value === "none" || value === "" || value === "false" || value === "0") return "off"
    if (value === "mount" || value === "copy") return value
    if (value === "docker" || value === "true" || value === "1") return "mount"
    return undefined
  }
}
