# Plan: Auto-sync upstream + fork self-update (Option 2)

## Context

Two related-but-separate goals on one feature branch:

1. **Auto-sync upstream** — pull `anomalyco/opencode@dev` into this fork on a schedule, opening a PR for review. *Already implemented* on this branch as `.github/workflows/sync-upstream.yml`.
2. **Fork self-update** — make `opencode upgrade` (and the in-TUI "update available" toast) work on this fork. Today the upgrade code is hardcoded against `anomalyco/opencode` releases and `opencode-ai` on npm — neither exists for this fork. We want the same UX as upstream, but pointed at `TTK95/opencode`'s releases.

This document covers item 2.

## What `opencode upgrade` does today

`packages/opencode/src/cli/upgrade.ts` runs `Installation.latest()` then `Installation.upgrade(method, target)`.

`packages/opencode/src/installation/index.ts:173` — `Installation.method()` walks well-known package managers (`npm`, `bun`, `brew`, `scoop`, `choco`, …) looking for the install. It also short-circuits to `"curl"` if `process.execPath` contains `.opencode/bin` or `.local/bin`. Returns `"unknown"` otherwise.

`Installation.latest()` (line 207) is hardcoded:
- `npm`/`bun`/`pnpm` → `https://registry.npmjs.org/opencode-ai/<channel>` (line 226)
- `curl`/everything else → `https://api.github.com/repos/anomalyco/opencode/releases/latest` (line 257)

`Installation.upgrade()` (line 264):
- `npm` → `npm install -g opencode-ai@<target>`
- `curl` → pipes `https://opencode.ai/install` through `bash` with `VERSION=<target>` (line 144)
- others → package-manager-native commands

`InstallationVersion` and `InstallationChannel` (in `packages/core/src/installation/version.ts`) are stamped at build time via Bun `--define` in `packages/opencode/script/build.ts:215-220`. `Script.channel` (in `packages/script/src/index.ts:60`) reads from current git branch (`dev`, `beta`, `latest`, …).

## Local install reality

You run from `~/AppData/Roaming/npm/node_modules/opencode-windows-x64/bin/opencode.exe`, a symlink created by `npm install -g packages/opencode/dist/opencode-windows-x64` (per `LOCAL_REINSTALL.md`). The npm-installed *package name* is `opencode-windows-x64`, not `opencode-ai` — so today `Installation.method()` falls through every check and returns `"unknown"`. `opencode upgrade` already does nothing on this fork.

## Design

Three things to add. All gated on `OPENCODE_CHANNEL === "dev_ttk"` so upstream behavior is untouched when stamped with a normal channel.

### 1. Configurable upstream + fork channel detection

- **`packages/opencode/src/installation/index.ts`**
  - Read `OPENCODE_REPO` (default `anomalyco/opencode`) instead of hardcoding the URL on line 257. Use it everywhere a GitHub repo path is referenced (release URL, install script URL).
  - Add a new branch in `Installation.method()` *before* the existing checks:
    ```ts
    if (InstallationChannel === "dev_ttk") return "github-release" as Method
    ```
  - Add `"github-release"` to the `Method` union (line 18).
  - Add a `case "github-release":` branch in `Installation.latest()` that hits `https://api.github.com/repos/${OPENCODE_REPO}/releases/latest` and returns `tag_name.replace(/^v/, "")`.
  - Add a `case "github-release":` branch in `Installation.upgrade()` that downloads `opencode-windows-x64.zip` (or the platform-appropriate asset) from the matching release tag and extracts it over the running install dir.
- **`packages/opencode/script/build.ts`**
  - Pass `OPENCODE_CHANNEL=dev_ttk` (overriding the git-branch default from `Script.channel`) when the build is for the fork. Simplest: an env-var override in `packages/script/src/index.ts` that picks up `OPENCODE_CHANNEL` from `process.env`. The fork's release workflow (and `LOCAL_REINSTALL.md` build command) sets it.

### 2. Upgrade implementation for `github-release` method

The fork doesn't have signed binaries, MSI installers, or an npm package — just a GitHub release with the windows-x64 binary as a zip asset. The upgrade flow:

1. `GET https://api.github.com/repos/${OPENCODE_REPO}/releases/tags/v${target}` → resolve the asset URL for `opencode-windows-x64.zip` (or `opencode-darwin-arm64.zip` etc., based on `process.platform` / `process.arch`).
2. `GET <asset URL>` → write to `<install-dir>/opencode-update.zip`. Install dir = `path.dirname(path.dirname(process.execPath))`, e.g. `~/AppData/Roaming/npm/node_modules/opencode-windows-x64/`.
3. Extract zip into install dir (overwrite `bin/opencode.exe`). On Windows the running `.exe` is locked — Windows allows *replacing* a running file via `MoveFileEx` rename-on-reboot only with admin, so the realistic flow is: write `bin/opencode.exe.new`, prompt user to relaunch, swap on next start. Or: detect `EBUSY`, surface a clear message asking the user to exit running TUI sessions and re-run upgrade.
4. Emit `Installation.Event.Updated`.

### 3. Build + publish workflow

New `.github/workflows/release-fork.yml`:

- Triggers: `push: branches: [dev]` *and* `workflow_dispatch`.
- Reads `packages/opencode/package.json` version (already `<upstream>-dev_ttk` after the auto-sync workflow lands its PR).
- If a release tag `v<version>` already exists, exit (no-op — typical case when the push didn't bump the version).
- Otherwise:
  1. Sets up Bun.
  2. Runs `OPENCODE_VERSION=<version> OPENCODE_CHANNEL=dev_ttk OPENCODE_REPO=TTK95/opencode bun run --cwd packages/opencode build --single` — produces `packages/opencode/dist/opencode-windows-x64/`.
  3. Zips `dist/opencode-windows-x64/bin/*` into `opencode-windows-x64.zip`.
  4. Creates GitHub release tagged `v<version>` with the zip attached. Use `gh release create` with default `GITHUB_TOKEN` — no signing certs needed for a personal fork.
- Skips macOS/Linux for now (you only run Windows). Add later if needed.

Trade-off: only one platform → narrower scope, faster CI, no Apple/Azure secrets to wire up. Adding more platforms later is a matrix expansion.

### Version comparison sanity-check

`semver.major("1.14.28-dev_ttk") === 1`, `semver.minor === 14`. Existing `getReleaseType()` (line 37) already uses `semver.major/minor`, so it correctly classifies `1.14.27-dev_ttk` → `1.14.28-dev_ttk` as a `"patch"`. No change needed.

`InstallationVersion === latest` string comparison in `upgrade.ts:20` works because both sides will be `1.14.28-dev_ttk` (same stamping rules on both build pipelines).

### Auto-update settings

The existing `config.autoupdate` setting (`true` | `false` | `"notify"`) and `OPENCODE_DISABLE_AUTOUPDATE` flag already gate the upgrade flow. Patches above don't touch any of that — same UX, different remote.

## Files to modify / create

**Modify:**
- `packages/opencode/src/installation/index.ts` — config repo, add `github-release` method
- `packages/opencode/script/build.ts` (or `packages/script/src/index.ts`) — honor `OPENCODE_CHANNEL` env override
- `LOCAL_REINSTALL.md` — document `OPENCODE_CHANNEL=dev_ttk` in the build command

**Create:**
- `.github/workflows/release-fork.yml` — build + publish dev_ttk releases

**Untouched (intentionally):**
- `Installation.method()` checks for `npm`/`brew`/etc. — left in place; `dev_ttk` short-circuits before them.
- All upstream upgrade methods — unchanged.

## Verification

1. **Local build with new channel:**
   ```bash
   OPENCODE_VERSION=1.14.28-dev_ttk OPENCODE_CHANNEL=dev_ttk \
     bun run --cwd packages/opencode build --single
   ```
   Then `dist/opencode-windows-x64/bin/opencode --version` should print `1.14.28-dev_ttk` and `dist/.../bin/opencode` invoking `Installation.method()` returns `"github-release"`.

2. **Workflow dry run:** push a no-op commit to a throwaway branch with `release-fork.yml` adapted to that branch, confirm a release with the zip asset is created.

3. **End-to-end:** with the published `v1.14.28-dev_ttk` release in place, install an *older* fork build locally (e.g. tag a `v1.14.26-dev_ttk` build first), then run `opencode upgrade` and watch it pull the newer zip and prompt for restart.

4. **Negative case:** when channel is not `dev_ttk` (e.g. running an upstream build), every upstream codepath should be unchanged. Run `bun test packages/opencode/test/installation/installation.test.ts` to check.

## Out of scope

- macOS/Linux fork builds (single-platform first; matrix later if needed).
- Code signing for Windows (SmartScreen warning is acceptable for a personal fork; revisit if you ever distribute).
- npm publishing of a fork-named package (`@ttk/opencode-ai` or similar) — the GitHub release path is enough.
- Replacing the running `.exe` *without* a restart prompt — Windows file-locking makes this not worth the complexity.
