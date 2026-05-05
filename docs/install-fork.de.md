# Fork installieren (`TTK95/opencode`)

So installierst du den Fork-Channel-Build von opencode (`OPENCODE_CHANNEL=dev_ttk`).
Behandelt **Windows** (validiert) und **Linux** (ungetestet — nur Source-Build).

> **Hinweis**: macOS wird nicht behandelt. Die Release-Pipeline baut heute nur `windows-x64`; Linux funktioniert prinzipiell aus dem Source, ist vom Maintainer aber nicht verifiziert.
> Erstellt am 2026-05-05 gegen `dev` @ `e9f49205f` (opencode `1.14.41-dev_ttk`).

---

## Was der Fork mitbringt

Dieser Fork sitzt auf Upstream `anomalyco/opencode` und ergänzt:

- **Container-Sandbox** (`--container mount|copy`) — siehe [`opencode-container-mode.de.md`](./opencode-container-mode.de.md)
- **Tailscale-Integration** (`opencode tailscale`)
- **Self-Update** über GitHub-Releases (`opencode upgrade --method github-release`)
- Diverse kleinere Patches, gelistet in [`CUSTOM_FEATURES.md`](../CUSTOM_FEATURES.md)

Der Fork-Channel ist `dev_ttk`. Sein In-App-Upgrade-Pfad zieht aus `https://github.com/TTK95/opencode/releases/latest`, **nicht** aus npm oder `anomalyco/opencode`.

---

## Voraussetzungen

### Pflicht für alle Plattformen

- **Plattenplatz**: ~250 MB für die entpackte Binary.
- **Netzwerk**: Zugriff auf `github.com` (Downloads) und `api.github.com` (Release-Metadaten für den In-App-Upgrade).
- **64-Bit-x86-CPU** — heute wird nur `x64` veröffentlicht. ARM64 baut das Skript zwar, wird aber nicht released.
- **AVX2**: Die veröffentlichte Binary ist die AVX2-Variante. Ältere Intel-CPUs oder einige Low-End-Laptops ohne AVX2 können sie nicht ausführen — dann brauchst du den `-baseline`-Build aus dem Source.

### Optional

- **Docker** — nur nötig, wenn du die Container-Sandbox nutzen willst. Siehe Voraussetzungs-Abschnitt in [`opencode-container-mode.de.md`](./opencode-container-mode.de.md#voraussetzungen).
- **Bun ≥ 1.3** — nur für Source-Builds (Linux, eigene Windows-Builds).

### Pflicht für Source-Build (Linux)

- **Bun ≥ 1.3** — `curl -fsSL https://bun.sh/install | bash`
- **Node ≥ 22** — wird von einigen Workspace-Tools gebraucht
- **Git** — fürs Klonen
- **Build-Essentials** — `gcc`, `make`, POSIX-Toolchain (`apt install build-essential` auf Debian/Ubuntu, äquivalent anderswo)

---

## Windows (empfohlen: GitHub-Release)

Validiert unter **Windows 11** mit `npm`-globaler Installation. Alle Befehle in PowerShell, sofern nicht anders vermerkt.

### 1. Tooling prüfen

```powershell
node --version    # ein aktuelles LTS reicht für den Launcher
npm --version
```

Falls `node`/`npm` fehlen, von <https://nodejs.org/> ziehen (LTS-Installer) — sie werden nur gebraucht, weil der Launcher ein Node-Dispatcher ist.

### 2. Aktuelles Fork-Release herunterladen

```powershell
$ver = (Invoke-RestMethod https://api.github.com/repos/TTK95/opencode/releases/latest).tag_name
$url = "https://github.com/TTK95/opencode/releases/download/$ver/opencode-windows-x64.zip"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\opencode-windows-x64.zip"
```

### 3. In den globalen npm-Tree installieren

Der Fork nutzt dieselbe Launcher-Konvention wie Upstream: ein Node-Shim (`opencode-ai/bin/opencode`) sucht die Plattform-Binary unter `node_modules/opencode-windows-x64/bin/`.

```powershell
# Sicherstellen, dass der Launcher (`opencode-ai`) vorhanden ist
npm install -g opencode-ai@latest

# Plattform-Binary durch den Fork-Build ersetzen
$dst = "$env:APPDATA\npm\node_modules\opencode-windows-x64\bin"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Expand-Archive -Path "$env:TEMP\opencode-windows-x64.zip" -DestinationPath "$dst\.." -Force
```

`Expand-Archive` schreibt das `bin/`-Verzeichnis aus dem Archiv nach `...\opencode-windows-x64\` und ersetzt damit `bin\opencode.exe`.

### 4. Verifizieren

```powershell
opencode --version
# erwartet:  1.14.41-dev_ttk   (oder das jeweils neueste Fork-Release)
```

Endet die Version *nicht* auf `-dev_ttk`, findet der Launcher eine veraltete Upstream-Binary. Siehe **Troubleshooting** unten.

### 5. Updates

Sobald du auf einem Fork-Release bist, funktioniert der In-App-Upgrade:

```powershell
opencode upgrade --method github-release
```

Das routet über den Fork-Channel und zieht das nächste Release aus `TTK95/opencode/releases/latest`. Der Windows-spezifische Lock-File-Fix (Rename-aside + Post-Verify) ist seit `1.14.41` drin, sodass Upgrades ab dieser Version die laufende Binary sauber ersetzen.

> Wenn beim Upgrade noch eine TUI-Session läuft, schließe sie zuerst. Der Upgrade benennt die laufende `.exe` beiseite, bevor er extrahiert; die laufende Session arbeitet bis zum Beenden weiter, beim nächsten Start läuft dann der neue Build.

### 6. Deinstallieren

```powershell
npm uninstall -g opencode-ai
# Plattform-Binary entfernen, falls sie zurückbleibt:
Remove-Item -Recurse -Force "$env:APPDATA\npm\node_modules\opencode-windows-x64"
```

### Alternative: aus dem Source bauen (Windows)

Für Entwicklung oder zum Testen eigener Änderungen siehe [`LOCAL_REINSTALL.md`](../LOCAL_REINSTALL.md) im Repo-Root — `bun run build --single` plus `npm install -g packages/opencode/dist/opencode-windows-x64`. Schnellere Iteration als ein Re-Upload via GitHub-Release.

---

## Linux (ungetestet — nur Source-Build)

> **Achtung**: Der Fork wird derzeit ausschließlich auf Windows entwickelt und genutzt. Die Release-Pipeline veröffentlicht **keine** Linux-Artefakte. Der Pfad unten baut aus dem Source. Prinzipiell funktioniert das (das Build-Skript hat `linux-x64`/`linux-arm64`/musl-Targets), der Maintainer hat es aber auf echten Linux-Hosts nicht verifiziert. Mit Ecken und Kanten rechnen.

### 1. Bun installieren

```bash
curl -fsSL https://bun.sh/install | bash
# der gedruckten Anleitung folgen, ~/.bun/bin in PATH aufnehmen
```

### 2. Fork klonen

```bash
git clone https://github.com/TTK95/opencode.git
cd opencode
git checkout dev   # der aktive Fork-Branch
```

### 3. Workspace-Dependencies installieren

```bash
bun install
```

### 4. Host-Plattform-Binary bauen

```bash
OPENCODE_VERSION=$(jq -r .version packages/opencode/package.json) \
OPENCODE_CHANNEL=dev_ttk \
OPENCODE_REPO=TTK95/opencode \
  bun run --cwd packages/opencode build --single
```

`--single` baut nur deine aktuelle Plattform. Output:

- `packages/opencode/dist/opencode-linux-x64/bin/opencode`     (auf x64)
- `packages/opencode/dist/opencode-linux-arm64/bin/opencode`   (auf arm64)

> CPUs ohne AVX2 brauchen die Baseline-Variante. Hänge `--baseline` an den Build-Befehl an — erzeugt `opencode-linux-x64-baseline/`. CPU prüfen mit `grep -m1 avx2 /proc/cpuinfo`.

### 5. Global installieren

Zwei Optionen.

**Option A — Symlink unter `npm` global** (parallel zum Windows-Pfad):

```bash
npm install -g opencode-ai@latest                           # holt den Launcher
npm install -g packages/opencode/dist/opencode-linux-x64    # symlinkt Plattform-Bin
```

`findBinary()` im Launcher läuft durch `node_modules/opencode-linux-x64/bin/` und nimmt den Symlink.

**Option B — Binary direkt auf `PATH` ablegen**:

```bash
sudo install -m 755 packages/opencode/dist/opencode-linux-x64/bin/opencode \
  /usr/local/bin/opencode
```

Umgeht den npm-Shim komplett. Schneller, aber `opencode upgrade --method github-release` hat dann nichts zu ziehen (für Linux gibt es noch kein Release). Updates bedeuten Build neu laufen lassen.

### 6. Verifizieren

```bash
opencode --version
# erwartet:  1.14.41-dev_ttk
```

### 7. Updates

- **Source-Build-Pfad**: `git pull && bun install && bun run --cwd packages/opencode build --single`. Neu installieren (Option A oder B oben).
- **In-App-Upgrade (`opencode upgrade --method github-release`)**: **funktioniert auf Linux heute nicht.** Der Fork-Release-Workflow (`.github/workflows/release-fork.yml`) baut und publiziert ausschließlich `windows-x64.zip`. Der Upgrade-Aufruf schlägt fehl, weil im Fork-Releases-Tree keine `linux-x64`/`linux-arm64`-Assets liegen.
  - Zum Aktivieren: `runs-on` im Workflow auf `[windows-latest, ubuntu-latest, ubuntu-22.04-arm]` mit Target-Matrix erweitern und für jedes Target äquivalente `Compress-Archive`/`tar`-Schritte ergänzen. Außerhalb des Scopes dieses Guides.

### 8. Deinstallieren

Wenn via Option A installiert:

```bash
npm uninstall -g opencode-ai opencode-linux-x64
```

Wenn via Option B installiert:

```bash
sudo rm /usr/local/bin/opencode
```

Optional das geklonte Repo entfernen: `rm -rf opencode`.

---

## Troubleshooting

### `opencode --version` zeigt eine Upstream-Version (kein `-dev_ttk`-Suffix)

Der Launcher (Node-Dispatcher von `opencode-ai`) findet vor dem Fork-Build eine veraltete Binary. Übliche Ursachen:

1. **Verschachteltes `opencode-ai/node_modules/opencode-windows-x64`** überschattet das Top-Level-Plattform-Package. Löschen:
   ```powershell
   # Windows
   Remove-Item -Recurse -Force "$env:APPDATA\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64"
   Remove-Item -Recurse -Force "$env:APPDATA\npm\node_modules\opencode-ai\node_modules\opencode-windows-x64-baseline"
   ```
   ```bash
   # Linux
   rm -rf ~/.npm-global/lib/node_modules/opencode-ai/node_modules/opencode-linux-x64
   ```
2. **Env-Var `OPENCODE_BIN_PATH` zeigt auf alte Binary.** `echo $env:OPENCODE_BIN_PATH` (Win) bzw. `echo $OPENCODE_BIN_PATH` (Linux) — abhängen, wenn stale.
3. **Mehrere `opencode`-Binaries auf PATH.** `where opencode` (Win) / `which -a opencode` (Linux). Auflösen, sodass das npm-Global gewinnt.

### `opencode upgrade --method github-release` meldet Erfolg, Version ändert sich aber nicht (Windows)

In `1.14.41` gefixt. Wenn du auf `1.14.40` oder älteren Fork-Builds bist, einmal manuell per Schritten oben auf `1.14.41` installieren; künftige Upgrades laufen dann sauber durch.

### Container-Modus läuft klammheimlich ohne Sandbox

Siehe Voraussetzungs-Abschnitt in [`opencode-container-mode.de.md`](./opencode-container-mode.de.md#voraussetzungen) — meistens läuft der Docker-Daemon nicht oder `docker info` überschreitet das 5-Sekunden-Timeout.

### Linux: `bun install` schlägt fehl

- Stelle sicher, dass `git`, `gcc` und `make` verfügbar sind.
- Das Repo nutzt Workspace-Catalogs und SST; manche transitiven Deps brauchen einen echten C-Compiler.
- Kein `npm install` im Repo-Root — die Lockfile ist `bun.lock`.

---

## Channel- und Repo-Overrides

Build-Zeit-Env-Vars, die in die Binary geprägt werden (vom Release-Workflow automatisch gesetzt):

| Var | Default | Wirkung |
|---|---|---|
| `OPENCODE_VERSION` | Version aus `package.json` | In `--version`-Output gestempelt |
| `OPENCODE_CHANNEL` | `local` | Auf `dev_ttk` gesetzt nutzt der In-App-Upgrade-Pfad `github-release` und fragt das Fork-Repo |
| `OPENCODE_REPO` | `anomalyco/opencode` | Repo für `Installation.latest()`-API-Calls |

Manuell für einen eigenen Build setzen:

```bash
OPENCODE_VERSION=1.14.41-dev_ttk \
OPENCODE_CHANNEL=dev_ttk \
OPENCODE_REPO=TTK95/opencode \
  bun run --cwd packages/opencode build --single
```

Ohne diese Vars meldet sich dein Build als Upstream und kann sich nicht über die Fork-Releases selbst aktualisieren.

---

## Referenzen

- Repo: <https://github.com/TTK95/opencode>
- Releases: <https://github.com/TTK95/opencode/releases>
- Source-Build-Details (Entwickler-Flow): [`LOCAL_REINSTALL.md`](../LOCAL_REINSTALL.md)
- Custom-Feature-Liste: [`CUSTOM_FEATURES.md`](../CUSTOM_FEATURES.md)
- Container-Modus-Doku: [`opencode-container-mode.de.md`](./opencode-container-mode.de.md)
