import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { Container } from "@/container"
import { ContainerRegistry } from "@/container/registry"
import { Flag } from "@opencode-ai/core/flag/flag"
import { registerDisposer } from "@/effect/instance-registry"
import { ulid } from "ulid"

Heap.start()

const onUnhandledRejection = (_error: unknown) => {}

const onUncaughtException = (_error: Error) => {}

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

// If the TUI was launched with --container (or OPENCODE_CONTAINER env), pre-boot
// the Instance for the worker's cwd with a container runtime. Subsequent
// WithInstance.provide calls for the same directory hit the InstanceStore cache
// and reuse the runtime, so bash/shell tools route into Docker. Copy-mode
// redirects the instance directory to the isolated workspace so all tools
// (files + shell) operate on the copy.
async function preBootContainer() {
  const cwd = process.cwd()
  const envValue = process.env["OPENCODE_CONTAINER"]
  const mode = Container.fromEnv()
  ContainerRegistry.setDiagnostic({
    cwd,
    envValue,
    resolvedMode: mode,
    startedAt: Date.now(),
  })
  if (!mode) {
    ContainerRegistry.setDiagnostic({ status: "skipped-no-env", finishedAt: Date.now() })
    Log.Default.info("preBootContainer: skipped (OPENCODE_CONTAINER not set)", { envValue, cwd })
    process.stderr.write(`opencode container: skipped (OPENCODE_CONTAINER env not set; cwd=${cwd})\n`)
    return
  }
  if (mode === "off") {
    ContainerRegistry.setDiagnostic({ status: "skipped-off", finishedAt: Date.now() })
    Log.Default.info("preBootContainer: skipped (mode=off)", { envValue, cwd })
    process.stderr.write(`opencode container: off (envValue=${envValue})\n`)
    return
  }
  const cfg = Container.merge(Container.DEFAULTS, {
    mode,
    ...(Flag.OPENCODE_CONTAINER_IMAGE ? { image: Flag.OPENCODE_CONTAINER_IMAGE } : {}),
  })
  ContainerRegistry.setDiagnostic({
    status: "preparing",
    configMode: cfg.mode,
    configImage: cfg.image,
  })
  const sessionID = ulid().toLowerCase()
  Log.Default.info("preBootContainer: preparing", {
    mode: cfg.mode,
    image: cfg.image,
    cwd,
  })
  process.stderr.write(`opencode container: preparing ${cfg.mode} (image=${cfg.image}, cwd=${cwd})...\n`)
  try {
    const runtime = await Container.prepare(sessionID, cwd, cfg)
    const directory = runtime.mode === "copy" && runtime.copyTempDir ? runtime.copyTempDir : cwd
    // Register under BOTH the host cwd and the agent-side directory.
    // - host cwd is what the SDK sends as `x-opencode-directory` header, so HTTP
    //   handlers (e.g. /path) need that key to find the runtime.
    // - agent-side directory (= copyTempDir for copy, = cwd for mount) is what the
    //   InstanceStore caches under, so tool execution finds it via Instance.current.
    ContainerRegistry.register(cwd, runtime)
    if (directory !== cwd) ContainerRegistry.register(directory, runtime)
    ContainerRegistry.setDiagnostic({
      status: "succeeded",
      directory,
      containerID: runtime.containerID,
      finishedAt: Date.now(),
      error: undefined,
    })
    registerDisposer(async (dir) => {
      if (dir !== directory) return
      ContainerRegistry.unregister(cwd)
      if (directory !== cwd) ContainerRegistry.unregister(directory)
      try {
        await runtime.destroy()
      } catch (err) {
        Log.Default.warn("container destroy failed", { error: String(err) })
      }
    })
    await WithInstance.provide({
      directory,
      container: runtime,
      fn: async () => undefined,
    })
    Log.Default.info("preBootContainer: ready", {
      mode: runtime.mode,
      containerID: runtime.containerID,
      directory,
    })
    process.stderr.write(
      `opencode container: ready ${runtime.mode} (id=${(runtime.containerID ?? "").slice(0, 12)}, dir=${directory})\n`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ContainerRegistry.setDiagnostic({
      status: "failed",
      error: message,
      finishedAt: Date.now(),
    })
    Log.Default.error("preBootContainer: failed; continuing without sandbox", { error: message })
    process.stderr.write(`opencode container: FAILED — ${message}\n`)
    process.stderr.write(`opencode container: continuing WITHOUT sandbox (bash will run on the host)\n`)
  }
}
await preBootContainer()

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await InstanceRuntime.load({ directory: input.directory })
    await upgrade().catch(() => {})
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
}

Rpc.listen(rpc)
