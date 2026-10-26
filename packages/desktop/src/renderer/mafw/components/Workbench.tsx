// Workbench：合并后的工作台面（spec 2026-10-26-workbench-merge-design）。
// IDE 骨架：文件树固定左（200px，对齐 opencode 默认）+ 主区 tab（编辑器/浏览器）+ 底部终端（可收起）。
// 面板各自带统一骨架（DockPanelHeader/DockEmpty/DockBanner）；本组件只负责分区与 tab。
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import { FilesDock } from "./FilesDock"
import { EditorDock } from "./EditorDock"
import { BrowserDock } from "./BrowserDock"
import { TerminalDock } from "./TerminalDock"
import { type FileDiffEntry } from "./DiffReviewPanel"

export type WorkbenchTab = "editor" | "browser"

export function Workbench(props: {
  open: boolean
  tab: WorkbenchTab
  onTab: (tab: WorkbenchTab) => void
  sessionID: string | null
  sessionDirectory: string | null
  diffs: FileDiffEntry[]
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenFile: (rel: string) => void
  onSendAnnotation?: (text: string) => void
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
  onSendComment?: (sid: string, text: string) => void
}) {
  return (
    <div class="mafw-workbench">
      <div class="mafw-wb-top">
        <ButtonV2
          variant={props.tab === "editor" ? "contrast" : "ghost"}
          size="small"
          class="mafw-wb-tab"
          aria-pressed={props.tab === "editor"}
          onClick={() => props.onTab("editor")}
        >
          <Icon name="code" size="small" /> 编辑器
        </ButtonV2>
        <ButtonV2
          variant={props.tab === "browser" ? "contrast" : "ghost"}
          size="small"
          class="mafw-wb-tab"
          aria-pressed={props.tab === "browser"}
          onClick={() => props.onTab("browser")}
        >
          <Icon name="globe" size="small" /> 浏览器
        </ButtonV2>
        <div class="mafw-wb-top-actions">
          <TooltipV2 value={props.terminalOpen ? "收起终端" : "打开终端"} openDelay={300}>
            <ButtonV2
              variant={props.terminalOpen ? "contrast" : "ghost"}
              size="small"
              aria-label={props.terminalOpen ? "收起终端" : "打开终端"}
              aria-pressed={props.terminalOpen}
              onClick={props.onToggleTerminal}
            >
              <Icon name="terminal" size="small" />
            </ButtonV2>
          </TooltipV2>
        </div>
      </div>
      <div class="mafw-wb-body">
        <div class="mafw-wb-files">
          <FilesDock sessionDirectory={props.sessionDirectory} onOpenFile={props.onOpenFile} />
        </div>
        <div class="mafw-wb-main">
          <div class="mafw-wb-pane" style={{ display: props.tab === "editor" ? "contents" : "none" }}>
            <EditorDock
              sessionID={props.sessionID}
              sessionDirectory={props.sessionDirectory}
              diffs={props.diffs}
              onSendAnnotation={props.onSendAnnotation}
              onAddAnnotation={props.onAddAnnotation}
              onSendComment={props.onSendComment}
            />
          </div>
          <div class="mafw-wb-pane" style={{ display: props.tab === "browser" ? "contents" : "none" }}>
            <BrowserDock sessionID={props.sessionID} />
          </div>
        </div>
      </div>
      {/* 常挂载（收起仅 display:none）：保留 xterm 实例与 scrollback */}
      <div class="mafw-wb-terminal" classList={{ "is-collapsed": !props.terminalOpen }}>
        <TerminalDock directory={props.sessionDirectory} active={props.open && props.terminalOpen} />
      </div>
    </div>
  )
}
