# Custom Features — TTK fork of opencode

Everything this fork carries on top of `anomalyco/opencode@upstream/dev`. Current base: **v1.14.22** → fork tag `1.14.22-dev_ttk`.

Each section lists: what it does, how to use it, and the commits / source files that implement it (so future merges know what to preserve).

---

## 1. RWTH / KI Connect NRW provider

Registers RWTH's OpenAI-compatible proxy as a first-class provider and normalises aliasing around its (frequently-rotating) model IDs.

**How to use.** With `RWTH_LLM_API_KEY` set in the environment and the provider block present in `~/opencode.json` (repo has a reference config at `C:/Users/tte/opencode.json`), plain model names like `fast`, `code`, `reasoning` resolve to `rwth/<name>` automatically. The legacy ID `gpt-5-mini` also aliases to the current `gpt-5.4-mini`.

**Where it lives.**
- `packages/opencode/src/config/provider.ts` — custom `rwth` loader, forces Chat-Completions over Responses, default bare model IDs get `rwth/` prefix, alias table
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` — extra Total/User/Assistant counters in the sidebar (RWTH limits per-message, not per-token)

**Commit.** `f9ee46885`

---

## 2. Pre-flight rate limiting with token accounting

Two-layer rate-limit handling for proxies that don't expose `x-ratelimit-*` headers. On the first `429` from a provider the observed per-minute and per-day counts are written to `opencode.json` under `provider.<id>.options.rateLimit`; subsequent requests are gated by a pre-flight `check()` that throws a `RateLimitError` with a friendly "retry in Ns" before the wire call, which the retry layer honours via `resetAt`.

Also covers:
- Sliding-window ticker (`RateLimit.tick()`) that parses `x-ratelimit-*`, `anthropic-ratelimit-*`, and IETF `ratelimit-*` headers.
- Nested rate-limit detection in SSE error payloads (some providers stream the error inside `data:` frames instead of a top-level HTTP 429).
- Narrowed detector so that `insufficient_quota` errors fall through to the normal error path (not treated as rate limits).

**Where it lives.**
- `packages/opencode/src/provider/rate-limit.ts` (new module — token windows, `check()`, `recordUsage`, header parser)
- `packages/opencode/src/provider/error.ts` — nested SSE `429` detection
- `packages/opencode/src/provider/provider.ts` — pre-flight gate + retry `resetAt` plumbing
- `packages/opencode/src/config/provider.ts` — persistence hooks
- `packages/opencode/test/provider/error-stream-rate-limit.test.ts`

**Commits.** `ec33256a1`, `2ffd1b0cd`, `dac7c9620`, `daf5b9984`, `c52e81d73`

---

## 3. YOLO mode (blanket auto-approve permissions)

Replaces per-session permission overrides with a single "YOLO mode" switch that auto-accepts every permission prompt. Off by default; toggled from the prompt area in the TUI.

**How to use.** In the TUI, toggle from the prompt (there's a YOLO indicator in `component/prompt/index.tsx`). Also accessible via config (`packages/opencode/src/config/config.ts`) and via the `OPENCODE_YOLO` flag (`flag/flag.ts`). Surfaced to the SDK as a session option.

**Where it lives.**
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` — UI toggle
- `packages/opencode/src/cli/cmd/tui/thread.ts` — wire-up
- `packages/opencode/src/config/config.ts`, `flag/flag.ts` — config + env
- `packages/opencode/src/server/routes/instance/session.ts` — server-side enforcement
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`, `types.gen.ts` — SDK surface

**Commit.** `fb120c07e`

---

## 4. `/usage` stats screen

Terminal-first usage dashboard, reachable via `/usage` (alias `/stats`).

**Tabs.**
- **Overview** — GitHub-style year heatmap + KPI block (total tokens, sessions, avg tokens/session, active days).
- **Models** — stacked per-day tokens chart with per-model breakdown.

**Keybindings.**
- `r` — cycle date range (All time / Last 7 days / Last 30 days). Filters all KPIs; heatmap stays year-wide.
- `ctrl+s` — copy a plain-text summary to the clipboard.

The top tab bar was dropped in favour of a single bold "Usage" headline — sub-tabs, range pills, and footer kept.

**Where it lives.**
- `packages/opencode/src/cli/cmd/tui/routes/stats/` — whole new route: `index.tsx`, `chart.tsx`, `data.ts`, `heatmap.tsx`, etc.
- `packages/opencode/src/cli/cmd/tui/util/usage-stats.ts` — pure derivation logic (unit-tested)
- `packages/opencode/src/cli/cmd/tui/app.tsx` + `context/route.tsx` + `plugin/api.tsx` — route registration

**Commits.** `5b502321c`, `489568d93`, `6085b96a8`, `62b58f40d`

---

## 5. Claude Code conveniences

Four features ported from Claude Code's tooling surface:

### 5a. Lifecycle + prompt plugin hooks

Five new entries on the plugin `Hooks` type:
- `session.start` / `session.end` — bridged from existing `session.created` / `session.deleted` bus events so authors can subscribe by name.
- `chat.prompt.submit` — fires at the entry of the prompt pipeline; plugins can inject context parts or block the prompt.
- `chat.stop` — fires at the exit of the prompt pipeline.
- `notify` — types-only scaffolding; TUI/desktop consumer is a follow-up.

**Where it lives.** `packages/plugin/src/index.ts`, `packages/opencode/src/plugin/index.ts`, `packages/opencode/src/session/prompt.ts`

### 5b. Background bash (+ `bash_output` / `kill_shell` tools)

`bash` grows a `run_in_background: true` parameter that returns a `shell_id` immediately while the process keeps running. Two new tools:
- `bash_output` — read incremental output from the shell's rolling 1 MB buffer (subsequent calls return only new bytes).
- `kill_shell` — SIGTERM then SIGKILL after a grace period; returns any final buffered output.

Shell registry lives in `packages/opencode/src/shell/background.ts`, scoped to the instance — `Effect.addFinalizer` kills every live child via `killTree` when the scope closes.

**Where it lives.** `packages/opencode/src/shell/background.ts` (new), `src/tool/bash.ts` (parameter), `src/tool/bash-output.ts` (new), `src/tool/kill-shell.ts` (new). All three tool parameter schemas are Effect `Schema.Struct` (matched to upstream's `Tool.define` migration in #23244).

### 5c. Task worktree isolation

The `task` subagent tool grows an `isolation: "worktree"` parameter. When set, a temporary git worktree is created on a fresh branch; the path + branch are injected into the subagent's prompt so it scopes all edits there. After completion, if the worktree is clean it's auto-removed; otherwise path+branch are reported back to the caller.

Filesystem-level isolation (rerouting `Instance.directory` per-session) is **out of scope** — the current approach relies on the subagent respecting the prompt's workdir guidance.

**Where it lives.** `packages/opencode/src/tool/task.ts` — `createWorktree` / `cleanupWorktree` helpers + Schema-typed `isolation` param.

### 5d. `statusLine` + `experimental.defer_tools` config

Schema + doc scaffolding only. TUI rendering for `statusLine` and the ToolSearch registry indirection for `defer_tools` are intentional follow-ups — each requires an independently-testable change (TUI status bar; tool registry refactor) better landed separately.

**Where it lives.** `packages/opencode/src/config/config.ts`

**Commits.** `5265a3d37` (feature), `d892a6fa1` (refactor/tighten background-shell surface), plus `76636ea90` (Schema migration follow-up from the v1.14.22 merge).

---

## 6. TUI fixes carried locally

Small TUI patches not yet upstreamed:

- `35519a49a fix(tui): resolve TuiThemeCurrent type constraint in sidebar context` — `ReturnType<...>` → bare property access after upstream changed `theme.current` from a function to a getter.
- `62b58f40d fix(tui): replace /usage top tab bar with plain "Usage" headline` — listed above under §4.

---

## 7. Developer ergonomics

- `LOCAL_REINSTALL.md` — step-by-step for `bun run build --single` + symlinked global install, and the nested-binary gotcha (`opencode-ai/node_modules/opencode-windows-x64` can shadow the top-level symlink). Commit `b78d907f7`.
- `.gitignore` — ignore `.claude/` (Claude Code settings + agent worktrees). Commit `ebce0140b`.

---

## Not in this fork (common confusions)

These are visible in the branch list but **not** merged into `dev`:

- **Remote control tunnel** (`f6fecc3ed`, `b57b65b04`) — lives on unmerged branches only.
- **Streaming rate-limit error fix** (`origin/fix/streaming-rate-limit-error`) — partial work folded into §2, standalone branch is a historical artefact.

---

## Rebuild / reinstall

See `LOCAL_REINSTALL.md`. TL;DR:

```bash
cd C:/Users/tte/Projects/opencode/packages/opencode
OPENCODE_VERSION=1.14.22-dev_ttk bun run build --single
```

The `npm install -g packages/opencode/dist/opencode-windows-x64` from the first-time setup is symlinked, so subsequent builds are picked up automatically — just close any running TUI sessions first (Windows holds a lock on the running `opencode.exe`).
