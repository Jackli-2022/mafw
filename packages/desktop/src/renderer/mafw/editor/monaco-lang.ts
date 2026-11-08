/** Map MAFW/CodeMirror language ids to Monaco language ids. */
const MONACO_LANG: Record<string, string> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  markdown: "markdown",
  css: "css",
  json: "json",
  html: "html",
  yaml: "yaml",
  rust: "rust",
  go: "go",
  shell: "shell",
  sql: "sql",
  toml: "ini",
  xml: "xml",
  java: "java",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  ruby: "ruby",
  php: "php",
  kotlin: "kotlin",
  swift: "swift",
  lua: "lua",
  r: "r",
  ini: "ini",
  diff: "diff",
};

export function monacoLanguage(lang: string | null | undefined): string {
  if (!lang) return "plaintext";
  return MONACO_LANG[lang] ?? "plaintext";
}
