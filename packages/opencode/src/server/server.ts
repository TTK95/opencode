<<<<<<< HEAD
import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { adapter } from "#hono"
import { lazy } from "@/util/lazy"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { WorkspaceID } from "@/control-plane/schema"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
=======
import "./init-projectors"

import { NodeHttpServer } from "@effect/platform-node"
>>>>>>> upstream/dev
import { ConfigProvider, Context, Effect, Exit, Layer, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { OpenApi } from "effect/unstable/httpapi"
import { createServer } from "node:http"
import { MDNS } from "./mdns"
import { HttpApiApp } from "./routes/instance/httpapi/server"
import { disposeMiddleware } from "./routes/instance/httpapi/lifecycle"
import { WebSocketTracker } from "./routes/instance/httpapi/websocket-tracker"
import { PublicApi } from "./routes/instance/httpapi/public"
import type { CorsOptions } from "@opencode-ai/server/cors"
import { lazy } from "@/util/lazy"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

type ServerApp = {
  fetch(request: Request): Response | Promise<Response>
  request(input: string | URL | Request, init?: RequestInit): Response | Promise<Response>
}

type ListenOptions = CorsOptions & {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
  tls?: { cert: string; key: string }
}
type ListenerState = {
  scope: Scope.Scope
  server: Context.Service.Shape<typeof HttpServer.HttpServer>
  http: ListenerServer
  websockets: WebSocketTracker.Interface
}
type EffectListener = Omit<Listener, "stop"> & {
  stop: (close?: boolean) => Effect.Effect<void>
}

interface ListenerServer {
  readonly closeAll: Effect.Effect<void>
}

class ListenerServerService extends Context.Service<ListenerServerService, ListenerServer>()(
  "@opencode/ListenerServer",
) {}

export const Default = lazy(() => {
  const handler = HttpApiApp.webHandler().handler
  const app: ServerApp = {
    fetch: (request: Request) => handler(request, HttpApiApp.context),
    request(input, init) {
      return app.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
  return { app }
})

export async function openapi() {
  return OpenApi.fromApi(PublicApi)
}

export let url: URL | undefined

export async function listen(opts: ListenOptions): Promise<Listener> {
  const listener = await Effect.runPromise(listenEffect(opts))
  return {
    hostname: listener.hostname,
    port: listener.port,
    url: listener.url,
    stop: (close?: boolean) => Effect.runPromiseExit(listener.stop(close)).then(() => undefined),
  }
}

const listenEffect: (opts: ListenOptions) => Effect.Effect<EffectListener, unknown> = Effect.fn("Server.listen")(
  function* (opts: ListenOptions) {
    const state = yield* startWithPortFallback(opts)
    const address = yield* tcpAddress(state)
    const listenerUrl = makeURL(opts.hostname, address.port)
    const unpublishMdns = yield* setupMdns(opts, address.port, state.scope)
    url = listenerUrl

    return {
      hostname: opts.hostname,
      port: address.port,
      url: listenerUrl,
      stop: yield* makeStop(state, unpublishMdns, listenerUrl),
    }
  },
)

function listenerLayer(opts: ListenOptions, port: number) {
  return HttpRouter.serve(HttpApiApp.createRoutes(opts), {
    middleware: disposeMiddleware,
    disableLogger: true,
    disableListenLog: true,
  }).pipe(
    Layer.provideMerge(WebSocketTracker.layer),
    Layer.provideMerge(serverLayer({ port, hostname: opts.hostname })),
    // Install a fresh `ConfigProvider` per listener so `Config.string(...)`
    // reads reflect the current `process.env`. Effect's default
    // `ConfigProvider` snapshots `process.env` on first read and caches the
    // result on a module-singleton Reference; without overriding it here,
    // every later `Server.listen()` keeps observing that initial snapshot.
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv())),
  )
}

function startWithPortFallback(opts: ListenOptions) {
  if (opts.port !== 0) return startListener(opts, opts.port)
  // Match the legacy listener port-resolution behavior: explicit `0` prefers
  // 4096 first, then any free port.
  return startListener(opts, 4096).pipe(Effect.catch(() => startListener(opts, 0)))
}

function startListener(opts: ListenOptions, port: number) {
  const scope = Scope.makeUnsafe()
  return Layer.buildWithMemoMap(listenerLayer(opts, port), Layer.makeMemoMapUnsafe(), scope).pipe(
    Effect.provide(HttpApiApp.context),
    Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.ignore)),
    Effect.map(
      (ctx): ListenerState => ({
        scope,
        server: Context.get(ctx, HttpServer.HttpServer),
        http: Context.get(ctx, ListenerServerService),
        websockets: Context.get(ctx, WebSocketTracker.Service),
      }),
    ),
  )
}

function tcpAddress(state: ListenerState) {
  return Effect.gen(function* () {
    if (state.server.address._tag === "TcpAddress") return state.server.address
    yield* Scope.close(state.scope, Exit.void).pipe(Effect.ignore)
    return yield* Effect.die(new Error(`Unexpected HttpServer address tag: ${state.server.address._tag}`))
  })
}

function makeURL(hostname: string, port: number) {
  const result = new URL("http://localhost")
  result.hostname = hostname
  result.port = String(port)
  return result
}

<<<<<<< HEAD
export let url: URL

export async function listen(opts: ListenOptions): Promise<Listener> {
  const selected = select()
  const inner: Listener =
    selected.backend === "effect-httpapi" ? await listenHttpApi(opts, selected) : await listenLegacy(opts)

  const next = new URL(inner.url)
  url = next

  const mdns =
    opts.mdns && inner.port && opts.hostname !== "127.0.0.1" && opts.hostname !== "localhost" && opts.hostname !== "::1"
  if (mdns) {
    MDNS.publish(inner.port, opts.mdnsDomain)
  } else if (opts.mdns) {
    log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
  }

  let closing: Promise<void> | undefined
  let mdnsUnpublished = false
  const unpublish = () => {
    if (!mdns || mdnsUnpublished) return
    mdnsUnpublished = true
    MDNS.unpublish()
  }
  return {
    hostname: inner.hostname,
    port: inner.port,
    url: next,
    stop(close?: boolean) {
      unpublish()
      // Always forward stop(true), even if a graceful stop was requested
      // first, so native listeners can escalate shutdown in-place.
      const next = inner.stop(close)
      closing ??= next
      return close ? next.then(() => closing!) : closing
    },
  }
}

async function listenLegacy(opts: ListenOptions): Promise<Listener> {
  const built = create(opts)
  const server = await built.runtime.listen(opts)
  const innerUrl = new URL(opts.tls ? "https://localhost" : "http://localhost")
  innerUrl.hostname = opts.hostname
  innerUrl.port = String(server.port)
  return {
    hostname: opts.hostname,
    port: server.port,
    url: innerUrl,
    stop: (close?: boolean) => server.stop(close),
  }
}

/**
 * Run the effect-httpapi backend on a native Effect HTTP server. This
 * lets HttpApi routes that call `request.upgrade` (PTY connect, the
 * workspace-routing proxy WS bridge) work end-to-end; the legacy Hono
 * adapter path can't surface `request.upgrade` because its fetch handler has
 * no reference to the platform server instance for websocket upgrades.
 */
async function listenHttpApi(opts: ListenOptions, selection: ServerBackend.Selection): Promise<Listener> {
  log.info("server backend selected", {
    ...ServerBackend.attributes(selection),
    "opencode.server.runtime": HttpApiServer.name,
=======
function setupMdns(opts: ListenOptions, port: number, scope: Scope.Scope) {
  return Effect.gen(function* () {
    const publish =
      opts.mdns && port && opts.hostname !== "127.0.0.1" && opts.hostname !== "localhost" && opts.hostname !== "::1"
    if (publish) {
      const unpublish = yield* Effect.cached(Effect.sync(() => MDNS.unpublish()))
      yield* Effect.sync(() => MDNS.publish(port, opts.mdnsDomain))
      yield* Scope.addFinalizer(scope, unpublish)
      return unpublish
    }
    if (opts.mdns) {
      yield* Effect.logWarning("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }
    return Effect.void
>>>>>>> upstream/dev
  })
}

function makeStop(state: ListenerState, unpublishMdns: Effect.Effect<void>, listenerUrl: URL) {
  return Effect.gen(function* () {
    const forceCloseOnce = yield* Effect.cached(forceClose(state).pipe(Effect.ignore))
    const closeScopeOnce = yield* Effect.cached(
      Scope.close(state.scope, Exit.void).pipe(
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            if (url === listenerUrl) url = undefined
          }),
        ),
      ),
    )

<<<<<<< HEAD
  const start = async (port: number) => {
    const scope = Scope.makeUnsafe()
    try {
      // Effect's `HttpMiddleware` interface returns `Effect<…, any, any>` by
      // design, which leaks `R = any` through `HttpRouter.serve`. The actual
      // requirements at this point are fully satisfied by `createRoutes` and the
      // platform HTTP server layer; cast away the `any` to satisfy `runPromise`.
      const layer = buildLayer(port) as Layer.Layer<
        HttpServer.HttpServer | WebSocketTracker.Service | HttpApiServer.Service,
        unknown,
        never
      >
      // Share the global memoMap with AppRuntime so InstanceStore.Service is a
      // singleton across both. Without this, preBootContainer caches the
      // container runtime in AppRuntime's store, but HTTP handlers read from a
      // fresh per-listener store and never see it (path/* returns container=off).
      const ctx = await Effect.runPromise(Layer.buildWithMemoMap(layer, memoMap, scope))
      return { scope, ctx }
    } catch (err) {
      await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined)
      throw err
    }
  }

  // Match the legacy adapter port-resolution behavior: explicit `0` prefers
  // 4096 first, then any free port.
  let resolved: Awaited<ReturnType<typeof start>> | undefined
  if (opts.port === 0) {
    resolved = await start(4096).catch(() => undefined)
    if (!resolved) resolved = await start(0)
  } else {
    resolved = await start(opts.port)
  }
  if (!resolved) throw new Error(`Failed to start server on port ${opts.port}`)

  const server = Context.get(resolved.ctx, HttpServer.HttpServer)
  if (server.address._tag !== "TcpAddress") {
    await Effect.runPromise(Scope.close(resolved.scope, Exit.void))
    throw new Error(`Unexpected HttpServer address tag: ${server.address._tag}`)
  }
  const port = server.address.port

  const innerUrl = new URL("http://localhost")
  innerUrl.hostname = opts.hostname
  innerUrl.port = String(port)
  let forceStopPromise: Promise<void> | undefined
  let stopPromise: Promise<void> | undefined
  const forceStop = () => {
    forceStopPromise ??= Effect.runPromiseExit(
=======
    return (close?: boolean) =>
>>>>>>> upstream/dev
      Effect.gen(function* () {
        yield* unpublishMdns
        if (close) yield* forceCloseOnce
        yield* closeScopeOnce
      })
  })
}

function forceClose(state: ListenerState) {
  return Effect.all([state.http.closeAll, state.websockets.closeAll], { concurrency: "unbounded", discard: true })
}

function serverLayer(opts: { port: number; hostname: string }) {
  const server = createServer()
  const serverRef = { closeStarted: false, forceStop: false }
  const close = server.close.bind(server)
  // Keep shutdown owned by NodeHttpServer, but honor listener.stop(true) by
  // force-closing active HTTP sockets when its finalizer calls server.close().
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Node's overloads don't preserve a monkey-patched method assignment.
  server.close = ((callback?: Parameters<typeof server.close>[0]) => {
    serverRef.closeStarted = true
    const result = close(callback)
    if (serverRef.forceStop) server.closeAllConnections()
    return result
  }) as typeof server.close

  return Layer.mergeAll(
    NodeHttpServer.layer(() => server, { port: opts.port, host: opts.hostname, gracefulShutdownTimeout: "1 second" }),
    Layer.succeed(ListenerServerService)(
      ListenerServerService.of({
        closeAll: Effect.sync(() => {
          serverRef.forceStop = true
          if (serverRef.closeStarted) server.closeAllConnections()
        }),
      }),
    ),
  )
}

export * as Server from "./server"
