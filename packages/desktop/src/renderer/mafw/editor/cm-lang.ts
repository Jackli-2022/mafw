// 扩展名 → 语言 id（纯映射）。cm-setup 用 id 到 @codemirror/language-data 的
// LanguageDescription.name 匹配（名称为业界惯用大小写，如 "TypeScript"）。
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python",
  md: "markdown", markdown: "markdown",
  css: "css", scss: "css", less: "css",
  json: "json", jsonc: "json",
  html: "html", htm: "html", vue: "html",
  yaml: "yaml", yml: "yaml",
  rs: "rust", go: "go",
  sh: "shell", bash: "shell", zsh: "shell",
  sql: "sql", toml: "toml", xml: "xml", svg: "xml",
  java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp",
  cs: "csharp", rb: "ruby", php: "php", kt: "kotlin", swift: "swift",
  lua: "lua", r: "r", ini: "ini", diff: "diff", patch: "diff",
}

export function langForFile(rel: string): string | null {
  const name = rel.split("/").pop() ?? rel
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return LANG_BY_EXT[ext] ?? null
}
