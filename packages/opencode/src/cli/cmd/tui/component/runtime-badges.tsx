import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"

const YOLO_RULE = (rule: { permission: string; pattern: string; action: string }) =>
  rule.permission === "*" && rule.pattern === "*" && rule.action === "allow"

function useContainerMode() {
  const project = useProject()
  return createMemo(() => project.instance.path().container?.mode ?? "off")
}

function useYoloActive() {
  const sync = useSync()
  const route = useRoute()
  return createMemo(() => {
    if (route.data.type !== "session") return false
    const session = sync.session.get(route.data.sessionID)
    if (!session) return false
    return (session.permission ?? []).some(YOLO_RULE)
  })
}

export function ContainerBadge(props: { compact?: boolean }) {
  const { theme } = useTheme()
  const mode = useContainerMode()

  const symbol = () => (mode() === "off" ? "○" : "■")
  const color = () => {
    switch (mode()) {
      case "mount":
        return theme.warning
      case "copy":
        return theme.success
      default:
        return theme.textMuted
    }
  }
  const label = () => (props.compact ? `container:${mode()}` : `container · ${mode()}`)

  return (
    <text fg={mode() === "off" ? theme.textMuted : theme.text}>
      <span style={{ fg: color() }}>{symbol()}</span> {label()}
    </text>
  )
}

export function YoloBadge(props: { compact?: boolean }) {
  const { theme } = useTheme()
  const active = useYoloActive()

  const symbol = () => (active() ? "▲" : "○")
  const color = () => (active() ? theme.error : theme.textMuted)
  const stateLabel = () => (active() ? "ON" : "off")
  const label = () => (props.compact ? `yolo:${stateLabel()}` : `yolo · ${stateLabel()}`)

  return (
    <Show
      when={active()}
      fallback={
        <text fg={theme.textMuted}>
          <span style={{ fg: color() }}>{symbol()}</span> {label()}
        </text>
      }
    >
      <text fg={theme.text}>
        <span style={{ fg: color() }}>
          <b>{symbol()}</b>
        </span>{" "}
        <b>{label()}</b>
      </text>
    </Show>
  )
}
