import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import {
  resolveInRoot, resolveDirInRoot, shapeEntries, sniffBinary, MAX_READ_BYTES,
  writeTextFile, readTextFile, listDir, type FsIO,
} from "./fs-workspace"

// 跨平台：CI 双 OS 跑同一套测试，根路径用平台原生绝对路径构造
const root = resolve("proj")

function mkIo(
  files: Record<string, { buf: Buffer; mtime: number }>,
  dirs: Record<string, { name: string; isDirectory(): boolean }[]> = {},
): FsIO {
  return {
    readdir: async (abs) => dirs[abs] ?? [],
    readFile: async (abs) => { if (!files[abs]) throw Object.assign(new Error("x"), { code: "ENOENT" }); return files[abs].buf },
    writeFile: async (abs, data) => { files[abs] = { buf: Buffer.from(data), mtime: 999 } },
    stat: async (abs) => {
      if (!files[abs]) throw Object.assign(new Error("x"), { code: "ENOENT" })
      return { mtimeMs: files[abs].mtime, size: files[abs].buf.length }
    },
  }
}

describe("resolveInRoot（jail）", () => {
  test("正常相对路径 → root 下绝对路径", () => {
    expect(resolveInRoot(root, "src/a.ts")).toBe(join(root, "src/a.ts"))
    expect(resolveInRoot(root, "a.ts")).toBe(join(root, "a.ts"))
  })
  test("越界/绝对/盘符/反斜杠混合 → null", () => {
    expect(resolveInRoot(root, "../outside.ts")).toBeNull()
    expect(resolveInRoot(root, "../../etc/passwd")).toBeNull()
    expect(resolveInRoot(root, "C:\\Windows\\x")).toBeNull()
    expect(resolveInRoot(root, "D:\\other")).toBeNull()
    expect(resolveInRoot(root, "src\\..\\..\\out")).toBeNull()
    expect(resolveInRoot(root, "")).toBeNull()
    expect(resolveInRoot(root, "/etc/passwd")).toBeNull()
  })
  test("root 内但名字含 .. 片段不误判（如 a..b.ts）", () => {
    expect(resolveInRoot(root, "a..b.ts")).toBe(join(root, "a..b.ts"))
  })
})

describe("resolveDirInRoot（目录 watch 用；rel=\"\" 为 root 自身）", () => {
  test("空 rel → root 自身", () => {
    expect(resolveDirInRoot(root, "")).toBe(resolve(root))
  })
  test("普通子目录 → root 下绝对路径；越界 → null", () => {
    expect(resolveDirInRoot(root, "src/components")).toBe(join(root, "src/components"))
    expect(resolveDirInRoot(root, "../outside")).toBeNull()
    expect(resolveDirInRoot(root, "C:\\Windows")).toBeNull()
  })
})


describe("shapeEntries", () => {
  test("目录在前 + 名称排序 + IGNORED_DIRS/隐藏文件过滤（.mafw 放行）", () => {
    const ents = [
      { name: "b.ts", isDirectory: () => false },
      { name: "node_modules", isDirectory: () => true },
      { name: ".git", isDirectory: () => true },
      { name: "src", isDirectory: () => true },
      { name: ".mafw", isDirectory: () => true },
      { name: "a.ts", isDirectory: () => false },
    ]
    expect(shapeEntries(ents)).toEqual([
      { name: ".mafw", kind: "dir" },
      { name: "src", kind: "dir" },
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
    ])
  })
})

describe("sniffBinary / MAX_READ_BYTES", () => {
  test("前 512 字节含 \\0 → binary；纯文本 → false", () => {
    expect(sniffBinary(Buffer.from([0x89, 0x00, 0x50]))).toBe(true)
    expect(sniffBinary(Buffer.from("hello 世界"))).toBe(false)
  })
  test("MAX_READ_BYTES = 1MB", () => { expect(MAX_READ_BYTES).toBe(1_048_576) })
})

describe("readTextFile / listDir", () => {
  test("文本读取 → content + mtimeMs + eol；二进制 / 非 UTF-8 / 超大 → 拒绝原因", async () => {
    const a = join(root, "a.ts")
    const io = mkIo({ [a]: { buf: Buffer.from("hi"), mtime: 5 } })
    expect(await readTextFile(io, root, "a.ts")).toEqual({ ok: true, content: "hi", mtimeMs: 5, eol: "\n" })
    const bin = mkIo({ [join(root, "b.bin")]: { buf: Buffer.from([0x00, 0x01]), mtime: 1 } })
    expect(await readTextFile(bin, root, "b.bin")).toEqual({ ok: false, reason: "binary" })
    // 非 UTF-8 字节（GBK「你」= C4 E3）→ 拒绝解码，防保存时写坏
    const gbk = mkIo({ [join(root, "c.txt")]: { buf: Buffer.from([0xC4, 0xE3]), mtime: 1 } })
    expect(await readTextFile(gbk, root, "c.txt")).toEqual({ ok: false, reason: "encoding" })
    // 超大：stat 先行拒绝（readFile 不应被调用）
    const huge: FsIO = {
      readdir: async () => [],
      readFile: async () => { throw new Error("should not read") },
      writeFile: async () => {},
      stat: async () => ({ mtimeMs: 1, size: MAX_READ_BYTES + 1 }),
    }
    expect(await readTextFile(huge, root, "huge.log")).toEqual({ ok: false, reason: "too-large" })
    expect(await readTextFile(mkIo({}), root, "nope.ts")).toEqual({ ok: false, reason: "not-found" })
  })
  test("CRLF 文件：内容归一为 \\n 显示，eol 记录 \\r\\n", async () => {
    const io = mkIo({ [join(root, "w.txt")]: { buf: Buffer.from("a\r\nb\r\n"), mtime: 7 } })
    expect(await readTextFile(io, root, "w.txt")).toEqual({ ok: true, content: "a\nb\n", mtimeMs: 7, eol: "\r\n" })
  })
  test("listDir：root 自身可列（rel=\"\"）；jail 外 → null；按 shapeEntries 形状返回", async () => {
    const io = mkIo({}, { [root]: [
      { name: "b.ts", isDirectory: () => false },
      { name: "src", isDirectory: () => true },
    ] })
    expect(await listDir(io, root, "")).toEqual([{ name: "src", kind: "dir" }, { name: "b.ts", kind: "file" }])
    expect(await listDir(io, root, "../x")).toBeNull()
  })
})

describe("writeTextFile（保存时版本校验 + EOL 保真，调研 §3）", () => {
  test("ifMtimeMs 匹配 → 写入；不匹配 → conflict 不落盘", async () => {
    const io = mkIo({ [join(root, "a.ts")]: { buf: Buffer.from("v1"), mtime: 100 } })
    expect(await writeTextFile(io, root, "a.ts", "v2", { ifMtimeMs: 100 })).toEqual({ ok: true })
    expect(await writeTextFile(io, root, "a.ts", "v3", { ifMtimeMs: 100 })).toEqual({ ok: false, reason: "conflict" })
  })
  test("CRLF 文件保存回写 \\r\\n（防整文件换行重写）", async () => {
    const files: Record<string, { buf: Buffer; mtime: number }> = { [join(root, "w.txt")]: { buf: Buffer.from("a\r\nb"), mtime: 1 } }
    const io = mkIo(files)
    await writeTextFile(io, root, "w.txt", "a\nb\n", { eol: "\r\n" })
    expect(files[join(root, "w.txt")]!.buf.toString()).toBe("a\r\nb\r\n")
  })
  test("目标不存在 → not-found（不创建新文件）；jail 外 → jail", async () => {
    const io = mkIo({})
    expect(await writeTextFile(io, root, "new.ts", "x")).toEqual({ ok: false, reason: "not-found" })
    expect(await writeTextFile(io, root, "../x.ts", "x")).toEqual({ ok: false, reason: "jail" })
  })
})
