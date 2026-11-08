import type { MountedEditor } from "./cm-setup"
import type { InlineDiffRange } from "./inline-diff"
import { monacoLanguage } from "./monaco-lang"

// monaco-editor 0.57 的 package.json `exports` 形如 "./*.js" -> "./esm/vs/*.js"，
// 所以子路径必须从包根写（不能带 esm/vs 前缀，否则会被映射成 esm/vs/esm/vs/...）。
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker"
import CssWorker from "monaco-editor/language/css/css.worker.js?worker"
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker"
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker"
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker"

type Monaco = typeof import("monaco-editor")

let envInstalled = false

function installEnvironment(): void {
  if (envInstalled) return;
  envInstalled = true;
  (self as any).MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === "json") return new JsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new CssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
      if (label === "typescript" || label === "javascript") return new TsWorker();
      return new EditorWorker();
    },
  };
}

function cssVar(name: string, fallback: string): string {
  // MAFW 主题 token 定义在 `.mafw-shell, body`（不是 html），从 body 读；
  // html 仅作兜底（外部主题可能把变量挂在根上）。
  const fromBody = getComputedStyle(document.body).getPropertyValue(name).trim();
  if (fromBody) return fromBody;
  const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return fromRoot || fallback;
}

function toMonacoColor(value: string, fallback: string): string {
  const raw = (value || fallback).trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) return raw.toUpperCase();
  const match = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) return fallback;
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  const [r, g, b, a] = parts;
  const hex = `#${[r, g, b]
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
  return a === undefined ? hex : `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0").toUpperCase()}`;
}

function themeName(): string {
  return document.documentElement.dataset.colorScheme === "light" ? "mafw-light" : "mafw-dark";
}

function defineThemes(monaco: Monaco): void {
  const bg = toMonacoColor(cssVar("--bg-inset", "#1E1E1E"), "#1E1E1E");
  const fg = toMonacoColor(cssVar("--text-1", "#EDECE9"), "#EDECE9");
  const muted = toMonacoColor(cssVar("--text-4", "#8F8C85"), "#8F8C85");
  const line = toMonacoColor(cssVar("--border-subtle", "#333333"), "#333333");
  const accent = toMonacoColor(cssVar("--accent", "#4FD388"), "#4FD388");
  const selection = toMonacoColor(cssVar("--selection", `${accent}55`), `${accent}55`);
  const widget = toMonacoColor(cssVar("--bg-overlay", "#262626"), "#262626");
  const lineHighlight = toMonacoColor(cssVar("--bg-hover", "rgba(255,255,255,.04)"), "#00000000");
  const colors = {
    "editor.background": bg,
    "editor.foreground": fg,
    "editorLineNumber.foreground": muted,
    "editorLineNumber.activeForeground": fg,
    "editorCursor.foreground": fg,
    "editor.selectionBackground": selection,
    "editor.inactiveSelectionBackground": `${accent}33`.slice(0, 9).toUpperCase(),
    "editor.lineHighlightBackground": lineHighlight,
    "editorIndentGuide.background1": line,
    "editorWidget.background": widget,
    "editorWidget.border": line,
    "editorSuggestWidget.background": widget,
    "editorSuggestWidget.border": line,
    "editorSuggestWidget.selectedBackground": lineHighlight,
    "editorHoverWidget.background": widget,
    "editorHoverWidget.border": line,
    "editorOverviewRuler.border": "#00000000",
  };
  monaco.editor.defineTheme("mafw-dark", { base: "vs-dark", inherit: true, rules: [], colors });
  monaco.editor.defineTheme("mafw-light", { base: "vs", inherit: true, rules: [], colors });
}

export async function mountMonacoEditor(host: HTMLElement, opts: {
  doc: string
  readOnly: boolean
  lang: string | null
  onDocChanged: () => void
  onSave: () => void
  onSelectionChange?: (sel: { from: number; to: number; text: string; left: number; top: number } | null) => void
}): Promise<MountedEditor> {
  installEnvironment();
  const monaco = await import("monaco-editor");
  defineThemes(monaco);

  const language = monacoLanguage(opts.lang);
  const model = monaco.editor.createModel(opts.doc, language);
  let minimapOn = false;
  const editor = monaco.editor.create(host, {
    model,
    theme: themeName(),
    readOnly: opts.readOnly,
    // Monaco 自管 ResizeObserver；首帧容器可能还没定尺，automaticLayout 会在
    // 尺寸变化后补一次布局（否则 view-lines 永远是 0 行）。
    automaticLayout: true,
    fontSize: 12,
    fontFamily: cssVar("--font-data", "JetBrains Mono, Consolas, monospace"),
    lineHeight: 20,
    minimap: { enabled: false, scale: 1 },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    renderLineHighlight: "all",
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    folding: true,
    stickyScroll: { enabled: true },
    multiCursorModifier: "alt",
    formatOnPaste: true,
    wordWrap: "off",
    tabSize: 2,
    detectIndentation: true,
    padding: { top: 6 },
    lineNumbersMinChars: 3,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    fixedOverflowWidgets: true,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    renderWhitespace: "selection",
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    tabCompletion: "on",
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => opts.onSave());

  const decorations = editor.createDecorationsCollection();
  const contentSub = editor.onDidChangeModelContent(() => opts.onDocChanged());
  const selectionSub = editor.onDidChangeCursorSelection(() => {
    if (!opts.onSelectionChange) return;
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      opts.onSelectionChange(null);
      return;
    }
    const from = model.getOffsetAt(selection.getStartPosition());
    const to = model.getOffsetAt(selection.getEndPosition());
    const text = model.getValueInRange(selection);
    const pos = editor.getScrolledVisiblePosition(selection.getEndPosition());
    const rect = host.getBoundingClientRect();
    opts.onSelectionChange({
      from,
      to,
      text,
      left: pos ? pos.left : 0,
      top: pos ? pos.top + pos.height - rect.top : 0,
    });
  });

  const resize = new ResizeObserver(() => {
    try {
      editor.layout()
      syncMinimap()
    } catch { /* disposed */ }
  })
  resize.observe(host)

  function syncMinimap(): void {
    const want = host.clientWidth >= 720
    if (want === minimapOn) return
    minimapOn = want
    try { editor.updateOptions({ minimap: { enabled: want } }) } catch { /* disposed */ }
  }

  const themeObserver = new MutationObserver(() => {
    defineThemes(monaco);
    monaco.editor.setTheme(themeName());
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-scheme", "data-theme"],
  });

  // 首帧兜底：automaticLayout 只在容器尺寸“变化”时补布局，若创建时容器
  // 尚未定尺（工作台切换/面板动画）且随后没有 resize 事件，视图会停在 0 行。
  // 多段延迟 layout 成本可忽略，确保最终一定渲染。
  const layoutTimers: ReturnType<typeof setTimeout>[] = [];
  const relayout = () => {
    try {
      editor.layout();
      syncMinimap();
    } catch { /* disposed */ }
  };
  relayout();
  requestAnimationFrame(relayout);
  for (const delay of [80, 300, 1000]) layoutTimers.push(setTimeout(relayout, delay));
  void document.fonts?.ready?.then(relayout).catch(() => { /* disposed */ });

  syncMinimap();

  return {
    setDoc(text: string) {
      if (model.getValue() === text) return;
      model.setValue(text);
    },
    getDoc: () => model.getValue(),
    destroy() {
      contentSub.dispose();
      selectionSub.dispose();
      resize.disconnect();
      themeObserver.disconnect();
      for (const timer of layoutTimers) clearTimeout(timer);
      decorations.clear();
      editor.dispose();
      model.dispose();
    },
    measure() {
      try { editor.layout() } catch { /* disposed */ }
    },
    setInlineDiff(ranges: InlineDiffRange[]) {
      try {
        const lineCount = model.getLineCount();
        const list: any[] = [];
        for (const range of ranges) {
          const from = Math.max(1, Math.min(range.from, lineCount));
          const to = Math.max(from, Math.min(range.to, lineCount));
          for (let line = from; line <= to; line++) {
            list.push({
              range: new monaco.Range(line, 1, line, 1),
              options: {
                isWholeLine: true,
                className: range.kind === "add" ? "mafw-monaco-diff-add" : "mafw-monaco-diff-del",
              },
            });
          }
        }
        decorations.set(list);
      } catch { /* disposed */ }
    },
    gotoLine(line: number) {
      try {
        const target = Math.max(1, Math.min(line, model.getLineCount()));
        editor.revealLineInCenter(target);
        editor.setPosition({ lineNumber: target, column: 1 });
        editor.focus();
      } catch { /* disposed */ }
    },
  };
}
