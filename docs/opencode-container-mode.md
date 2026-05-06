# Container Mode — How It Works

> Report on opencode's `--container` sandbox: architecture, modes, security defaults, lifecycle, integration, and limitations.
> Generated 2026-05-05 against fork branch `dev` @ `37d19919b` (opencode `1.14.41-dev_ttk`).

---

## Big picture

Container mode runs **shell tool calls** inside a short-lived Docker container. The opencode TUI/server itself stays on the host; only the bash/edit work is shipped into the sandbox via `docker exec`. This gives you containment without losing host integrations (terminal, editor, fonts, IME, network, auth — all still work normally).

```
┌────────────────────────────────────────────────────────────────────┐
│  HOST (Windows)                                                    │
│  ┌──────────────┐    ┌──────────────────────┐                      │
│  │ TUI process  │ ←→ │ opencode worker      │                      │
│  │ (Bun/Node)   │RPC │ (server, agent loop) │                      │
│  └──────────────┘    └──────────┬───────────┘                      │
│                                 │ docker exec                      │
│                                 ▼                                  │
│                       ┌──────────────────────┐                     │
│                       │ Alpine container     │                     │
│                       │ /workspace = cwd     │                     │
│                       │ network: none        │                     │
│                       │ caps: dropped        │                     │
│                       └──────────────────────┘                     │
└────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

Before `--container mount` / `--container copy` can do anything, the host needs:

### Required

- **Docker CLI on `PATH`** — `Container.prepare()` shells out to `docker` directly. No support for podman/colima/nerdctl drop-ins unless they expose a `docker` binary on `PATH`.
- **Running Docker daemon** — `Docker.available()` calls `docker info` with a 5 s timeout at startup; if it fails, opencode logs `container runtime failed to start; continuing without sandbox` and falls back to host execution. Concretely:
  - **Windows**: Docker Desktop running, WSL2 backend enabled.
  - **macOS**: Docker Desktop, OrbStack, Rancher Desktop, or Colima with `docker` symlinked.
  - **Linux**: `dockerd` running and the user in the `docker` group (or `sudo` access — but opencode invokes `docker` without sudo).
- **opencode build with container support** — the opencode binary needs to be at a version that ships container code (this fork ≥ `1.14.21-dev_ttk`, upstream main since the container module landed). `opencode --help` must list `--container` under the default TUI command.
- **Internet for the first run** — `Docker.ensureImage()` does an `inspect`-then-`pull`. The default image `node:22-alpine` (~50 MB compressed) must be reachable at first invocation. After that the local cache satisfies it offline.
- **Disk space** — at least the image size (~150 MB extracted for `node:22-alpine`) plus, in `copy` mode, enough room under `~/.local/share/opencode/container/<sessionID>/workspace` to hold a copy of your project (minus the default ignores).
- **Memory** — at least 2 GB available to Docker (the default `--memory 2g` cap). Reduce via `container.memory` in `opencode.json` on smaller machines.

### Required for `mount` mode (bind mount of cwd)

- **Docker Desktop file sharing** must include the drive holding your project.
  - **Windows**: drives are shared automatically when WSL2 backend is on; no extra config for `C:\` or any path under your WSL distro. Hyper-V backend requires explicit drive sharing in *Docker Desktop → Settings → Resources → File sharing*.
  - **macOS**: paths under your home dir work out of the box; non-default paths must be added under *Settings → Resources → File sharing*.
- **Project path resolvable inside Docker's VM** — if your cwd is on a network share, an exotic mount, or a path Docker Desktop can't reach, the bind mount silently maps to an empty directory. Symptom: container starts, `ls /workspace` is empty.

### Required for `copy` mode

- **Write access to `~/.local/share/opencode/container/`** — the temp workspace lives under `Global.Path.data`, which on Windows resolves under `%LOCALAPPDATA%`/`%APPDATA%` via xdg-basedir conventions, on Linux/macOS to `$XDG_DATA_HOME` or `~/.local/share`.
- **Free disk for the copy** — your full project tree minus default ignores (`.git`, `node_modules`, `.opencode`, `.venv`, `__pycache__`, `dist`, `build`).

### Optional but useful

- **Custom Docker image** — `node:22-alpine` is minimal: no `git`, no `bash`, no `make`, no compilers. If your tooling needs more, build your own image and pass `--container-image my/opencode-dev:tag` (or set `container.image` in `opencode.json`). The image must have `sh` available (for `sh -lc <cmd>`).
- **Network for tools that need it** — default `container.network = "none"` blocks all egress. Set to `"bridge"` if `npm install` / `pip install` / `curl` need to work; `"host"` to share the host stack (incl. localhost services).
- **Docker permissions on Linux** — add your user to the `docker` group (`sudo usermod -aG docker $USER`, then re-login). Otherwise every `docker` call fails with permission errors, and pre-boot will silently fall back to no-sandbox.

### Quick sanity check

```bash
docker info --format '{{.ServerVersion}}'   # must print a version, exit 0
docker pull node:22-alpine                  # warm the image cache
opencode --container mount                  # should log "container runtime ready"
```

If any of those three fail, container mode won't activate — opencode will run unsandboxed instead of erroring. Watch the startup logs (`opencode --print-logs` or your log file) for the `container runtime ready` line as confirmation.

---

## Wiring entry point

CLI flags (`packages/opencode/src/cli/cmd/tui/thread.ts:121-129`):

- `--container off|mount|copy`
- `--container-image <docker-image>`

Both feed into env vars `OPENCODE_CONTAINER` / `OPENCODE_CONTAINER_IMAGE` so the worker subprocess sees them.

The TUI worker (`packages/opencode/src/cli/cmd/tui/worker.ts:58-98`) calls `preBootContainer()` **before** the server boots. That:

1. Reads `OPENCODE_CONTAINER` via `Container.fromEnv()`.
2. Calls `Container.prepare(sessionID, cwd, cfg)` — this is the heavy lift (image pull, container start).
3. Stores the resulting `Runtime` in the InstanceStore so every later `WithInstance.provide({directory: ...})` call reuses the same container instead of starting a new one per tool invocation.
4. Registers a disposer that calls `runtime.destroy()` (= `docker rm -f` + temp cleanup) when the instance is freed (e.g., at TUI exit).

---

## The three modes

`packages/opencode/src/container/index.ts:14`:

| Mode | What it does | When to use |
|---|---|---|
| **off** (default) | No container. `localSpawnArgs()` runs commands on the host. | Day-to-day, when you trust the project. |
| **mount** | Container with cwd bind-mounted at `/workspace`. Files are shared **bidirectionally** with the host. | Sandbox processes/network, keep edits live in the project. |
| **copy** | Cwd is `Copy.sync`'d into `~/.local/share/opencode/container/<sessionID>/workspace` and *that* is mounted. The `directory` the agent operates on is the temp copy. | Maximum isolation: the agent can't touch your project files at all. |

Copy mode also exposes `Container.Copy.diff()` / `apply()` (`copy.ts:79-106`) so you can review and selectively merge changes back to the project — agent can't unilaterally mutate your real files.

`copy` mode default ignores: `.git`, `node_modules`, `.opencode`, `.DS_Store`, `.venv`, `__pycache__`, `dist`, `build`. Add to `cfg.exclude` to extend.

---

## Security defaults

`Container.DEFAULTS` (`index.ts:31-40`) and `Docker.runBackground` (`docker.ts:81-105`):

| Setting | Default | What it gives you |
|---|---|---|
| `network` | **`none`** | No internet, no LAN, no host loopback. `bridge` for normal docker NAT, `host` for full host networking. |
| `--cap-drop ALL` | always | All Linux capabilities dropped (no raw sockets, no mount, no ptrace, no chroot, no kernel-config tweaks…). |
| `--security-opt no-new-privileges:true` | always | suid/sgid binaries can't gain privileges inside. |
| `memory` | `2g` | Hard memory cap. |
| `cpus` | `2` | CPU quota. |
| `pids` | `256` | Fork bomb protection. |
| `--user $UID:$GID` | non-Windows only | Files created in the container are owned by you, not root. (Disabled on Windows because the host is NT — the container still runs as `root` inside Alpine.) |
| `--rm` | always | Container disk is destroyed on exit. |
| labels | `opencode.session=<id>`, `opencode.mode=<mount\|copy>` | Used by `sweepStale()` to clean up zombies from crashed sessions. |

The container's entrypoint is `sh -c "sleep infinity"` — it does nothing on its own and just sits idle. All work goes through `docker exec` from the host.

---

## Environment variables

`envArgs()` (`index.ts:117-126`) forwards your env into the container — but skips a curated set that would break command resolution:

- **Path-related**: `PATH`, `MANPATH`, `INFOPATH`, `LD_LIBRARY_PATH`, `DYLD_*`, `NODE_PATH`, `NODE_OPTIONS`
- **Shell/identity**: `HOME`, `USER`, `LOGNAME`, `SHELL`, `PWD`, `OLDPWD`, `TMPDIR`/`TMP`/`TEMP`
- **Display/SSH**: `DISPLAY`, `WAYLAND_DISPLAY`, `SSH_AUTH_SOCK`, `SSH_*`, `XPC_*`
- **Prefix-skipped**: `BASH_*`, `ZSH_*`, `NVM_*`, `FNM_*`, `VOLTA_*`, `PYENV_*`, `RBENV_*`, `XDG_*`, `__CF*`

So your tokens (`GITHUB_TOKEN`, `OPENAI_API_KEY`, etc.) **do** make it in — the container can act as you against external services. Your shell rcfile/toolchain setup does not. This is correct: the container is a Linux Alpine box with Linux tooling, not an emulation of your dev shell.

---

## Workdir mapping

`mapContainerPath()` (`index.ts:66-76`) translates host cwd → container path. If a tool says "run this in `C:\Users\tte\Projects\opencode\packages\opencode`", the wrapper computes the relative path from the mount source and maps to `/workspace/packages/opencode`. If the host cwd escapes the mount root, it falls back to `/workspace` and logs a warning — files outside cwd are simply not visible to the container, which is the intended behavior.

Path separators are POSIX-converted (`path.sep` → `/`), so Windows hosts work transparently.

---

## Lifecycle

```
TUI start
   │
   ▼
preBootContainer()
   │
   ├── Container.fromEnv()   ── reads OPENCODE_CONTAINER
   ├── Docker.available()    ── `docker info` ping with 5s timeout
   ├── Docker.ensureImage()  ── inspect-then-pull
   ├── Docker.sweepStale()   ── fire-and-forget cleanup of crashed-session containers (filtered by `opencode.session` label)
   ├── (copy mode)           ── Copy.sync(hostDir → tempDir)
   ├── Docker.runBackground()── `docker run -d --rm ... sleep infinity`
   └── Instance cached       ── WithInstance.provide stores Runtime in InstanceStore

TUI runs N tools
   │
   ├── shell.ts             ── Instance.current.container.spawnArgs(...)
   │                            → ["docker", "exec", "-w", workdir, "-e", env..., id, "sh", "-lc", cmd]
   ├── background.ts        ── same wiring for long-running shell processes
   └── stays in same container for entire session

TUI exit / instance freed
   │
   └── runtime.destroy()    ── docker rm -f + Copy.cleanup tempDir (copy mode)
```

If the container fails to start (no Docker daemon, image pull error, etc.), pre-boot logs the error and falls through to host execution — the TUI **does not abort**. Worth knowing: if Docker is broken, the TUI silently runs unsandboxed. Watch for the `container runtime ready` log line on startup if you want to be sure.

---

## How shell tools route through the container

`packages/opencode/src/tool/shell.ts:293-298` and `packages/opencode/src/shell/background.ts:54-59` both use the same pattern:

```ts
const runtime = Instance.current.container
const args = runtime.spawnArgs(shell, name, command, cwd, env)
const proc = spawn(...Container.toChildProcessCommand(args))   // or toNodeSpawnOptions
```

In `off` mode, `spawnArgs` returns a normal local spawn (Windows PowerShell handling included at `index.ts:135-141`). In `mount`/`copy` mode, it returns `docker exec`-prefixed args. The tool layer is mode-agnostic.

---

## Permission integration

`packages/opencode/src/session/prompt.ts:sandboxRuleset()` prepends `allow: *` rules for `bash` and `edit` whenever `Instance.current.container.mode !== "off"`. Reasoning: those actions execute inside the container, so per-call permission prompts add friction without adding safety — the container is the safety. Prepended (not appended) so user-defined agent/session rules later in the array still override via `findLast()` semantics in `evaluate.ts`. Without container, behavior is unchanged.

`external_directory` is **deliberately not auto-allowed** even in container mode. `Read`/`Glob`/`Grep`/`Edit`/`Write` all call `assertExternalDirectory` against host paths *before* any container hop, and they use Node's host-side `fs`. Auto-allowing the permission would let host-fs tools quietly escape the project boundary — defeating copy-mode isolation in particular. So out-of-project reads always go through the normal permission prompt unless the user explicitly allows them (config rule, "always" approval, or `/yolo`).

---

## What is *not* containerized

- **The agent process itself** — model calls, MCP servers, file reads via `Read` tool (those use Node's `fs`, not bash), git operations done via the CLI agent's own internal git module rather than shelling out, etc.
- **The TUI** — runs on the host.
- **Reads through `Read`/`Glob`/`Grep` tools** — these go through host-side fs APIs against the cwd. In `mount` mode they read the same files the container sees. In `copy` mode they read the *temp copy* (because the instance directory is the copy), so they stay consistent with what tools see. **Reads outside the instance directory are gated by the `external_directory` permission** — they prompt the user (or fail per config) just like in `off` mode, regardless of container state.
- **Network operations done by the model itself** (web search, MCP HTTP calls) — those happen in the host process.

So the boundary is exactly: **anything spawned via shell/background → containerized; everything else → host.**

---

## Known limitations / footguns

1. **`mount` mode shares your project bidirectionally.** A malicious tool call inside the container can still `rm -rf /workspace/.git` because `/workspace` is your real cwd. Container blocks the rest of your filesystem; it does not block the project itself. Use `copy` if that matters.
2. **Default network = none** is good for safety but breaks tools that legitimately need network (`npm install`, `pip install`, `curl docs.example.com`). Set `container.network = "bridge"` in config when needed.
3. **Windows runs the container as `root` inside Alpine** (host UID mapping is Linux-only). Files created in `/workspace` show up on the Windows host owned by your Windows user (filesystem driver-managed), but inside the container they're root-owned. Ownership-sensitive scripts may behave differently than on Linux/macOS.
4. **The container has no host shell** — it's `node:22-alpine`. No `bash`, no `zsh`, no `make`, no `git` (until you `apk add`). The shell wrapper invokes `sh -lc`, so `sh` works. If you need richer tooling, use a custom image: `--container-image my/opencode-dev:latest`.
5. **Pre-boot is silent on failure.** If Docker isn't running, the TUI continues without a sandbox. The log line `container runtime failed to start; continuing without sandbox` is your only signal in the current code.
6. **Copy mode persists a temp dir at `~/.local/share/opencode/container/<sessionID>/workspace`** for the session. If the TUI is killed ungracefully, `sweepStale()` removes the container next time, but the copy temp dir is only cleaned up by `runtime.destroy()` — orphaned dirs can accumulate after crashes. Manual cleanup of `~/.local/share/opencode/container/` is safe when no session is running.
7. **No automatic mode-switch.** Once the TUI starts in a mode, it stays in that mode until restart. There's no `/container mount` slash command.

---

## Quick reference

| Want… | Command |
|---|---|
| TUI in mount-mode container | `opencode --container mount` |
| TUI in copy-mode container | `opencode --container copy` |
| Custom image | `opencode --container mount --container-image python:3.12-slim` |
| Per-project default | put `container: { mode: "mount" }` in `opencode.json` |
| One-shot run inside container | `opencode --container mount run "your prompt"` |
| Verify container is active | `docker ps` on host (look for `opencode-<sessionID>-<ts>`) or run `uname -a` from inside the TUI |

---

## Config schema

In `opencode.json` (`packages/opencode/src/config/config.ts:286-317`):

```jsonc
{
  "container": {
    "mode": "off | mount | copy",        // execution sandbox mode
    "image": "node:22-alpine",            // docker image
    "network": "none | bridge | host",    // default "none"
    "memory": "2g",                       // docker --memory
    "cpus": "2",                          // docker --cpus
    "pids": 256,                          // PID limit inside the container
    "run_as_current_user": true,          // host uid/gid mapping (linux/mac)
    "exclude": [".env", "secrets/"]       // copy-mode sync exclusions
  }
}
```

CLI flags override the config; env vars (`OPENCODE_CONTAINER`, `OPENCODE_CONTAINER_IMAGE`) override both.

---

## Verification (2026-05-05 session)

Confirmed working as designed on Windows 11 with Docker Desktop / WSL2:

- Container ID: `a70009832eb0`
- Image: Alpine 3.23.4 (= `node:22-alpine` base)
- Kernel: `6.6.87.2-microsoft-standard-WSL2`
- User: `root` (expected on Windows host — UID mapping disabled)
- `/workspace` populated and writable from inside

The TUI ran on the Windows host; bash tool calls ran inside Alpine. Exactly the boundary the architecture is meant to enforce.

---

## File index

| Path | Role |
|---|---|
| `packages/opencode/src/container/index.ts` | Container namespace, `prepare()`, `Runtime`, mode dispatch |
| `packages/opencode/src/container/docker.ts` | Docker CLI wrapper: `available`, `ensureImage`, `runBackground`, `remove`, `sweepStale` |
| `packages/opencode/src/container/copy.ts` | `sync` / `diff` / `apply` / `cleanup` for copy mode |
| `packages/opencode/src/cli/cmd/tui/thread.ts` | `--container` / `--container-image` CLI flags |
| `packages/opencode/src/cli/cmd/tui/worker.ts` | `preBootContainer()`, instance caching, disposer registration |
| `packages/opencode/src/tool/shell.ts` | bash tool routing through `runtime.spawnArgs` |
| `packages/opencode/src/shell/background.ts` | long-running shell processes routed the same way |
| `packages/opencode/src/session/prompt.ts` | `sandboxRuleset()` permission auto-allow |
| `packages/opencode/src/config/config.ts` | `container.*` schema |
