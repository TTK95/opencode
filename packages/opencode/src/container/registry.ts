import { AppFileSystem } from "@opencode-ai/core/filesystem"
import type { Container } from "./index"

const runtimes = new Map<string, Container.Runtime>()

export type Status = "not-attempted" | "skipped-no-env" | "skipped-off" | "preparing" | "succeeded" | "failed"

export interface Diagnostic {
  status: Status
  envValue: string | undefined
  resolvedMode: Container.Mode | undefined
  configMode: Container.Mode | undefined
  configImage: string | undefined
  cwd: string
  directory: string | undefined
  containerID: string | null | undefined
  startedAt: number | undefined
  finishedAt: number | undefined
  error: string | undefined
}

let diagnostic: Diagnostic = {
  status: "not-attempted",
  envValue: undefined,
  resolvedMode: undefined,
  configMode: undefined,
  configImage: undefined,
  cwd: "",
  directory: undefined,
  containerID: undefined,
  startedAt: undefined,
  finishedAt: undefined,
  error: undefined,
}

function key(directory: string): string {
  return AppFileSystem.resolve(directory)
}

export function register(directory: string, runtime: Container.Runtime): void {
  runtimes.set(key(directory), runtime)
}

export function unregister(directory: string): void {
  runtimes.delete(key(directory))
}

export function lookup(directory: string): Container.Runtime | undefined {
  return runtimes.get(key(directory))
}

export function entries(): Array<[string, Container.Runtime]> {
  return [...runtimes.entries()]
}

export function setDiagnostic(patch: Partial<Diagnostic>): void {
  diagnostic = { ...diagnostic, ...patch }
}

export function getDiagnostic(): Diagnostic {
  return { ...diagnostic }
}

export * as ContainerRegistry from "./registry"
