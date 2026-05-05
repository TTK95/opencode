# Installing the Fork (`TTK95/opencode`)

How to install the fork-channel build of opencode (`OPENCODE_CHANNEL=dev_ttk`).
Covers **Windows** (validated) and **Linux** (untested — source build only).

> **Note**: macOS is not covered. The release pipeline today only builds `windows-x64`; Linux works in principle from source but is unverified by the maintainer.
> Generated 2026-05-05 against `dev` @ `e9f49205f` (opencode `1.14.41-dev_ttk`).

---

## What you get from the fork

This fork sits on top of upstream `anomalyco/opencode` and adds:

- **Container sandbox** (`--container mount|copy`) — see [`opencode-container-mode.md`](./opencode-container-mode.md)
- **Tailscale integration** (`opencode tailscale`)
- **Self-update** via GitHub releases (`opencode upgrade --method github-release`)
- A few smaller convenience patches catalogued in [`CUSTOM_FEATURES.md`](../CUSTOM_FEATURES.md)

The fork channel is `dev_ttk`. Its in-app upgrade flow pulls from `https://github.com/TTK95/opencode/releases/latest`, **not** npm or `anomalyco/opencode`.

---

## Prerequisites

### Required for all platforms

- **Disk**: ~250 MB free for the unpacked binary.
- **Network**: ability to reach `github.com` (for downloads) and `api.github.com` (for the in-app upgrade flow's release-metadata query).
- **A 64-bit x86 CPU** — only `x64` is published today. ARM64 is built by the script but not released.
- **AVX2**: the published binary is the AVX2 variant. CPUs without AVX2 (very old Intel, some low-end laptops) cannot run it; you'd need to build the `-baseline` variant from source.

### Optional

- **Docker** — only required if you want to use the container sandbox. See the prerequisite section in [`opencode-container-mode.md`](./opencode-container-mode.md#prerequisites).
- **Bun ≥ 1.3** — required only for source builds (Linux, custom Windows builds).

### Required to build from source (Linux)

- **Bun ≥ 1.3** — `curl -fsSL https://bun.sh/install | bash`
- **Node ≥ 22** — needed by some workspace tooling
- **Git** — to clone the repo
- **Build essentials** — `gcc`, `make`, basic POSIX toolchain (`apt install build-essential` on Debian/Ubuntu, equivalent elsewhere)

---

## Windows (recommended path: GitHub release)

Validated under **Windows 11** with `npm`-global install. Run all commands in PowerShell unless noted.

### 1. Verify the prerequisite tooling

```powershell
node --version    # any recent LTS works for the launcher
npm --version
```

If `node`/`npm` aren't installed, get them from <https://nodejs.org/> (LTS installer) — they're only needed because the launcher is a Node dispatcher.

### 2. Download the latest fork release

```powershell
$ver = (Invoke-RestMethod https://api.github.com/repos/TTK95/opencode/releases/latest).tag_name
$url = "https://github.com/TTK95/opencode/releases/download/$ver/opencode-windows-x64.zip"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\opencode-windows-x64.zip"
```

### 3. Install into the npm global tree

The fork uses the same launcher convention as upstream: a Node shim (`opencode-ai/bin/opencode`) finds the platform binary under `node_modules/opencode-windows-x64/bin/`.

```powershell
# Make sure the launcher (`opencode-ai`) is present
npm install -g opencode-ai@latest

# Replace the platform binary with the fork build
$dst = "$env:APPDATA\npm\node_modules\opencode-windows-x64\bin"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Expand-Archive -Path "$env:TEMP\opencode-windows-x64.zip" -DestinationPath "$dst\.." -Force
```

`Expand-Archive` writes the archive's `bin/` directory into `...\opencode-windows-x64\`, replacing `bin\opencode.exe`.

### 4. Verify

```powershell
opencode --version
# expect:  1.14.41-dev_ttk   (or whatever the latest fork release is)
```

If the version *doesn't* end in `-dev_ttk`, the launcher is finding a stale upstream binary. See **Troubleshooting** below.

### 5. Updating

Once you're on a fork release, in-app upgrade works:

```powershell
opencode upgrade --method github-release
```

This routes through the fork channel and pulls the next release from `TTK95/opencode/releases/latest`. The Windows-specific lock-file handling (rename-aside + post-verify) was fixed in `1.14.41`, so upgrades from that version forward replace the running binary cleanly.

> If a TUI session is running while you upgrade, close it first. The upgrade renames the running `.exe` aside before extracting; the running session keeps working until exit, but the next launch picks up the new build.

### 6. Uninstall

```powershell
npm uninstall -g opencode-ai
# Remove the platform binary if it lingers:
Remove-Item -Recurse -Force "$env:APPDATA\npm\node_modules\opencode-windows-x64"
```

### Alternative: build from source (Windows)

If you want to develop or test changes, see [`LOCAL_REINSTALL.md`](../LOCAL_REINSTALL.md) at the repo root — `bun run build --single` plus `npm install -g packages/opencode/dist/opencode-windows-x64`. Faster iteration than re-uploading via GitHub releases.

---

## Linux (untested — source build only)

> **Warning**: the fork is currently developed and used only on Windows. The release pipeline does **not** publish Linux artifacts. The path below builds from source. It works in principle (the build script targets `linux-x64`/`linux-arm64`/musl variants), but the maintainer has not verified it on actual Linux hosts. Expect rough edges.

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
# follow the printed instructions to add ~/.bun/bin to PATH
```

### 2. Clone the fork

```bash
git clone https://github.com/TTK95/opencode.git
cd opencode
git checkout dev   # the active fork branch
```

### 3. Install workspace dependencies

```bash
bun install
```

### 4. Build the host-platform binary

```bash
OPENCODE_VERSION=$(jq -r .version packages/opencode/package.json) \
OPENCODE_CHANNEL=dev_ttk \
OPENCODE_REPO=TTK95/opencode \
  bun run --cwd packages/opencode build --single
```

The `--single` flag builds only your current platform. Output:

- `packages/opencode/dist/opencode-linux-x64/bin/opencode`     (on x64)
- `packages/opencode/dist/opencode-linux-arm64/bin/opencode`   (on arm64)

> CPUs without AVX2 need the baseline variant. Add `--baseline` to the build command — produces `opencode-linux-x64-baseline/`. Check your CPU with `grep -m1 avx2 /proc/cpuinfo`.

### 5. Install globally

Two options.

**Option A — symlink under `npm` global** (parallel to the Windows flow):

```bash
npm install -g opencode-ai@latest                           # gets the launcher
npm install -g packages/opencode/dist/opencode-linux-x64    # symlinks platform bin
```

The launcher's `findBinary()` walks `node_modules/opencode-linux-x64/bin/` and picks up the symlink.

**Option B — drop the binary on `PATH` directly**:

```bash
sudo install -m 755 packages/opencode/dist/opencode-linux-x64/bin/opencode \
  /usr/local/bin/opencode
```

This bypasses the npm shim entirely. Faster, but means `opencode upgrade --method github-release` won't have a release to pull (because none is published for Linux yet). Updates require re-running the build.

### 6. Verify

```bash
opencode --version
# expect:  1.14.41-dev_ttk
```

### 7. Updating

- **Source-build path**: `git pull && bun install && bun run --cwd packages/opencode build --single`. Re-install (Option A or B above).
- **In-app upgrade (`opencode upgrade --method github-release`)**: **does not work on Linux today.** The fork release workflow (`.github/workflows/release-fork.yml`) only builds and publishes `windows-x64.zip`. The upgrade call will fail because no `linux-x64`/`linux-arm64` asset exists in the fork's GitHub releases.
  - To enable: extend the workflow's `runs-on` to `[windows-latest, ubuntu-latest, ubuntu-22.04-arm]` with a target matrix and add the same `Compress-Archive`/`tar`-equivalent steps for each. Out of scope for this guide.

### 8. Uninstall

If installed via Option A:

```bash
npm uninstall -g opencode-ai opencode-linux-x64
```

If installed via Option B:

```bash
sudo rm /usr/local/bin/opencode
```

Optionally remove the cloned repo: `rm -rf opencode`.

---

## Troubleshooting

### `opencode --version` shows an upstream version (no `-dev_ttk` suffix)

The launcher (`opencode-ai`'s Node dispatcher) is finding a stale binary before the fork build. Common causes:

1. **Nested `opencode-ai/node_modules/opencode-windows-x64`** shadowing the top-level platform package. Delete it:
   ```powershell
   # Windows
   Remove-Item -Recurse -Force "$env:APPDATA\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64"
   Remove-Item -Recurse -Force "$env:APPDATA\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64-baseline"
   ```
   ```bash
   # Linux
   rm -rf ~/.npm-global/lib/node_modules/opencode-ai/node_modules/opencode-linux-x64
   ```
2. **`OPENCODE_BIN_PATH` env var pointing at an old binary.** `echo $env:OPENCODE_BIN_PATH` (Win) or `echo $OPENCODE_BIN_PATH` (Linux) — unset if stale.
3. **Multiple `opencode` binaries on PATH.** `where opencode` (Win) / `which -a opencode` (Linux). Resolve so the npm-global one wins.

### `opencode upgrade --method github-release` reports success but version doesn't change (Windows)

Fixed in `1.14.41`. If you're on `1.14.40` or older fork builds, do **one** manual install per the steps above to get to `1.14.41`; future upgrades will work cleanly.

### Container mode silently runs without a sandbox

See the prerequisites section in [`opencode-container-mode.md`](./opencode-container-mode.md#prerequisites) — most likely Docker daemon isn't running or `docker info` exceeds the 5 s timeout.

### Linux: `bun install` fails

- Make sure you have `git`, `gcc`, and `make` available.
- The repo uses workspace catalogs and SST; some deep deps need a real C compiler.
- Don't use `npm install` at the repo root — the lockfile is `bun.lock`.

---

## Channel and repo overrides

Build-time env vars baked into the binary (set automatically by the release workflow):

| Var | Default | Effect |
|---|---|---|
| `OPENCODE_VERSION` | `package.json` version | Stamped into `--version` output |
| `OPENCODE_CHANNEL` | `local` | When set to `dev_ttk`, the in-app upgrade flow uses `github-release` and queries the fork repo |
| `OPENCODE_REPO` | `anomalyco/opencode` | Repo for `Installation.latest()` API calls |

Setting these manually for a custom build:

```bash
OPENCODE_VERSION=1.14.41-dev_ttk \
OPENCODE_CHANNEL=dev_ttk \
OPENCODE_REPO=TTK95/opencode \
  bun run --cwd packages/opencode build --single
```

Without them, your build will report itself as upstream and won't self-update via the fork releases.

---

## Reference

- Repo: <https://github.com/TTK95/opencode>
- Releases: <https://github.com/TTK95/opencode/releases>
- Source-build details (developer flow): [`LOCAL_REINSTALL.md`](../LOCAL_REINSTALL.md)
- Custom feature catalogue: [`CUSTOM_FEATURES.md`](../CUSTOM_FEATURES.md)
- Container mode docs: [`opencode-container-mode.md`](./opencode-container-mode.md)
