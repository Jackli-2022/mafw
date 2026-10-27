// CodeMirror 6 装配（动态 import：编辑器内核按需分包，不进主 bundle）。
// 主题与语法色全部走 CSS token（三主题自适应），禁止硬编码色值。
import { langForFile } from "./cm-lang"

export interface MountedEditor {
  setDoc(s: string): void
  getDoc(): string
  destroy(): void
  /** 容器从隐藏变可见后强制重测（SVG 预览切回源码等场景）。 */
  measure(): void
}

// “编辑器语言 id → LanguageDescription”匹配：先按名称（大小写不敏感），再按扩展名。
async function loadLanguageSupport(lang: string | null) {
  if (!lang) return []
  const { languages } = await import("@codemirror/language-data")
  const byName = languages.find(d => d.name.toLowerCase() === lang)
  if (byName) return byName.load()
  const byExt = languages.find(d => d.extensions.includes(lang))
  return byExt ? byExt.load() : []
}

export async function mountEditor(host: HTMLElement, opts: {
  doc: string
  readOnly: boolean
  lang: string | null
  onDocChanged: () => void
  onSave: () => void
  /** 选区变化（编辑器内坐标，供浮层定位）；零宽/折叠 → null。 */
  onSelectionChange?: (sel: { from: number; to: number; text: string; left: number; top: number } | null) => void
}): Promise<MountedEditor> {
  const [{ EditorView, basicSetup }, { EditorState }, { keymap }, { HighlightStyle, syntaxHighlighting }, { tags }, support] =
    await Promise.all([
      import("codemirror"),
      import("@codemirror/state"),
      import("@codemirror/view"),
      import("@codemirror/language"),
      import("@lezer/highlight"),
      loadLanguageSupport(opts.lang),
    ])

  const theme = EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "transparent",
      color: "var(--text-1)",
      fontSize: "12px",
    },
    ".cm-scroller": { fontFamily: "var(--font-data, monospace)", lineHeight: "1.5" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-4)", border: "none" },
    ".cm-activeLine": { backgroundColor: "var(--bg-overlay, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-3)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--bg-selected, var(--accent-soft, rgba(80, 140, 255, 0.22)))",
    },
    ".cm-cursor": { borderLeftColor: "var(--text-1)" },
    ".cm-content": { caretColor: "var(--text-1)" },
  })

  const highlight = syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: "var(--accent)" },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--success, var(--accent-success, var(--text-1)))" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--text-4)", fontStyle: "italic" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--accent-warning, var(--accent))" },
    { tag: [tags.typeName, tags.className], color: "var(--accent-text, var(--accent))" },
    { tag: [tags.tagName, tags.attributeName], color: "var(--danger-text, var(--text-2))" },
    { tag: [tags.function(tags.variableName), tags.propertyName], color: "var(--text-1)" },
    { tag: tags.heading, color: "var(--text-1)", fontWeight: "600" },
  ]))

  const saveKeymap = keymap.of([{
    key: "Mod-s",
    preventDefault: true,
    run: () => { opts.onSave(); return true },
  }])

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      basicSetup,
      theme,
      highlight,
      saveKeymap,
      ...(Array.isArray(support) ? support : [support]),
      EditorState.readOnly.of(opts.readOnly),
      EditorView.editable.of(!opts.readOnly),
      EditorView.updateListener.of(u => {
        if (u.docChanged) opts.onDocChanged()
        if ((u.selectionSet || u.docChanged) && opts.onSelectionChange) {
          const sel = u.state.selection.main
          if (sel.from === sel.to) {
            opts.onSelectionChange(null)
          } else {
            const coords = u.view.coordsAtPos(sel.to)
            const rect = host.getBoundingClientRect()
            opts.onSelectionChange({
              from: sel.from,
              to: sel.to,
              text: u.state.sliceDoc(sel.from, sel.to),
              left: coords ? coords.left - rect.left : 0,
              top: coords ? coords.bottom - rect.top : 0,
            })
          }
        }
      }),
    ],
  })

  const view = new EditorView({ state, parent: host })
  // 挂载时容器可能仍隐藏（先请求打开、后切 tab）：可见后的首帧强制重新测量，
  // 否则 CM6 会保留 0 尺寸视图直到下一次交互（2026-10-22 冒烟实证）。
  requestAnimationFrame(() => {
    try { view.requestMeasure() } catch { /* view 已销毁 */ }
  })

  return {
    setDoc(s: string) {
      if (s === view.state.doc.toString()) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s } })
    },
    getDoc: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
    measure() {
      try { view.requestMeasure() } catch { /* view 已销毁 */ }
    },
  }
}
