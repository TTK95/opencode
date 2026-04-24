import { describe, test, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

import { Container } from "@/container"

const { Copy } = Container

async function makeTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `opencode-container-${prefix}-`))
}

describe("Container.Copy", () => {
  test("sync copies files and respects default ignores", async () => {
    const src = await makeTmp("src")
    const dst = await makeTmp("dst")
    try {
      await fs.writeFile(path.join(src, "hello.txt"), "hi")
      await fs.mkdir(path.join(src, ".git"))
      await fs.writeFile(path.join(src, ".git", "HEAD"), "ref")
      await fs.mkdir(path.join(src, "src"))
      await fs.writeFile(path.join(src, "src", "a.ts"), "export {}")

      await Copy.sync(src, dst)

      expect(await fs.readFile(path.join(dst, "hello.txt"), "utf8")).toBe("hi")
      expect(await fs.readFile(path.join(dst, "src", "a.ts"), "utf8")).toBe("export {}")
      expect(
        await fs
          .stat(path.join(dst, ".git"))
          .then(() => "found")
          .catch(() => "missing"),
      ).toBe("missing")
    } finally {
      await fs.rm(src, { recursive: true, force: true })
      await fs.rm(dst, { recursive: true, force: true })
    }
  })

  test("diff detects added, modified and removed files", async () => {
    const src = await makeTmp("src")
    const dst = await makeTmp("dst")
    try {
      await fs.writeFile(path.join(src, "unchanged.txt"), "same")
      await fs.writeFile(path.join(src, "removed.txt"), "gone")
      await fs.writeFile(path.join(src, "modified.txt"), "old")

      await fs.writeFile(path.join(dst, "unchanged.txt"), "same")
      await fs.writeFile(path.join(dst, "modified.txt"), "new")
      await fs.writeFile(path.join(dst, "added.txt"), "fresh")

      const entries = await Copy.diff(src, dst)
      const byPath = Object.fromEntries(entries.map((e) => [e.path, e.status]))
      expect(byPath["added.txt"]).toBe("added")
      expect(byPath["modified.txt"]).toBe("modified")
      expect(byPath["removed.txt"]).toBe("removed")
      expect(byPath["unchanged.txt"]).toBeUndefined()
    } finally {
      await fs.rm(src, { recursive: true, force: true })
      await fs.rm(dst, { recursive: true, force: true })
    }
  })

  test("apply writes entries from sandbox back to source", async () => {
    const src = await makeTmp("src")
    const dst = await makeTmp("dst")
    try {
      await fs.writeFile(path.join(src, "keep.txt"), "keep")
      await fs.writeFile(path.join(src, "drop.txt"), "will go")
      await fs.writeFile(path.join(dst, "keep.txt"), "keep")
      await fs.writeFile(path.join(dst, "new.txt"), "added")

      const entries = await Copy.diff(src, dst)
      await Copy.apply(dst, src, entries)

      expect(await fs.readFile(path.join(src, "new.txt"), "utf8")).toBe("added")
      await expect(fs.access(path.join(src, "drop.txt"))).rejects.toThrow()
    } finally {
      await fs.rm(src, { recursive: true, force: true })
      await fs.rm(dst, { recursive: true, force: true })
    }
  })
})

describe("Container.fromEnv", () => {
  test("parses known values", () => {
    const original = process.env["OPENCODE_CONTAINER"]
    try {
      process.env["OPENCODE_CONTAINER"] = "mount"
      expect(Container.fromEnv()).toBe("mount")
      process.env["OPENCODE_CONTAINER"] = "copy"
      expect(Container.fromEnv()).toBe("copy")
      process.env["OPENCODE_CONTAINER"] = "off"
      expect(Container.fromEnv()).toBe("off")
      process.env["OPENCODE_CONTAINER"] = "docker"
      expect(Container.fromEnv()).toBe("mount")
      process.env["OPENCODE_CONTAINER"] = "nonsense"
      expect(Container.fromEnv()).toBeUndefined()
      delete process.env["OPENCODE_CONTAINER"]
      expect(Container.fromEnv()).toBeUndefined()
    } finally {
      if (original === undefined) delete process.env["OPENCODE_CONTAINER"]
      else process.env["OPENCODE_CONTAINER"] = original
    }
  })
})
