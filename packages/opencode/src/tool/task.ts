import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
<<<<<<< HEAD
import path from "path"
import os from "os"
import fs from "fs/promises"
import { spawn } from "child_process"
=======
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
>>>>>>> upstream/dev
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
<<<<<<< HEAD
import { Instance } from "@/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Exit, Schema } from "effect"
=======
import { Effect, Exit, Schema, Scope } from "effect"
>>>>>>> upstream/dev
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"

const log = Log.create({ service: "task-tool" })

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (c) => (stdout += c.toString()))
    proc.stderr?.on("data", (c) => (stderr += c.toString()))
    proc.on("error", () => resolve({ stdout, stderr, code: 1 }))
    proc.on("exit", (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

type Worktree = { dir: string; branch: string }

async function createWorktree(baseDir: string, subagent: string): Promise<Worktree | undefined> {
  try {
    const tmp = path.join(os.tmpdir(), `opencode-task-${subagent}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const branch = `opencode/task/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const add = await git(baseDir, ["worktree", "add", "-b", branch, tmp, "HEAD"])
    if (add.code !== 0) {
      log.error("git worktree add failed", { baseDir, tmp, branch, stderr: add.stderr })
      return undefined
    }
    return { dir: tmp, branch }
  } catch (err) {
    log.error("worktree setup threw", { error: String(err) })
    return undefined
  }
}

async function cleanupWorktree(baseDir: string, wt: Worktree): Promise<{ clean: boolean; removed: boolean }> {
  const status = await git(wt.dir, ["status", "--porcelain"])
  const clean = status.code === 0 && status.stdout.trim() === ""
  if (!clean) return { clean: false, removed: false }

  let removed = false
  const remove = await git(baseDir, ["worktree", "remove", wt.dir])
  if (remove.code === 0) {
    removed = true
  } else {
    const force = await git(baseDir, ["worktree", "remove", "--force", wt.dir])
    if (force.code === 0) {
      removed = true
    } else {
      // Last resort: nuke the directory ourselves and tell git to prune the
      // dangling worktree pointer. Treated as success only if rm + prune both
      // worked; otherwise the caller will see removed=false and surface the
      // path so the user can clean up manually.
      try {
        await fs.rm(wt.dir, { recursive: true, force: true })
        const prune = await git(baseDir, ["worktree", "prune"])
        removed = prune.code === 0
      } catch {
        removed = false
      }
    }
  }

  if (removed) {
    await git(baseDir, ["branch", "-D", wt.branch]).catch(() => undefined)
  }
  return { clean: true, removed }
}

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  isolation: Schema.optional(Schema.Literal("worktree")).annotate({
    description: `Isolate this subagent's work inside a temporary git worktree. The worktree path and branch are included in the subagent's prompt so it can scope all edits there. If the worktree is clean at task completion it is automatically removed; otherwise the path and branch are reported back for you to act on. Requires a git repository.`,
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          permission: [
            ...deriveSubagentSessionPermission({
              parentSessionPermission: parent.permission ?? [],
              parentAgent,
              subagent: next,
            }),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(params.prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          tools: {
            ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
            ...(next.permission.some((rule) => rule.permission === id) ? {} : { task: false }),
            ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
          },
          parts,
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: renderOutput({
                  sessionID: nextSession.id,
                  state,
                  summary:
                    state === "completed"
                      ? `Background task completed: ${params.description}`
                      : `Background task failed: ${params.description}`,
                  text,
                }),
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      if (yield* background.extend({ id: nextSession.id, run: runTask() })) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        }
      }

      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]),
        run: runTask().pipe(Effect.onInterrupt(() => ops.cancel(nextSession.id))),
      })

      function backgroundResult() {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task started",
            text: BACKGROUND_STARTED,
          }),
        }
      }

      if (runInBackground) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      // If the caller asked for worktree isolation, create one up front so
      // the path can be threaded into the subagent's prompt. Only new tasks
      // (not resumed via task_id) get a fresh worktree.
      const worktree =
        params.isolation === "worktree" && !session
          ? yield* Effect.promise(() => createWorktree(Instance.directory, next.name))
          : undefined

      // Caller explicitly requested worktree isolation — fail rather than
      // silently degrade to running against the primary checkout. Common cause:
      // not a git repository, or `git worktree add` failed (see logs).
      if (params.isolation === "worktree" && !session && !worktree) {
        return yield* Effect.fail(
          new Error(
            "Failed to create worktree for isolation. The directory must be a git repository and `git worktree add` must succeed.",
          ),
        )
      }

      const promptText =
        worktree === undefined
          ? params.prompt
          : [
              `You are running with worktree isolation. Perform ALL file edits inside:`,
              `  ${worktree.dir}`,
              `on branch \`${worktree.branch}\`. Use the \`workdir\` parameter on bash/edit/read tools so your changes land in that worktree, not the parent checkout.`,
              "",
              params.prompt,
            ].join("\n")

      // Track success-path cleanup so the release callback only runs cleanup
      // when the use-callback failed/aborted/was interrupted before reaching it.
      let cleanupAttempted = false
      // Snapshot the instance dir for the release callback (which runs outside
      // the instance ALS context) — but only when a worktree exists; eager
      // access throws in contexts without an active instance (e.g. tests).
      const instanceDir = worktree === undefined ? undefined : Instance.directory

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
<<<<<<< HEAD
            const parts = yield* ops.resolvePromptParts(promptText)
            const result = yield* ops.prompt({
              messageID,
              sessionID: nextSession.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              agent: next.name,
              tools: {
                ...(canTodo ? {} : { todowrite: false }),
                ...(canTask ? {} : { task: false }),
                ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
              },
              parts,
            })

            let worktreeNote = ""
            if (worktree && instanceDir !== undefined) {
              cleanupAttempted = true
              const { clean, removed } = yield* Effect.promise(() => cleanupWorktree(instanceDir, worktree))
              worktreeNote = removed
                ? `\n(worktree ${worktree.dir} was clean and has been removed; branch ${worktree.branch} deleted)`
                : `\n(worktree ${worktree.dir} left in place on branch \`${worktree.branch}\` — it contains ${clean ? "no" : "uncommitted"} changes; remove manually with \`git worktree remove${clean ? "" : " --force"} ${worktree.dir}\`)`
            }

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
                ...(worktree ? { worktree: worktree.dir, branch: worktree.branch } : {}),
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                ...(worktree ? [`worktree: ${worktree.dir}`, `branch: ${worktree.branch}`] : []),
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
                worktreeNote,
              ].join("\n"),
=======
            const result = yield* Effect.raceFirst(
              background.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(nextSession.id),
            )
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
>>>>>>> upstream/dev
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
<<<<<<< HEAD
            if (Exit.hasInterrupts(exit)) yield* cancel
            if (worktree && instanceDir !== undefined && !cleanupAttempted) {
              // Best-effort cleanup so failed/aborted task runs don't leak
              // temp worktrees or branches. Errors are swallowed because the
              // user already saw the task failure.
              yield* Effect.promise(() => cleanupWorktree(instanceDir, worktree)).pipe(Effect.ignore)
            }
=======
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true })
>>>>>>> upstream/dev
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
