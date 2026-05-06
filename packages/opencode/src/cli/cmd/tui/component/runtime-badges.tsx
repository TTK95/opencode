import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { Wildcard } from "@/util/wildcard"

type Rule = { permission: string; pattern: string; action: string }

function evaluateAction(permission: string, rules: ReadonlyArray<Rule>): string {
  const match = rules.findLast((r) => Wildcard.match(permission, r.permission) && Wildcard.match("*", r.pattern))
  return match?.action ?? "ask"
}

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
    const rules = (session.permission ?? []) as ReadonlyArray<Rule>
    if (rules.length === 0) return false
    // YOLO = the dangerous tools (bash + edit) both effectively resolve to allow.
    // Just checking for the wildcard rule shape is too loose: a config like
    //   { "*": "allow", "bash": "ask", "edit": "ask" }
    // contains the wildcard but is NOT YOLO because later rules override.
    return evaluateAction("bash", rules) === "allow" && evaluateAction("edit", rules) === "allow"
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
