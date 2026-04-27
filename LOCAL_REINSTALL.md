# Local Reinstall Guide

How to rebuild local opencode and apply changes to the global `opencode` command.

## One-time setup

The global `opencode` command is installed via a symlinked local build:

```bash
cd C:/Users/tte/Projects/opencode
OPENCODE_VERSION=1.14.28-dev_ttk OPENCODE_CHANNEL=dev_ttk OPENCODE_REPO=TTK95/opencode bun run build --single
npm install -g packages/opencode/dist/opencode-windows-x64
```

`npm install -g <local-dir>` creates a **symlink** at `~/AppData/Roaming/npm/node_modules/opencode-windows-x64`, so every rebuild propagates automatically — no reinstall needed after the first time.

## Day-to-day: applying changes

After editing source:

```bash
cd C:/Users/tte/Projects/opencode
OPENCODE_VERSION=1.14.28-dev_ttk OPENCODE_CHANNEL=dev_ttk OPENCODE_REPO=TTK95/opencode bun run build --single
```

Close any running opencode TUI sessions and launch a fresh one. The symlink points at `dist/`, so the new binary is picked up automatically.

## Gotcha: nested package shadowing

The global wrapper is a Node dispatcher at `~/AppData/Roaming/npm/node_modules/opencode-ai/bin/opencode`. Its `findBinary` walks up `node_modules` folders and uses the **first** match.

If `opencode-ai` was ever installed from npm, it pulls in its own nested `opencode-windows-x64` (and `-baseline`) copies under `opencode-ai/node_modules/`. Those shadow the top-level symlink and get served instead — you'll rebuild, reinstall, and see stale behavior.

Fix: delete the nested copies.

```bash
rm -rf "/c/Users/tte/AppData/Roaming/npm/node_modules/opencode-ai/node_modules/opencode-windows-x64"
rm -rf "/c/Users/tte/AppData/Roaming/npm/node_modules/opencode-ai/node_modules/opencode-windows-x64-baseline"
```

Do this whenever `opencode-ai` is reinstalled from npm.

## Verifying a fresh launch uses the new binary

```powershell
Get-Process opencode | Select-Object Id, StartTime, Path
```

`Path` should be `...\npm\node_modules\opencode-windows-x64\bin\opencode.exe` — no `opencode-ai\node_modules\` segment. Old TUI sessions keep their original `Path` in memory even after the file is deleted, so only trust fresh processes.

## Escape hatch

For zero-friction iteration, set a persistent env var — the dispatcher short-circuits to it:

```
OPENCODE_BIN_PATH=C:\Users\tte\Projects\opencode\packages\opencode\dist\opencode-windows-x64\bin\opencode.exe
```

Bypasses the `findBinary` walk entirely. Unset it if you ever want to test the real resolution path.

## Why `OPENCODE_CHANNEL=dev_ttk` and `OPENCODE_REPO=TTK95/opencode`

Stamping `OPENCODE_CHANNEL=dev_ttk` at build time tells the in-app upgrade flow (`opencode upgrade`, the TUI "update available" toast) to route through the fork-specific `github-release` install method instead of npm/`opencode-ai`. `OPENCODE_REPO` overrides the hardcoded upstream repo so `Installation.latest()` queries `https://api.github.com/repos/TTK95/opencode/releases/latest`. Both default to upstream values (`local` channel + `anomalyco/opencode`) when unset, so existing builds are unaffected.

The release pipeline (`.github/workflows/release-fork.yml`) sets these automatically when publishing.
