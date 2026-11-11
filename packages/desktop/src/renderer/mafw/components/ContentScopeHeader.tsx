import { For, Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import { CONTENT_INTENTS, type ContentIntent } from "../content-intent"
import type { WorkbenchSurface } from "../workbench-views"

/** 内容工作台头部：当前内容根 + 意图（阅读 / 修改）+ viewer 工具 + 显式返回动作。 */
export function ContentScopeHeader(props: {
  label: string
  isGoalScope: boolean
  canGoBack: boolean
  /** 返回目标（scope 标签 + 文件）；缺省时只显示「返回」。 */
  backLabel?: string | null
  intent?: ContentIntent
  onIntent?: (intent: ContentIntent) => void
  surface: WorkbenchSurface
  onSurface: (surface: WorkbenchSurface) => void
  splitOpen?: boolean
  onToggleSplit?: () => void
  canReview?: boolean
  onReview?: () => void
  onBack: () => void
  onReturnToProject: () => void
}): JSX.Element {
  return (
    <div class="mafw-content-scope">
      <div class="mafw-content-scope-main">
        <span class="mafw-content-scope-label" aria-live="polite">{props.label}</span>
        <Show when={props.intent}>
          <div class="mafw-content-intents" role="group" aria-label="内容意图">
            <For each={CONTENT_INTENTS}>
              {(item) => (
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-content-intent"
                  aria-pressed={props.intent === item.id}
                  onClick={() => props.onIntent?.(item.id)}
                >
                  {item.label}
                </ButtonV2>
              )}
            </For>
          </div>
        </Show>
      </div>
      <div class="mafw-content-scope-actions">
        <Show when={props.surface === "code" && props.onToggleSplit}>
          <TooltipV2 value={props.splitOpen ? "关闭分屏" : "分屏对照"} openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-content-scope-split"
              aria-label={props.splitOpen ? "关闭分屏" : "分屏对照"}
              aria-pressed={!!props.splitOpen}
              onClick={() => props.onToggleSplit?.()}
            >
              <Icon name="layout-right-partial" size="small" />
            </ButtonV2>
          </TooltipV2>
        </Show>
        <Show when={props.surface !== "code"}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-content-scope-document"
            onClick={() => props.onSurface("code")}
          >
            <Icon name="code" size="small" />
            返回文档
          </ButtonV2>
        </Show>
        <TooltipV2 value="浏览器" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-content-scope-tool mafw-content-scope-browser"
            aria-label="浏览器"
            aria-pressed={props.surface === "browser"}
            onClick={() => props.onSurface("browser")}
          >
            <Icon name="globe" size="small" />
          </ButtonV2>
        </TooltipV2>
        <TooltipV2 value="终端" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-content-scope-tool mafw-content-scope-terminal"
            aria-label="终端"
            aria-pressed={props.surface === "terminal"}
            onClick={() => props.onSurface("terminal")}
          >
            <Icon name="terminal" size="small" />
          </ButtonV2>
        </TooltipV2>
        <Show when={props.canReview}>
          <ButtonV2
            variant="outline"
            size="small"
            class="mafw-content-scope-review"
            onClick={props.onReview}
          >
            验收
          </ButtonV2>
        </Show>
        <Show when={props.canGoBack}>
          <TooltipV2 value={props.backLabel ?? "返回"} openDelay={300}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-content-scope-back"
              onClick={props.onBack}
            >
              <Icon name="chevron-left" size="small" />
              返回
            </ButtonV2>
          </TooltipV2>
        </Show>
        <Show when={props.isGoalScope}>
          <ButtonV2
            variant="outline"
            size="small"
            class="mafw-content-scope-return"
            onClick={props.onReturnToProject}
          >
            返回项目文件
          </ButtonV2>
        </Show>
      </div>
    </div>
  )
}
