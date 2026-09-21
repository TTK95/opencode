<<<<<<< HEAD
import { ulid } from "ulid"

import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Container } from "../container"
import { registerDisposer } from "@/effect/instance-registry"
import { Instance } from "../project/instance"
import { InstanceRuntime } from "../project/instance-runtime"
import { WithInstance } from "../project/with-instance"
import { UI } from "./ui"

const log = Log.create({ service: "cli.bootstrap" })

function resolveConfig(override: Partial<Container.Config> | undefined): Container.Config {
  const envMode = Container.fromEnv()
  const merged = Container.merge(Container.DEFAULTS, override)
  if (override?.mode === undefined && envMode !== undefined) merged.mode = envMode
  if (override?.image === undefined && Flag.OPENCODE_CONTAINER_IMAGE) merged.image = Flag.OPENCODE_CONTAINER_IMAGE
  return merged
}

export async function bootstrap<T>(
  directory: string,
  cb: () => Promise<T>,
  opts?: { container?: Partial<Container.Config> },
) {
  const cfg = resolveConfig(opts?.container)
  let runtime: Container.Runtime | undefined
  let boundDirectory = directory
  if (cfg.mode !== "off") {
    const sessionID = ulid().toLowerCase()
    log.info("preparing container runtime", { mode: cfg.mode, sessionID })
    UI.println(
      `${UI.Style.TEXT_INFO_BOLD}container${UI.Style.TEXT_NORMAL} running in ${cfg.mode} mode (session ${sessionID}, image ${cfg.image})`,
    )
    runtime = await Container.prepare(sessionID, directory, cfg)
    if (runtime.mode === "copy" && runtime.copyTempDir) {
      // In copy mode, redirect the instance's working directory to the isolated
      // workspace so file tools operate on the copy and bash exec paths inside the
      // container line up with host-side reads.
      boundDirectory = runtime.copyTempDir
      UI.println(`  ${UI.Style.TEXT_DIM}workspace: ${runtime.copyTempDir}${UI.Style.TEXT_NORMAL}`)
      UI.println(
        `  ${UI.Style.TEXT_DIM}export: opencode container export ${sessionID}${UI.Style.TEXT_NORMAL}`,
      )
    }
    const containerRuntime = runtime
    registerDisposer(async (dir) => {
      if (dir !== boundDirectory) return
      try {
        await containerRuntime.destroy()
      } catch (err) {
        log.warn("container destroy failed", { error: String(err) })
      }
    })
  }

  return WithInstance.provide({
    directory: boundDirectory,
    container: runtime,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await InstanceRuntime.disposeInstance(Instance.current)
      }
    },
  })
=======
import { InstanceRuntime } from "../project/instance-runtime"
import { context } from "../project/instance-context"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  const ctx = await InstanceRuntime.load({ directory })
  try {
    return await context.provide(ctx, cb)
  } finally {
    await InstanceRuntime.disposeInstance(ctx)
  }
>>>>>>> upstream/dev
}
