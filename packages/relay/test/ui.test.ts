import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createRelay } from "../src"

describe("relay mobile UI", () => {
  let server: ReturnType<typeof Bun.serve>
  let url: string

  beforeAll(() => {
    const relay = createRelay({ secret: "test", publicUrl: "http://127.0.0.1:0" })
    server = Bun.serve({ port: 0, fetch: relay.app.fetch, websocket: relay.websocket })
    url = `http://127.0.0.1:${server.port}`
  })
  afterAll(() => server.stop(true))

  it("serves an HTML page at /r/:code", async () => {
    const res = await fetch(`${url}/r/ABCD-1234`)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type") ?? "").toContain("text/html")
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.text()
    expect(body).toContain("<!doctype html>")
    expect(body).toContain("opencode remote")
    expect(body).toContain("/claim")
    expect(body).toContain("/t/event")
    // A malformed code in the URL shouldn't leak into the page contents — the
    // SPA reads it from window.location at runtime.
    expect(body).not.toContain("ABCD-1234")
  })

  it("accepts any code segment without validating server-side", async () => {
    // Lowercase, missing dash — the SPA normalises these before calling /claim,
    // and the relay never inspects the path, so the page still loads.
    const res = await fetch(`${url}/r/abcd1234`)
    expect(res.status).toBe(200)
  })
})
