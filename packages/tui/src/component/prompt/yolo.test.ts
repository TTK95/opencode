import { describe, expect, mock, test } from "bun:test"
import { createYoloCommandOption, toggleSessionYolo } from "./yolo"

describe("toggleSessionYolo", () => {
  test("enables YOLO mode when not already set", async () => {
    const update = mock(async () => undefined)
    const sync = mock(async () => undefined)
    const show = mock(() => undefined)

    const result = await toggleSessionYolo({
      sessionID: "session-1",
      permissions: [{ permission: "read", pattern: "*", action: "allow" }],
      update,
      sync,
      toast: { show },
    })

    expect(result).toBe(true)
    expect(update).toHaveBeenCalledWith({
      sessionID: "session-1",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    expect(sync).toHaveBeenCalledWith("session-1")
    expect(show).toHaveBeenCalledWith({
      variant: "warning",
      message: "YOLO mode enabled — permissions auto-approved this session",
      duration: 4000,
    })
  })

  test("disables YOLO mode when already enabled", async () => {
    const update = mock(async () => undefined)
    const sync = mock(async () => undefined)
    const show = mock(() => undefined)

    const result = await toggleSessionYolo({
      sessionID: "session-2",
      permissions: [
        { permission: "*", pattern: "*", action: "allow" },
        { permission: "read", pattern: "*", action: "allow" },
      ],
      update,
      sync,
      toast: { show },
    })

    expect(result).toBe(true)
    expect(update).toHaveBeenCalledWith({
      sessionID: "session-2",
      permission: [{ permission: "read", pattern: "*", action: "allow" }],
      permissionMode: "replace",
    })
    expect(sync).toHaveBeenCalledWith("session-2")
    expect(show).toHaveBeenCalledWith({
      variant: "info",
      message: "YOLO mode disabled",
      duration: 3000,
    })
  })

  test("warns when session is missing", async () => {
    const update = mock(async () => undefined)
    const sync = mock(async () => undefined)
    const show = mock(() => undefined)

    const result = await toggleSessionYolo({
      permissions: [],
      update,
      sync,
      toast: { show },
    })

    expect(result).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith({
      variant: "warning",
      message: "Open or start a session first",
      duration: 3000,
    })
  })

  test("reports update failures", async () => {
    const update = mock(async () => {
      throw new Error("boom")
    })
    const sync = mock(async () => undefined)
    const show = mock(() => undefined)

    const result = await toggleSessionYolo({
      sessionID: "session-3",
      permissions: [],
      update,
      sync,
      toast: { show },
    })

    expect(result).toBe(false)
    expect(sync).not.toHaveBeenCalled()
    expect(show).toHaveBeenCalledWith({
      variant: "error",
      message: "YOLO toggle failed: boom",
      duration: 5000,
    })
  })
})

describe("createYoloCommandOption", () => {
  test("creates the slash command metadata", () => {
    const option = createYoloCommandOption({
      sessionID: "session-1",
      permissions: [],
      update: async () => undefined,
      sync: async () => undefined,
      toast: { show: () => undefined },
    })

    expect(option.title).toBe("YOLO")
    expect(option.value).toBe("session.yolo")
    expect(option.category).toBe("Session")
    expect(option.slash).toEqual({ name: "yolo" })
    expect(typeof option.onSelect).toBe("function")
  })
})
