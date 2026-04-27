import { ulid } from "ulid"

import { AppRuntime } from "@/effect/app-runtime"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { Container } from "../container"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Log } from "../util"
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
      UI.println(
        `  ${UI.Style.TEXT_DIM}workspace: ${runtime.copyTempDir}${UI.Style.TEXT_NORMAL}`,
      )
      UI.println(
        `  ${UI.Style.TEXT_DIM}export: opencode container export ${sessionID}${UI.Style.TEXT_NORMAL}`,
      )
    }
  }

  return Instance.provide({
    directory: boundDirectory,
    container: runtime,
    init: () => AppRuntime.runPromise(InstanceBootstrap),
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}
