/**
 * 编辑器内核选择（纯逻辑，可测）。
 *
 * 默认 Monaco（VS Code 手感）；`localStorage['mafw-editor-engine']='codemirror'`
 * 一键回退旧内核。存储不可用（隐私模式/SSR）时按默认处理，绝不抛错。
 */
export type EditorEngine = "monaco" | "codemirror"

export function resolveEditorEngine(get: (key: string) => string | null): EditorEngine {
  try {
    return get("mafw-editor-engine") === "codemirror" ? "codemirror" : "monaco"
  } catch {
    return "monaco"
  }
}
