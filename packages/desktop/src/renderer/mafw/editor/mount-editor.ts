import { mountEditor as mountCodeMirror, type MountedEditor } from "./cm-setup"
import { resolveEditorEngine, type EditorEngine } from "./editor-engine"

export type { MountedEditor } from "./cm-setup"
export type { EditorEngine } from "./editor-engine"

/** 当前生效的编辑器内核（每次挂载现读，切换 flag 无需重启）。 */
export function editorEngine(): EditorEngine {
  return resolveEditorEngine((key) => localStorage.getItem(key))
}

export async function mountEditor(
  host: HTMLElement,
  opts: Parameters<typeof mountCodeMirror>[1],
): Promise<MountedEditor> {
  if (editorEngine() === "monaco") {
    try {
      const { mountMonacoEditor } = await import("./monaco-setup")
      return await mountMonacoEditor(host, opts)
    } catch (e) {
      // Monaco 加载/挂载失败（例如旧 preload 缺 worker 资源）→ 本文件退回 CodeMirror，
      // 不让编辑器整体不可用。
      console.warn("[editor] Monaco mount failed, falling back to CodeMirror", e)
      host.replaceChildren()
    }
  }
  return mountCodeMirror(host, opts)
}
