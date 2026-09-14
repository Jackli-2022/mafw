// Walks the current project directory for the @file mention picker.
// `io` is injected (readdir with dirent-like {name, isDirectory}) so the
// traversal logic stays testable without touching the real filesystem.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  "coverage",
  ".next",
  ".venv",
  "__pycache__",
  "target",
  ".turbo",
  ".cache",
])

export async function walkProjectFiles(
  root: string,
  io: (dir: string) => Promise<{ name: string; isDirectory(): boolean }[]>,
  maxFiles = 2000,
  maxDepth = 8,
): Promise<string[]> {
  const files: string[] = []
  // Queue holds RELATIVE dir paths ("" = root) so depth math and result
  // prefixes never depend on how the absolute root is spelled.
  const queue: string[] = [""]
  while (queue.length > 0 && files.length < maxFiles) {
    const rel = queue.shift()!
    const depth = rel === "" ? 0 : rel.split("/").length
    if (depth >= maxDepth) continue
    const dir = rel === "" ? root : `${root}/${rel}`
    let entries: { name: string; isDirectory(): boolean }[]
    try {
      entries = await io(dir)
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      if (files.length >= maxFiles) break
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) queue.push(childRel)
      } else {
        files.push("/" + childRel)
      }
    }
  }
  return files.sort()
}
