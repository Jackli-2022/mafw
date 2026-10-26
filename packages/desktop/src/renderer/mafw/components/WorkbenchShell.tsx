// B1 右工作台壳：一级「工作台 / 执行 / 审阅」+ 二级上下文条 + 常驻终端。
// 工作台 › 代码/浏览器；执行 › 固定下拉（概览/待办/子代理/后台/轨迹）；审阅无二级。
import { For, Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import { DropdownMenu } from "@mafw/ui/dropdown-menu"
import {
  EXECUTION_SECTIONS,
  WORKBENCH_SURFACES,
  WORKBENCH_VIEWS,
  executionSectionLabel,
  type ExecutionSection,
  type WorkbenchSurface,
  type WorkbenchView,
} from "../workbench-views"
import { WorkbenchCodeView } from "./WorkbenchCodeView"
import { TerminalDock } from "./TerminalDock"
import type { FileDiffEntry } from "./DiffReviewPanel"

export type WorkbenchShellProps = {
  open: boolean
  view: WorkbenchView
  surface: WorkbenchSurface
  executionSection: ExecutionSection
  onView: (view: WorkbenchView) => void
  onSurface: (surface: WorkbenchSurface) => void
  onExecutionSection: (section: ExecutionSection) => void
  sessionID: string | null
  sessionDirectory: string | null
  diffs: FileDiffEntry[]
  terminalOpen: boolean
  onToggleTerminal: () => void
  onOpenFile: (rel: string) => void
  onSendAnnotation?: (text: string) => void
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
  onSendComment?: (sid: string, text: string) => void
  executionView: JSX.Element
  reviewView: JSX.Element
}

export function WorkbenchShell(props: WorkbenchShellProps) {
  return (
    <div class="mafw-rw-shell">
      <div class="mafw-rw-l1" role="tablist" aria-label="右工作台">
        <For each={WORKBENCH_VIEWS}>
          {(item) => (
            <ButtonV2
              variant={props.view === item.id ? "contrast" : "ghost"}
              size="small"
              class="mafw-rw-tab"
              role="tab"
              aria-selected={props.view === item.id}
              aria-label={item.label}
              onClick={() => props.onView(item.id)}
            >
              <Icon name={item.id === "workbench" ? "code" : item.id === "execution" ? "dot-grid" : "review"} size="small" />
              {item.label}
            </ButtonV2>
          )}
        </For>
        <div class="mafw-rw-l1-spacer" />
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

      <Show when={props.view !== "review"}>
        <div class="mafw-rw-l2">
          <Show
            when={props.view === "workbench"}
            fallback={
              <DropdownMenu>
                <DropdownMenu.Trigger as={ButtonV2} variant="ghost" size="small" class="mafw-rw-exec-trigger">
                  <span>{executionSectionLabel(props.executionSection)}</span>
                  <Icon name="chevron-down" size="small" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="mafw-rw-exec-content">
                    <For each={EXECUTION_SECTIONS}>
                      {(section) => (
                        <DropdownMenu.Item onSelect={() => props.onExecutionSection(section.id)}>
                          <DropdownMenu.ItemLabel>{section.label}</DropdownMenu.ItemLabel>
                          <Show when={props.executionSection === section.id}>
                            <Icon name="check-small" size="small" class="mafw-rw-check" />
                          </Show>
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            }
          >
            <For each={WORKBENCH_SURFACES}>
              {(surface) => (
                <ButtonV2
                  variant={props.surface === surface.id ? "contrast" : "ghost"}
                  size="small"
                  class="mafw-rw-l2-tab"
                  aria-pressed={props.surface === surface.id}
                  onClick={() => props.onSurface(surface.id)}
                >
                  {surface.label}
                </ButtonV2>
              )}
            </For>
          </Show>
        </div>
      </Show>

      <div class="mafw-rw-content">
        <div class="mafw-rw-pane" classList={{ "is-active": props.view === "workbench" }}>
          <WorkbenchCodeView
            surface={props.surface}
            sessionID={props.sessionID}
            sessionDirectory={props.sessionDirectory}
            diffs={props.diffs}
            onOpenFile={props.onOpenFile}
            onSendAnnotation={props.onSendAnnotation}
            onAddAnnotation={props.onAddAnnotation}
            onSendComment={props.onSendComment}
          />
        </div>
        <div class="mafw-rw-pane" classList={{ "is-active": props.view === "execution" }}>
          {props.executionView}
        </div>
        <div class="mafw-rw-pane" classList={{ "is-active": props.view === "review" }}>
          {props.reviewView}
        </div>
      </div>

      <div class="mafw-rw-terminal" classList={{ "is-collapsed": !props.terminalOpen }}>
        <TerminalDock directory={props.sessionDirectory} active={props.open && props.terminalOpen} />
      </div>
    </div>
  )
}
