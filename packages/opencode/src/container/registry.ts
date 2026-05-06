import { AppFileSystem } from "@opencode-ai/core/filesystem"
import type { Container } from "./index"

const runtimes = new Map<string, Container.Runtime>()

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

export * as ContainerRegistry from "./registry"
