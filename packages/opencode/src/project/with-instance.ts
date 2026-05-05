import { AppRuntime } from "@/effect/app-runtime"
import type { Container } from "../container"
import { context } from "./instance-context"
import { InstanceStore } from "./instance-store"

export async function provide<R>(input: {
  directory: string
  fn: () => R
  container?: Container.Runtime
}): Promise<R> {
  const ctx = await AppRuntime.runPromise(
    InstanceStore.Service.use((store) =>
      store.load({ directory: input.directory, container: input.container }),
    ),
  )
  return context.provide(ctx, () => input.fn())
}

export * as WithInstance from "./with-instance"
