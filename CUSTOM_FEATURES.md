# Custom Features — TTK fork of opencode

Everything this fork carries on top of `anomalyco/opencode@upstream/dev`. Current base: **v1.14.28** → fork tag `1.14.28-dev_ttk`.

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

## 7. `opencode tailscale` — drive a session from your phone

Exposes the opencode web UI on your tailnet so any device signed into the same Tailscale account (phone, tablet, second laptop) can drive a session. WireGuard handles NAT traversal, Tailscale issues the TLS cert, no pairing codes, no relay to host, nothing on the public internet.

### Setup

1. Install Tailscale on the laptop running opencode and on your phone: <https://tailscale.com/download>. Sign both into the same tailnet.
2. From the repo, run:

   ```
   opencode tailscale
   ```

   Prints something like:

   ```
   Tailnet:    mycorp.ts.net
   Device:     pine-laptop
   Open on any tailnet device:
     http://pine-laptop.mycorp.ts.net:4096/
   ```

3. Open that URL from the phone browser — the standard opencode web UI loads.

### HTTPS

Some browser features (clipboard write, install-as-PWA, secure-context APIs) require HTTPS:

```
opencode tailscale --tls
```

Shells out to `tailscale cert`, caches the result under `~/.opencode/data/tls/<host>/`. May require enabling **Tailscale Admin → DNS → HTTPS Certificates** first.

### Auth

By default, anyone on your tailnet who knows the URL can drive the session. For shared tailnets, set a second factor:

```
OPENCODE_SERVER_PASSWORD=$(openssl rand -hex 16) opencode tailscale
```

The phone will prompt for the password on first load.

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--port <n>` | `4096` | TCP port to bind. |
| `--hostname <ip>` | this device's Tailscale IP | Default keeps the server tailnet-only; pass `0.0.0.0` to also expose it on non-tailnet interfaces. |
| `--tls` | `false` | Fetch a Tailscale-issued cert and serve HTTPS. |
| `--cors <origin>` | `[]` | Repeatable. Allow extra origins. |

### Where it lives

- `packages/opencode/src/cli/cmd/tailscale.ts` — subcommand
- `packages/opencode/src/tailscale/client.ts` — tailscaled API + `tailscale status --json` fallback
- `packages/opencode/src/tailscale/cert.ts` — cert cache
- `packages/opencode/src/server/adapter.{bun,node,ts}.ts` — optional `tls: { cert, key }` passthrough
- `packages/opencode/TAILSCALE.md` — end-user doc
- `packages/opencode/test/tailscale/client.test.ts`, `adapter-tls.test.ts`

The earlier custom WebSocket relay (paired-code remote control) was reverted (`b56e441d5`, `ee7ecc662`) in favour of this — Tailscale gives NAT traversal, identity, valid TLS, and MagicDNS for free.

**Commits.** `947037b72`, `7d5bae80c`

---

## 8. Docker sandbox for tool execution

Opt-in Docker sandbox that runs `bash` and shell-tool actions inside an isolated container. File tools (read/edit/glob/grep) stay on the host; only shell execution is sandboxed.

### Prerequisite: Docker Desktop

A working `docker` on `PATH` is required. On Windows, the supported route is Docker Desktop:

```powershell
winget install --id Docker.DockerDesktop --source winget `
  --accept-package-agreements --accept-source-agreements --silent
```

Winget will prompt for UAC elevation; the install itself is ~600 MB and takes 2–4 min. After install, launch **Docker Desktop** from the Start menu once to initialise the WSL2 backend and accept the first-run terms, then confirm with `docker --version`.

Without `docker` available, opencode falls back to the host shell and logs `container runtime failed to start; continuing without sandbox` — the TUI still works, just without isolation. In that state the `--container` flag effectively becomes a no-op.

Alternatives that ship a `docker`-compatible CLI (Podman with `podman-docker`, Rancher Desktop in dockerd mode) are untested against this integration — let us know if they work for you.

### Two modes

- **mount** — binds `$CWD` into `/workspace` in the container. File tools still write directly to the host repo; shell commands run in the container.
- **copy** — rsyncs the repo into `$OPENCODE_DATA/container/<id>/workspace`, mounts that into the container, and redirects `Instance.directory` so **all** tools operate on the copy. Review or apply changes back with `opencode container export <sessionID>`.

### Activation

CLI flag or env:

```
opencode --container mount
opencode --container copy
OPENCODE_CONTAINER=copy opencode
```

Custom image:

```
opencode --container mount --container-image python:3.12-slim
OPENCODE_CONTAINER_IMAGE=... opencode
```

Default image: `node:22-alpine`.

### Secure defaults

- `--network=none`
- `--cap-drop=ALL`
- `--security-opt=no-new-privileges`
- `--user <uid>:<gid>` (matches host user to avoid root-owned files in the workspace)
- Memory / CPU / PID limits
- Label-based cleanup of stale containers on next start

### Subcommands

- `opencode container status` — list active sandboxes
- `opencode container prune` — remove stopped/stale ones
- `opencode container export <sessionID>` — diff-and-apply the copy workspace back onto the host repo

### Caveats

- Config-file support for the `container` section is wired in the schema but the runtime is currently resolved from CLI/env only. Per-project container config before `Instance.provide` is a follow-up.
- Env forwarding hardens against host-toolchain leakage: `ENV_SKIP` drops `PATH`, `MANPATH`, `LD_LIBRARY_PATH`, `NODE`, `NODE_PATH`, `NODE_OPTIONS`, `VIRTUAL_ENV`, `CONDA_PREFIX`, `SSH_*`, `DISPLAY`, `TERM_PROGRAM`, `XPC_*` and prefixes `NVM_`, `FNM_`, `VOLTA_`, `PYENV_`, `RBENV_`, `XDG_`, `__CF`.

### Where it lives

- `packages/opencode/src/container/index.ts` — `Runtime` abstraction, env forwarding, `InstanceContext` integration
- `packages/opencode/src/container/docker.ts` — Docker wrapper
- `packages/opencode/src/container/copy.ts` — rsync/diff/apply
- `packages/opencode/src/cli/cmd/container.ts` — `status`/`prune`/`export`
- `packages/opencode/src/cli/bootstrap.ts` — `--container` flag parsing and startup
- `packages/opencode/src/tool/bash.ts`, `shell/background.ts` — `Runtime.spawnArgs()` routing when a container runtime is active
- `packages/opencode/src/config/config.ts` — schema (runtime wire-up is follow-up)
- `packages/opencode/test/container/copy.test.ts`

**Commits.** `5e97497bb`, `7d74db9bf`

---

## 9. Developer ergonomics

- `LOCAL_REINSTALL.md` — step-by-step for `bun run build --single` + symlinked global install, and the nested-binary gotcha (`opencode-ai/node_modules/opencode-windows-x64` can shadow the top-level symlink). Commit `b78d907f7`.
- `.gitignore` — ignore `.claude/` (Claude Code settings + agent worktrees). Commit `ebce0140b`.

---

## Not in this fork (common confusions)

These are visible in the branch list but **not** merged into `dev`:

- **Custom remote-control relay** (`f6fecc3ed`, `b57b65b04`, `068555096`) — reverted in favour of §7 Tailscale. The relay branch + relay package were dropped.
- **Streaming rate-limit error fix** (`origin/fix/streaming-rate-limit-error`) — partial work folded into §2, standalone branch is a historical artefact.

---

## Rebuild / reinstall

See `LOCAL_REINSTALL.md`. TL;DR:

```bash
cd C:/Users/tte/Projects/opencode/packages/opencode
OPENCODE_VERSION=1.14.28-dev_ttk bun run build --single
```

The `npm install -g packages/opencode/dist/opencode-windows-x64` from the first-time setup is symlinked, so subsequent builds are picked up automatically — just close any running TUI sessions first (Windows holds a lock on the running `opencode.exe`).
