# Container-Modus — Funktionsweise

> Bericht über opencodes `--container`-Sandbox: Architektur, Modi, Sicherheits-Defaults, Lebenszyklus, Integration und Einschränkungen.
> Erstellt am 2026-05-05 gegen Fork-Branch `dev` @ `37d19919b` (opencode `1.14.41-dev_ttk`).

---

## Gesamtbild

Der Container-Modus führt **Shell-Tool-Aufrufe** in einem kurzlebigen Docker-Container aus. Der opencode-TUI-/Server-Prozess selbst bleibt auf dem Host; nur die Bash-/Edit-Arbeit wird per `docker exec` in die Sandbox verschoben. Damit erhältst du Eingrenzung, ohne Host-Integrationen (Terminal, Editor, Schriften, IME, Netzwerk, Auth — alles funktioniert weiterhin normal) zu verlieren.

```
┌────────────────────────────────────────────────────────────────────┐
│  HOST (Windows)                                                    │
│  ┌──────────────┐    ┌──────────────────────┐                      │
│  │ TUI-Prozess  │ ←→ │ opencode worker      │                      │
│  │ (Bun/Node)   │RPC │ (Server, Agent-Loop) │                      │
│  └──────────────┘    └──────────┬───────────┘                      │
│                                 │ docker exec                      │
│                                 ▼                                  │
│                       ┌──────────────────────┐                     │
│                       │ Alpine-Container     │                     │
│                       │ /workspace = cwd     │                     │
│                       │ network: none        │                     │
│                       │ caps: dropped        │                     │
│                       └──────────────────────┘                     │
└────────────────────────────────────────────────────────────────────┘
```

---

## Einstiegspunkt der Verdrahtung

CLI-Flags (`packages/opencode/src/cli/cmd/tui/thread.ts:121-129`):

- `--container off|mount|copy`
- `--container-image <docker-image>`

Beide werden in die Umgebungsvariablen `OPENCODE_CONTAINER` / `OPENCODE_CONTAINER_IMAGE` geschrieben, damit der Worker-Subprozess sie sieht.

Der TUI-Worker (`packages/opencode/src/cli/cmd/tui/worker.ts:58-98`) ruft `preBootContainer()` **bevor** der Server startet. Das macht:

1. Liest `OPENCODE_CONTAINER` über `Container.fromEnv()`.
2. Ruft `Container.prepare(sessionID, cwd, cfg)` auf — das ist der schwere Teil (Image-Pull, Container-Start).
3. Speichert die resultierende `Runtime` im `InstanceStore`, sodass jeder spätere `WithInstance.provide({directory: ...})`-Aufruf denselben Container wiederverwendet, statt pro Tool-Aufruf einen neuen zu starten.
4. Registriert einen Disposer, der `runtime.destroy()` (= `docker rm -f` + Temp-Cleanup) ausführt, wenn die Instance freigegeben wird (z. B. beim TUI-Exit).

---

## Die drei Modi

`packages/opencode/src/container/index.ts:14`:

| Modus | Was er macht | Wann sinnvoll |
|---|---|---|
| **off** (Default) | Kein Container. `localSpawnArgs()` führt Befehle auf dem Host aus. | Alltag, wenn du dem Projekt vertraust. |
| **mount** | Container mit cwd als Bind-Mount unter `/workspace`. Dateien werden **bidirektional** zwischen Host und Container geteilt. | Prozesse/Netzwerk sandboxen, Edits live im Projekt halten. |
| **copy** | Cwd wird per `Copy.sync` nach `~/.local/share/opencode/container/<sessionID>/workspace` kopiert und *dieser Pfad* gemountet. Das `directory` der Instance zeigt auf die Temp-Kopie. | Maximale Isolation: der Agent kann deine echten Projektdateien nicht anfassen. |

Der Copy-Modus stellt zusätzlich `Container.Copy.diff()` / `apply()` (`copy.ts:79-106`) bereit, sodass du Änderungen prüfen und selektiv ins Projekt zurückführen kannst — der Agent kann deine echten Dateien nicht eigenmächtig verändern.

Default-Ignores im `copy`-Modus: `.git`, `node_modules`, `.opencode`, `.DS_Store`, `.venv`, `__pycache__`, `dist`, `build`. Erweiterbar über `cfg.exclude`.

---

## Sicherheits-Defaults

`Container.DEFAULTS` (`index.ts:31-40`) und `Docker.runBackground` (`docker.ts:81-105`):

| Einstellung | Default | Was sie bewirkt |
|---|---|---|
| `network` | **`none`** | Kein Internet, kein LAN, kein Host-Loopback. `bridge` für normales Docker-NAT, `host` für volle Host-Vernetzung. |
| `--cap-drop ALL` | immer | Alle Linux-Capabilities entfernt (keine Raw-Sockets, kein Mount, kein Ptrace, kein Chroot, keine Kernel-Tweaks…). |
| `--security-opt no-new-privileges:true` | immer | suid-/sgid-Binaries können innen keine Rechte erlangen. |
| `memory` | `2g` | Hartes Speicherlimit. |
| `cpus` | `2` | CPU-Quote. |
| `pids` | `256` | Schutz vor Fork-Bomben. |
| `--user $UID:$GID` | nur Nicht-Windows | Im Container erstellte Dateien gehören dir, nicht root. (Auf Windows deaktiviert, weil der Host NT ist — der Container läuft innerhalb von Alpine als `root`.) |
| `--rm` | immer | Container-Disk wird beim Exit entfernt. |
| Labels | `opencode.session=<id>`, `opencode.mode=<mount\|copy>` | Werden von `sweepStale()` zum Aufräumen von Zombies abgestürzter Sessions verwendet. |

Der Container-Entrypoint ist `sh -c "sleep infinity"` — er macht nichts von sich aus und sitzt nur da. Sämtliche Arbeit läuft per `docker exec` vom Host aus.

---

## Umgebungsvariablen

`envArgs()` (`index.ts:117-126`) leitet deine Env in den Container weiter — überspringt aber eine kuratierte Menge, die die Befehlsauflösung brechen würde:

- **Pfad-bezogen**: `PATH`, `MANPATH`, `INFOPATH`, `LD_LIBRARY_PATH`, `DYLD_*`, `NODE_PATH`, `NODE_OPTIONS`
- **Shell/Identität**: `HOME`, `USER`, `LOGNAME`, `SHELL`, `PWD`, `OLDPWD`, `TMPDIR`/`TMP`/`TEMP`
- **Display/SSH**: `DISPLAY`, `WAYLAND_DISPLAY`, `SSH_AUTH_SOCK`, `SSH_*`, `XPC_*`
- **Per Präfix übersprungen**: `BASH_*`, `ZSH_*`, `NVM_*`, `FNM_*`, `VOLTA_*`, `PYENV_*`, `RBENV_*`, `XDG_*`, `__CF*`

Deine Tokens (`GITHUB_TOKEN`, `OPENAI_API_KEY` usw.) gelangen also **sehr wohl** hinein — der Container kann in deinem Namen mit externen Diensten reden. Deine Shell-rcfile- und Toolchain-Konfiguration nicht. Das ist Absicht: der Container ist eine Linux-Alpine-Box mit Linux-Tooling, keine Emulation deiner Dev-Shell.

---

## Workdir-Mapping

`mapContainerPath()` (`index.ts:66-76`) übersetzt Host-cwd → Container-Pfad. Sagt ein Tool „führe dies in `C:\Users\tte\Projects\opencode\packages\opencode` aus", berechnet der Wrapper den relativen Pfad zur Mount-Quelle und mappt ihn auf `/workspace/packages/opencode`. Wenn das Host-cwd das Mount-Wurzelverzeichnis verlässt, fällt er auf `/workspace` zurück und loggt eine Warnung — Dateien außerhalb des cwd sind für den Container schlicht unsichtbar, was so gewollt ist.

Pfadtrenner werden POSIX-konvertiert (`path.sep` → `/`), sodass Windows-Hosts transparent funktionieren.

---

## Lebenszyklus

```
TUI-Start
   │
   ▼
preBootContainer()
   │
   ├── Container.fromEnv()   ── liest OPENCODE_CONTAINER
   ├── Docker.available()    ── `docker info`-Ping mit 5 s Timeout
   ├── Docker.ensureImage()  ── inspect-then-pull
   ├── Docker.sweepStale()   ── Fire-and-forget-Cleanup von Containern abgestürzter Sessions (gefiltert nach Label `opencode.session`)
   ├── (Copy-Modus)          ── Copy.sync(hostDir → tempDir)
   ├── Docker.runBackground()── `docker run -d --rm ... sleep infinity`
   └── Instance gecached     ── WithInstance.provide speichert Runtime im InstanceStore

TUI führt N Tools aus
   │
   ├── shell.ts             ── Instance.current.container.spawnArgs(...)
   │                            → ["docker", "exec", "-w", workdir, "-e", env..., id, "sh", "-lc", cmd]
   ├── background.ts        ── gleiche Verdrahtung für lang laufende Shell-Prozesse
   └── bleibt im selben Container für die gesamte Session

TUI-Exit / Instance freigegeben
   │
   └── runtime.destroy()    ── docker rm -f + Copy.cleanup tempDir (Copy-Modus)
```

Wenn der Container nicht starten kann (kein Docker-Daemon, Image-Pull-Fehler usw.), loggt der Pre-Boot den Fehler und fällt auf Host-Ausführung zurück — die TUI **bricht nicht ab**. Wichtig zu wissen: ist Docker kaputt, läuft die TUI klammheimlich ohne Sandbox. Achte beim Start auf die Logzeile `container runtime ready`, wenn du sicher gehen willst.

---

## Wie Shell-Tools durch den Container geroutet werden

`packages/opencode/src/tool/shell.ts:293-298` und `packages/opencode/src/shell/background.ts:54-59` verwenden dasselbe Muster:

```ts
const runtime = Instance.current.container
const args = runtime.spawnArgs(shell, name, command, cwd, env)
const proc = spawn(...Container.toChildProcessCommand(args))   // oder toNodeSpawnOptions
```

Im `off`-Modus liefert `spawnArgs` ein normales lokales Spawn (inklusive Windows-PowerShell-Handling in `index.ts:135-141`). Im `mount`-/`copy`-Modus liefert es Argumente mit `docker exec`-Präfix. Die Tool-Schicht ist modus-agnostisch.

---

## Permission-Integration

`packages/opencode/src/session/prompt.ts:sandboxRuleset()` stellt `allow: *`-Regeln für `bash`, `edit` und `external_directory` voran, sobald `Instance.current.container.mode !== "off"`. Begründung: ist der Container Sandbox genug, addieren die Per-Tool-Permission-Prompts Reibung ohne zusätzliche Sicherheit — der Container *ist* die Sicherheit. Die Regeln werden vorangestellt (nicht angehängt), damit benutzerdefinierte Agent-/Session-Regeln später im Array über die `findLast()`-Semantik in `evaluate.ts` weiter überschreiben können. Ohne Container ändert sich das Verhalten nicht.

---

## Was *nicht* containerisiert wird

- **Der Agent-Prozess selbst** — Modell-Calls, MCP-Server, Datei-Reads via `Read`-Tool (verwenden Nodes `fs`, kein Bash), Git-Operationen über das interne Git-Modul des CLI-Agents statt Shell-Calls usw.
- **Die TUI** — läuft auf dem Host.
- **Reads via `Read`/`Glob`/`Grep`-Tool** — nutzen host-seitige fs-APIs gegen das cwd. Im `mount`-Modus lesen sie dieselben Dateien, die der Container sieht. Im `copy`-Modus lesen sie die *Temp-Kopie* (weil das Instance-Verzeichnis die Kopie ist), bleiben also konsistent zu dem, was die Tools sehen.
- **Netzwerkoperationen, die das Modell selbst macht** (Web-Search, MCP-HTTP-Calls) — laufen im Host-Prozess.

Die Grenze ist also exakt: **alles, was per Shell/Background gespawnt wird → containerisiert; alles andere → Host.**

---

## Bekannte Einschränkungen / Stolperfallen

1. **`mount`-Modus teilt dein Projekt bidirektional.** Ein bösartiger Tool-Call im Container kann sehr wohl `rm -rf /workspace/.git` ausführen, weil `/workspace` dein echtes cwd ist. Der Container schützt den Rest deines Dateisystems; das Projekt selbst nicht. Nimm `copy`, wenn das wichtig ist.
2. **Default `network = none`** ist gut für Sicherheit, bricht aber Tools, die legitim Netzwerk brauchen (`npm install`, `pip install`, `curl docs.example.com`). Setz bei Bedarf `container.network = "bridge"` in der Config.
3. **Windows lässt den Container in Alpine als `root` laufen** (Host-UID-Mapping ist Linux-only). In `/workspace` erzeugte Dateien erscheinen auf dem Windows-Host unter deinem Windows-User (vom Dateisystem-Treiber gemanagt), innerhalb des Containers gehören sie aber root. Eigentumssensitive Skripte verhalten sich evtl. anders als auf Linux/macOS.
4. **Der Container hat keine Host-Shell** — er ist `node:22-alpine`. Kein `bash`, kein `zsh`, kein `make`, kein `git` (bis du `apk add` machst). Der Shell-Wrapper ruft `sh -lc` auf, also funktioniert `sh`. Wenn du mehr Tools brauchst, nutz ein Custom-Image: `--container-image my/opencode-dev:latest`.
5. **Pre-Boot scheitert leise.** Läuft Docker nicht, geht die TUI ohne Sandbox weiter. Die Logzeile `container runtime failed to start; continuing without sandbox` ist im aktuellen Code dein einziges Signal.
6. **Copy-Modus persistiert ein Temp-Verzeichnis unter `~/.local/share/opencode/container/<sessionID>/workspace`** für die Session. Wird die TUI hart gekillt, entfernt `sweepStale()` den Container beim nächsten Mal, das Copy-Temp-Verzeichnis wird aber nur von `runtime.destroy()` aufgeräumt — verwaiste Verzeichnisse können sich nach Crashes ansammeln. Manuelles Aufräumen von `~/.local/share/opencode/container/` ist sicher, solange keine Session läuft.
7. **Kein automatischer Modus-Wechsel.** Startet die TUI in einem Modus, bleibt sie bis zum Neustart darin. Es gibt keinen `/container mount`-Slash-Befehl.

---

## Schnellreferenz

| Ziel | Befehl |
|---|---|
| TUI im Mount-Modus-Container | `opencode --container mount` |
| TUI im Copy-Modus-Container | `opencode --container copy` |
| Custom Image | `opencode --container mount --container-image python:3.12-slim` |
| Projekt-Default | `container: { mode: "mount" }` in `opencode.json` |
| One-Shot-Run im Container | `opencode --container mount run "dein Prompt"` |
| Container-Aktivität prüfen | `docker ps` auf dem Host (such nach `opencode-<sessionID>-<ts>`) oder `uname -a` aus der TUI heraus |

---

## Config-Schema

In `opencode.json` (`packages/opencode/src/config/config.ts:286-317`):

```jsonc
{
  "container": {
    "mode": "off | mount | copy",        // Sandbox-Modus
    "image": "node:22-alpine",            // Docker-Image
    "network": "none | bridge | host",    // Default "none"
    "memory": "2g",                       // docker --memory
    "cpus": "2",                          // docker --cpus
    "pids": 256,                          // PID-Limit im Container
    "run_as_current_user": true,          // Host-uid/gid-Mapping (Linux/Mac)
    "exclude": [".env", "secrets/"]       // Copy-Modus-Sync-Ausschlüsse
  }
}
```

CLI-Flags überschreiben die Config; Env-Variablen (`OPENCODE_CONTAINER`, `OPENCODE_CONTAINER_IMAGE`) überschreiben beides.

---

## Verifikation (Session vom 2026-05-05)

Funktioniert wie entworfen unter Windows 11 mit Docker Desktop / WSL2:

- Container-ID: `a70009832eb0`
- Image: Alpine 3.23.4 (= `node:22-alpine`-Basis)
- Kernel: `6.6.87.2-microsoft-standard-WSL2`
- User: `root` (auf Windows-Host erwartet — UID-Mapping deaktiviert)
- `/workspace` befüllt und von innen beschreibbar

Die TUI lief auf dem Windows-Host; Bash-Tool-Calls liefen in Alpine. Genau die Grenze, die die Architektur durchsetzen soll.

---

## Datei-Index

| Pfad | Rolle |
|---|---|
| `packages/opencode/src/container/index.ts` | Container-Namespace, `prepare()`, `Runtime`, Modus-Dispatch |
| `packages/opencode/src/container/docker.ts` | Docker-CLI-Wrapper: `available`, `ensureImage`, `runBackground`, `remove`, `sweepStale` |
| `packages/opencode/src/container/copy.ts` | `sync` / `diff` / `apply` / `cleanup` für Copy-Modus |
| `packages/opencode/src/cli/cmd/tui/thread.ts` | `--container` / `--container-image` CLI-Flags |
| `packages/opencode/src/cli/cmd/tui/worker.ts` | `preBootContainer()`, Instance-Caching, Disposer-Registrierung |
| `packages/opencode/src/tool/shell.ts` | Bash-Tool-Routing über `runtime.spawnArgs` |
| `packages/opencode/src/shell/background.ts` | Lang laufende Shell-Prozesse, gleiche Verdrahtung |
| `packages/opencode/src/session/prompt.ts` | `sandboxRuleset()`-Permission-Auto-Allow |
| `packages/opencode/src/config/config.ts` | `container.*`-Schema |
