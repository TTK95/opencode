import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config"
import { GlobalBus } from "@/bus/global"
import { Flag } from "@/flag/flag"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { ensureProcessMetadata } from "@/util/opencode-process"
import { Container } from "@/container"
import { ulid } from "ulid"

ensureProcessMetadata("worker")

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

Heap.start()

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

// If the TUI was launched with --container (or OPENCODE_CONTAINER env), pre-boot
// the Instance for the worker's cwd with a container runtime. Subsequent
// Instance.provide calls from the in-process server hit the same directory
// cache entry and reuse the runtime, so bash/shell tools route into Docker.
// Copy-mode redirects the instance directory to the isolated workspace so all
// tools (files + shell) operate on the copy.
async function preBootContainer() {
  const mode = Container.fromEnv()
  if (!mode || mode === "off") return
  const cfg = Container.merge(Container.DEFAULTS, {
    mode,
    ...(Flag.OPENCODE_CONTAINER_IMAGE ? { image: Flag.OPENCODE_CONTAINER_IMAGE } : {}),
  })
  const sessionID = ulid().toLowerCase()
  Log.Default.info("preparing container runtime for TUI", {
    mode: cfg.mode,
    image: cfg.image,
    cwd: process.cwd(),
  })
  try {
    const runtime = await Container.prepare(sessionID, process.cwd(), cfg)
    const directory = runtime.mode === "copy" && runtime.copyTempDir ? runtime.copyTempDir : process.cwd()
    await Instance.provide({
      directory,
      container: runtime,
      init: () => AppRuntime.runPromise(InstanceBootstrap),
      fn: async () => undefined,
    })
    Log.Default.info("container runtime ready", {
      mode: runtime.mode,
      containerID: runtime.containerID,
      directory,
    })
  } catch (err) {
    Log.Default.error("container runtime failed to start; continuing without sandbox", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
await preBootContainer()

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
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
    await Instance.provide({
      directory: input.directory,
      init: () => AppRuntime.runPromise(InstanceBootstrap),
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.invalidate(true)))
  },
  async shutdown() {
    Log.Default.info("worker shutting down")

    await Instance.disposeAll()
    if (server) await server.stop(true)
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${btoa(`${username}:${password}`)}`
}
