import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { Effect, Layer, Schema, Context, Stream } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { errorMessage } from "@/util/error"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/core/process"
import path from "path"
<<<<<<< HEAD
import fs from "node:fs/promises"
import os from "node:os"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
=======
>>>>>>> upstream/dev
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import semver from "semver"
import { InstallationChannel, InstallationRepo, InstallationVersion } from "@opencode-ai/core/installation/version"
import { NpmConfig } from "@opencode-ai/core/npm-config"
import { InstallationEvent } from "@opencode-ai/schema/installation-event"

export type Method =
  | "curl"
  | "npm"
  | "yarn"
  | "pnpm"
  | "bun"
  | "brew"
  | "scoop"
  | "choco"
  | "github-release"
  | "unknown"

// Fork builds (channel `dev_ttk`) bypass package-manager detection and
// route `opencode upgrade` through a GitHub release on `InstallationRepo`
// instead. Both values are stamped at build time via Bun `--define`.
const FORK_CHANNEL = "dev_ttk"
const UPSTREAM_REPO_DEFAULT = "anomalyco/opencode"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = InstallationEvent

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = Schema.Struct({
  version: Schema.String,
  latest: Schema.String,
}).annotate({ identifier: "InstallationInfo" })
export type Info = Schema.Schema.Type<typeof Info>

export function userAgent(client = "cli") {
  return `opencode/${InstallationChannel}/${InstallationVersion}/${client}`
}

export const USER_AGENT = userAgent()

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {
  override get message() {
    return this.stderr
  }
}

// Response schemas for external version APIs
const GitHubReleaseAsset = Schema.Struct({
  name: Schema.String,
  browser_download_url: Schema.String,
})
type GitHubReleaseAsset = Schema.Schema.Type<typeof GitHubReleaseAsset>
const GitHubRelease = Schema.Struct({ tag_name: Schema.String })
const GitHubReleaseWithAssets = Schema.Struct({
  tag_name: Schema.String,
  assets: Schema.Array(GitHubReleaseAsset),
})
const NpmPackage = Schema.Struct({ version: Schema.String })
const BrewFormula = Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })
const BrewInfoV2 = Schema.Struct({
  formulae: Schema.Array(Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })),
})
const ChocoPackage = Schema.Struct({
  d: Schema.Struct({ results: Schema.Array(Schema.Struct({ Version: Schema.String })) }),
})
const ScoopManifest = NpmPackage

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Installation") {}

export const use = serviceUse(Service)

const layer: Layer.Layer<Service, never, HttpClient.HttpClient | AppProcess.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
    const appProcess = yield* AppProcess.Service

    const text = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return result.stdout.toString("utf8")
      },
      Effect.catch(() => Effect.succeed("")),
    )

    const run = Effect.fnUntraced(
      function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
        const result = yield* appProcess.run(
          ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          }),
        )
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      },
      Effect.catch((err) => Effect.succeed({ code: 1, stdout: "", stderr: errorMessage(err) })),
    )

    const getBrewFormula = Effect.fnUntraced(function* () {
      const tapFormula = yield* text(["brew", "list", "--formula", "anomalyco/tap/opencode"])
      if (tapFormula.includes("opencode")) return "anomalyco/tap/opencode"
      const coreFormula = yield* text(["brew", "list", "--formula", "opencode"])
      if (coreFormula.includes("opencode")) return "opencode"
      return "opencode"
    })

<<<<<<< HEAD
      const upgradeGithubRelease = Effect.fnUntraced(
        function* (target: string) {
          const platform = process.platform === "win32" ? "windows" : process.platform
          const arch = process.arch === "x64" ? "x64" : process.arch
          const assetName = `opencode-${platform}-${arch}.zip`

          const release = yield* httpOk.execute(
            HttpClientRequest.get(`https://api.github.com/repos/${InstallationRepo}/releases/tags/v${target}`).pipe(
              HttpClientRequest.acceptJson,
            ),
          )
          const releaseData = yield* HttpClientResponse.schemaBodyJson(GitHubReleaseWithAssets)(release)
          const asset: GitHubReleaseAsset | undefined = releaseData.assets.find(
            (a: GitHubReleaseAsset) => a.name === assetName,
          )
          if (!asset) {
            return {
              code: ChildProcessSpawner.ExitCode(1),
              stdout: "",
              stderr: `Asset ${assetName} not found in ${InstallationRepo} release v${target}`,
            }
          }

          const zipResponse = yield* httpOk.execute(HttpClientRequest.get(asset.browser_download_url))
          const zipBytes = yield* zipResponse.arrayBuffer

          // installRoot is the directory that contains `bin/`. process.execPath
          // points at <installRoot>/bin/opencode(.exe), so two `dirname`s up.
          const installRoot = path.dirname(path.dirname(process.execPath))
          const isWindows = process.platform === "win32"

          // Filesystem operations route their failures to a result object
          // (success channel) rather than the Effect error channel — the
          // outer `Effect.orDie` would otherwise turn a transient
          // mkdtemp/writeFile failure into a stack trace, when the caller
          // is set up to format `{code, stderr}` into a clean
          // UpgradeFailedError.
          //
          // Windows pre-step: the running .exe is locked against in-place
          // overwrite, but Win32 MoveFile (fs.rename) is allowed for a
          // running binary. Side-step the lock by renaming the old binary
          // out of the way so the extractor can drop the new exe at the
          // original path. Rolled back on extraction failure (see below).
          // Stale .old-* artefacts from prior upgrades are cleaned best-
          // effort here; locked ones will linger until the next upgrade
          // clears them.
          const fsResult = yield* Effect.promise(async () => {
            let tmpDir: string | undefined
            try {
              tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-upgrade-"))
              const zipPath = path.join(tmpDir, assetName)
              await fs.writeFile(zipPath, Buffer.from(zipBytes))

              let stepAside: string | undefined
              if (isWindows) {
                const binDir = path.dirname(process.execPath)
                try {
                  for (const name of await fs.readdir(binDir)) {
                    if (!name.includes(".old-")) continue
                    await fs.rm(path.join(binDir, name), { force: true }).catch(() => {})
                  }
                } catch {
                  // bin dir missing or unreadable — nothing to clean
                }
                try {
                  stepAside = `${process.execPath}.old-${Date.now()}`
                  await fs.rename(process.execPath, stepAside)
                } catch (e) {
                  return {
                    ok: false as const,
                    code: ChildProcessSpawner.ExitCode(1),
                    stdout: "",
                    stderr: `Could not move running binary out of the way at ${process.execPath}: ${e instanceof Error ? e.message : String(e)}`,
                  }
                }
              }

              return { ok: true as const, tmpDir, zipPath, stepAside }
            } catch (e) {
              if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
              return {
                ok: false as const,
                code: ChildProcessSpawner.ExitCode(1),
                stdout: "",
                stderr: `Failed to stage upgrade archive: ${e}`,
              }
            }
          })
          if (!fsResult.ok) return fsResult

          // Use platform-native unzip into the install root.
          //
          // Embedded single quotes inside a single-quoted PowerShell
          // string need to be doubled (`'` → `''`). Paths that contain
          // an apostrophe (e.g. `O'Connor`'s home directory) would
          // otherwise break the quoting — and worse, allow injected
          // tokens to be parsed as PowerShell.
          //
          // Expand-Archive emits non-terminating errors by default, so a
          // locked file silently exits 0. Force any error to terminate
          // with a non-zero exit code.
          const psQuote = (s: string) => s.replace(/'/g, "''")
          const cmdArgs = isWindows
            ? [
                "powershell",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `$ErrorActionPreference='Stop'; try { Expand-Archive -LiteralPath '${psQuote(fsResult.zipPath)}' -DestinationPath '${psQuote(installRoot)}' -Force } catch { Write-Error ($_ | Out-String); exit 1 }`,
              ]
            : ["unzip", "-o", fsResult.zipPath, "-d", installRoot]

          const result = yield* run(cmdArgs)
          yield* Effect.promise(() => fs.rm(fsResult.tmpDir, { recursive: true, force: true }).catch(() => {}))

          // Verify the new binary actually landed. If the extractor exited 0
          // without writing to process.execPath (e.g. archive shape changed,
          // or zip rooted differently), the user would otherwise see a
          // success message and the wrong version still installed.
          const replaced =
            result.code === 0
              ? yield* Effect.promise(() =>
                  fs
                    .access(process.execPath)
                    .then(() => true)
                    .catch(() => false),
                )
              : false

          // Roll back on Windows if extraction failed or the binary is
          // missing — otherwise the user is left with no opencode at all.
          if (isWindows && fsResult.stepAside && (result.code !== 0 || !replaced)) {
            yield* Effect.promise(() =>
              fs.rename(fsResult.stepAside!, process.execPath).catch(() => {
                // Rollback failed — leave the .old-* file in place so the
                // user can recover manually. The error from the extractor
                // is the more useful message to surface.
              }),
            )
          }

          if (result.code !== 0) {
            const hint =
              isWindows && /denied|in use|busy/i.test(result.stderr)
                ? " (another opencode process may be locking the file — close other TUI sessions and retry)"
                : ""
            return { code: result.code, stdout: result.stdout, stderr: result.stderr + hint }
          }

          if (!replaced) {
            return {
              code: ChildProcessSpawner.ExitCode(1),
              stdout: result.stdout,
              stderr: `Upgrade archive extracted but ${process.execPath} is missing — extraction may have silently failed.`,
            }
          }

          return result
        },
        Effect.scoped,
        Effect.orDie,
      )

      const upgradeCurl = Effect.fnUntraced(
        function* (target: string) {
          const response = yield* httpOk.execute(HttpClientRequest.get("https://opencode.ai/install"))
          const body = yield* response.text
          const bodyBytes = new TextEncoder().encode(body)
          const proc = ChildProcess.make("bash", [], {
=======
    const upgradeFailure = (method: Method, result?: { code: number; stdout: string; stderr: string }) => {
      if (method === "choco") return "not running from an elevated command shell"
      if (result) return `Upgrade failed for ${method} (exit code ${result.code}).`
      return `Upgrade failed for ${method}.`
    }

    const upgradeScriptShell = Effect.fnUntraced(function* () {
      const bashVersion = yield* text(["bash", "--version"])
      if (bashVersion) return "bash"
      return "sh"
    })

    const upgradeCurl = Effect.fnUntraced(
      function* (target: string) {
        const response = yield* httpOk.execute(HttpClientRequest.get("https://opencode.ai/install"))
        const body = yield* response.text
        const bodyBytes = new TextEncoder().encode(body)
        const shell = yield* upgradeScriptShell()
        const result = yield* appProcess.run(
          ChildProcess.make(shell, [], {
>>>>>>> upstream/dev
            stdin: Stream.make(bodyBytes),
            env: { VERSION: target },
            extendEnv: true,
          }),
        )
        return {
          code: result.exitCode,
          stdout: result.stdout.toString("utf8"),
          stderr: result.stderr.toString("utf8"),
        }
      },
      Effect.mapError(() => new UpgradeFailedError({ stderr: upgradeFailure("curl") })),
    )

    const result: Interface = {
      info: Effect.fn("Installation.info")(function* () {
        return {
          version: InstallationVersion,
          latest: yield* result.latest(),
        }
      }),
      method: Effect.fn("Installation.method")(function* () {
        if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl" as Method
        if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
        const exec = process.execPath.toLowerCase()

        const checks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
          { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
          { name: "yarn", command: () => text(["yarn", "global", "list"]) },
          { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
          { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
          { name: "brew", command: () => text(["brew", "list", "--formula", "opencode"]) },
          { name: "scoop", command: () => text(["scoop", "list", "opencode"]) },
          { name: "choco", command: () => text(["choco", "list", "--limit-output", "opencode"]) },
        ]

        checks.sort((a, b) => {
          const aMatches = exec.includes(a.name)
          const bMatches = exec.includes(b.name)
          if (aMatches && !bMatches) return -1
          if (!aMatches && bMatches) return 1
          return 0
        })

        for (const check of checks) {
          const output = yield* check.command()
          const installedName =
            check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "opencode" : "opencode-ai"
          if (output.includes(installedName)) {
            return check.name
          }
<<<<<<< HEAD
        }),
        method: Effect.fn("Installation.method")(function* () {
          // Fork builds publish a single GitHub release with a platform zip
          // — bypass package-manager detection and route upgrade through it.
          //
          // Refuse to activate if the build forgot to stamp OPENCODE_REPO:
          // a dev_ttk channel pointed at the upstream repo would silently
          // overwrite the fork install with upstream's binary on the next
          // upgrade. Treating this as `unknown` disables auto-upgrade and
          // surfaces a log line; the build pipeline must set both
          // OPENCODE_CHANNEL and OPENCODE_REPO together.
          if (InstallationChannel === FORK_CHANNEL) {
            if (InstallationRepo === UPSTREAM_REPO_DEFAULT) {
              log.warn("fork-channel build is missing OPENCODE_REPO stamp; auto-upgrade disabled", {
                channel: InstallationChannel,
                repo: InstallationRepo,
              })
              return "unknown" as Method
            }
            return "github-release" as Method
          }
          if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl" as Method
          if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
          const exec = process.execPath.toLowerCase()
=======
        }
>>>>>>> upstream/dev

        return "unknown" as Method
      }),
      latest: Effect.fn("Installation.latest")(function* (installMethod?: Method) {
        const detectedMethod = installMethod || (yield* result.method())

        if (detectedMethod === "brew") {
          const formula = yield* getBrewFormula()
          if (formula.includes("/")) {
            const infoJson = yield* text(["brew", "info", "--json=v2", formula])
            const info = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BrewInfoV2))(infoJson)
            return info.formulae[0].versions.stable
          }
          const response = yield* httpOk.execute(
<<<<<<< HEAD
            HttpClientRequest.get(`https://api.github.com/repos/${InstallationRepo}/releases/latest`).pipe(
              HttpClientRequest.acceptJson,
            ),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response)
          return data.tag_name.replace(/^v/, "")
        }, Effect.orDie),
        upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
          let upgradeResult: { code: ChildProcessSpawner.ExitCode; stdout: string; stderr: string } | undefined
          switch (m) {
            case "curl":
              upgradeResult = yield* upgradeCurl(target)
              break
            case "github-release":
              upgradeResult = yield* upgradeGithubRelease(target)
              break
            case "npm":
              upgradeResult = yield* run(["npm", "install", "-g", `opencode-ai@${target}`])
              break
            case "pnpm":
              upgradeResult = yield* run(["pnpm", "install", "-g", `opencode-ai@${target}`])
              break
            case "bun":
              upgradeResult = yield* run(["bun", "install", "-g", `opencode-ai@${target}`])
              break
            case "brew": {
              const formula = yield* getBrewFormula()
              const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
              if (formula.includes("/")) {
                const tap = yield* run(["brew", "tap", "anomalyco/tap"], { env })
                if (tap.code !== 0) {
                  upgradeResult = tap
=======
            HttpClientRequest.get("https://formulae.brew.sh/api/formula/opencode.json").pipe(
              HttpClientRequest.acceptJson,
            ),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(BrewFormula)(response)
          return data.versions.stable
        }

        if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
          const response = yield* httpOk.execute(
            HttpClientRequest.get(
              `${yield* NpmConfig.registry(process.cwd())}/opencode-ai/${InstallationChannel}`,
            ).pipe(HttpClientRequest.acceptJson),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
          return data.version
        }

        if (detectedMethod === "choco") {
          const response = yield* httpOk.execute(
            HttpClientRequest.get(
              "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27opencode%27%20and%20IsLatestVersion&$select=Version",
            ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json;odata=verbose" })),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(ChocoPackage)(response)
          return data.d.results[0].Version
        }

        if (detectedMethod === "scoop") {
          const response = yield* httpOk.execute(
            HttpClientRequest.get(
              "https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/opencode.json",
            ).pipe(HttpClientRequest.setHeaders({ Accept: "application/json" })),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(ScoopManifest)(response)
          return data.version
        }

        const response = yield* httpOk.execute(
          HttpClientRequest.get("https://api.github.com/repos/anomalyco/opencode/releases/latest").pipe(
            HttpClientRequest.acceptJson,
          ),
        )
        const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response)
        return data.tag_name.replace(/^v/, "")
      }, Effect.orDie),
      upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
        let upgradeResult: { code: number; stdout: string; stderr: string } | undefined
        switch (m) {
          case "curl":
            upgradeResult = yield* upgradeCurl(target)
            break
          case "npm":
            upgradeResult = yield* run(["npm", "install", "-g", `opencode-ai@${target}`])
            break
          case "pnpm":
            upgradeResult = yield* run(["pnpm", "install", "-g", `opencode-ai@${target}`])
            break
          case "bun":
            upgradeResult = yield* run(["bun", "install", "-g", `opencode-ai@${target}`])
            break
          case "brew": {
            const formula = yield* getBrewFormula()
            const env = { HOMEBREW_NO_AUTO_UPDATE: "1" }
            if (formula.includes("/")) {
              const tap = yield* run(["brew", "tap", "anomalyco/tap"], { env })
              if (tap.code !== 0) {
                upgradeResult = tap
                break
              }
              const repo = yield* text(["brew", "--repo", "anomalyco/tap"])
              const dir = repo.trim()
              if (dir) {
                const pull = yield* run(["git", "pull", "--ff-only"], { cwd: dir, env })
                if (pull.code !== 0) {
                  upgradeResult = pull
>>>>>>> upstream/dev
                  break
                }
              }
            }
            upgradeResult = yield* run(["brew", "upgrade", formula], { env })
            break
          }
          case "choco":
            upgradeResult = yield* run(["choco", "upgrade", "opencode", `--version=${target}`, "-y"])
            break
          case "scoop":
            upgradeResult = yield* run(["scoop", "install", `opencode@${target}`])
            break
          default:
            return yield* new UpgradeFailedError({ stderr: `Unknown installation method: ${m}` })
        }
        if (!upgradeResult || upgradeResult.code !== 0) {
          return yield* new UpgradeFailedError({ stderr: upgradeFailure(m, upgradeResult) })
        }
        yield* Effect.logInfo("upgraded", {
          method: m,
          target,
          stdout: upgradeResult.stdout,
          stderr: upgradeResult.stderr,
        })
        yield* text([process.execPath, "--version"])
      }),
    }

    return Service.of(result)
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [httpClient, AppProcess.node] })

const { runPromise } = makeRuntime(Service, AppNodeBuilder.build(node))

export const latest = (...args: Parameters<Interface["latest"]>) => runPromise((s) => s.latest(...args))
export const method = () => runPromise((s) => s.method())
export const upgrade = (...args: Parameters<Interface["upgrade"]>) => runPromise((s) => s.upgrade(...args))

export * as Installation from "."
