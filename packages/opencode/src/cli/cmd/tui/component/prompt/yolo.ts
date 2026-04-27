import type { CommandOption } from "../dialog-command"
import type { Rule as PermissionRule } from "@/permission"

type YoloToast = {
  variant: "warning" | "info" | "error"
  message: string
  duration: number
}

type ToggleYoloInput = {
  sessionID?: string
  permissions: PermissionRule[]
  update: (input: {
    sessionID: string
    permission: PermissionRule[]
    permissionMode?: "replace"
  }) => Promise<unknown>
  sync: (sessionID: string) => Promise<unknown>
  toast: { show: (input: YoloToast) => void }
}

const YOLO_PERMISSION = { permission: "*", pattern: "*", action: "allow" } as const

type YoloCommandInput = {
  sessionID?: string
  permissions: PermissionRule[]
  update: ToggleYoloInput["update"]
  sync: ToggleYoloInput["sync"]
  toast: ToggleYoloInput["toast"]
}

export function createYoloCommandOption(input: YoloCommandInput): CommandOption {
  return {
    title: "YOLO",
    value: "session.yolo",
    category: "Session",
    slash: {
      name: "yolo",
    },
    onSelect: async () => {
      await toggleSessionYolo(input)
    },
  }
}

export async function toggleSessionYolo(input: ToggleYoloInput) {
  const sessionID = input.sessionID
  if (!sessionID) {
    input.toast.show({
      variant: "warning",
      message: "Open or start a session first",
      duration: 3000,
    })
    return false
  }

  const hasYolo = input.permissions.some(
    (rule) => rule.permission === "*" && rule.pattern === "*" && rule.action === "allow",
  )

  try {
    if (hasYolo) {
      const filtered = input.permissions.filter(
        (rule) => !(rule.permission === "*" && rule.pattern === "*" && rule.action === "allow"),
      )
      await input.update({
        sessionID,
        permission: filtered,
        permissionMode: "replace",
      })
      input.toast.show({
        variant: "info",
        message: "YOLO mode disabled",
        duration: 3000,
      })
    } else {
      await input.update({
        sessionID,
        permission: [YOLO_PERMISSION],
      })
      input.toast.show({
        variant: "warning",
        message: "YOLO mode enabled — permissions auto-approved this session",
        duration: 4000,
      })
    }

    await input.sync(sessionID)
    return true
  } catch (err) {
    input.toast.show({
      variant: "error",
      message: `YOLO toggle failed: ${err instanceof Error ? err.message : String(err)}`,
      duration: 5000,
    })
    return false
  }
}
