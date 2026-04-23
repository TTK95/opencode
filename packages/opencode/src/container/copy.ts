import fs from "fs/promises"
import path from "path"

const DEFAULT_IGNORES = [".git", "node_modules", ".opencode", ".DS_Store", ".venv", "__pycache__", "dist", "build"]

function matches(name: string, rel: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === name) return true
    if (p === rel) return true
    if (p.endsWith("/") && (rel + "/").startsWith(p)) return true
  }
  return false
}

async function copyDir(src: string, dst: string, ignores: string[], rel = ""): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true })
  await fs.mkdir(dst, { recursive: true })
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (matches(entry.name, childRel, ignores)) continue
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isSymbolicLink()) {
      const link = await fs.readlink(s)
      try {
        await fs.symlink(link, d)
      } catch {}
      continue
    }
    if (entry.isDirectory()) {
      await copyDir(s, d, ignores, childRel)
      continue
    }
    if (entry.isFile()) {
      await fs.copyFile(s, d)
      continue
    }
  }
}

export async function sync(source: string, target: string, exclude: string[] = []): Promise<void> {
  const ignores = [...DEFAULT_IGNORES, ...exclude]
  await fs.mkdir(target, { recursive: true })
  await copyDir(source, target, ignores)
}

export type DiffEntry = {
  path: string
  status: "added" | "modified" | "removed"
}

async function hashFile(filepath: string): Promise<string> {
  const { createHash } = await import("crypto")
  const data = await fs.readFile(filepath)
  return createHash("sha256").update(data).digest("hex")
}

async function walkFiles(root: string, ignores: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  async function walk(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      if (matches(entry.name, childRel, ignores)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, childRel)
        continue
      }
      if (entry.isFile()) {
        out.set(childRel, await hashFile(full))
      }
    }
  }
  await walk(root, "")
  return out
}

export async function diff(source: string, target: string, exclude: string[] = []): Promise<DiffEntry[]> {
  const ignores = [...DEFAULT_IGNORES, ...exclude]
  const [srcFiles, dstFiles] = await Promise.all([walkFiles(source, ignores), walkFiles(target, ignores)])
  const out: DiffEntry[] = []
  for (const [rel, hash] of dstFiles) {
    const orig = srcFiles.get(rel)
    if (orig === undefined) out.push({ path: rel, status: "added" })
    else if (orig !== hash) out.push({ path: rel, status: "modified" })
  }
  for (const [rel] of srcFiles) {
    if (!dstFiles.has(rel)) out.push({ path: rel, status: "removed" })
  }
  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

export async function apply(source: string, target: string, entries: DiffEntry[]): Promise<void> {
  for (const entry of entries) {
    const srcFile = path.join(source, entry.path)
    const dstFile = path.join(target, entry.path)
    if (entry.status === "removed") {
      await fs.rm(dstFile, { force: true })
      continue
    }
    await fs.mkdir(path.dirname(dstFile), { recursive: true })
    await fs.copyFile(srcFile, dstFile)
  }
}

export async function cleanup(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true })
}
