import { createMemo } from "solid-js"
import { useProject } from "../context/project"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { Wildcard } from "@/util/wildcard"

export type Rule = { permission: string; pattern: string; action: string }

export function evaluateAction(permission: string, rules: ReadonlyArray<Rule>): string {
  const match = rules.findLast((r) => Wildcard.match(permission, r.permission) && Wildcard.match("*", r.pattern))
  return match?.action ?? "ask"
}

export function useContainerMode() {
  const project = useProject()
  return createMemo(() => project.instance.path().container?.mode ?? "off")
}

export function useContainerImage() {
  const project = useProject()
  return createMemo(() => project.instance.path().container?.image ?? "")
}

export function useSessionRules() {
  const sync = useSync()
  const route = useRoute()
  return createMemo(() => {
    if (route.data.type !== "session") return [] as ReadonlyArray<Rule>
    const session = sync.session.get(route.data.sessionID)
    return ((session?.permission ?? []) as ReadonlyArray<Rule>) ?? []
  })
}

export function useYoloActive() {
  const rules = useSessionRules()
  return createMemo(() => {
    const r = rules()
    if (r.length === 0) return false
    // YOLO = the dangerous tools (bash + edit) both effectively resolve to allow.
    // A config like { "*": "allow", "bash": "ask", "edit": "ask" } contains the
    // wildcard but is NOT YOLO because the later rules override via findLast.
    return evaluateAction("bash", r) === "allow" && evaluateAction("edit", r) === "allow"
  })
}
