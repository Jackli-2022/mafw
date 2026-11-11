import { Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"

/** 内容工作台头部：当前内容根 + 显式返回动作。 */
export function ContentScopeHeader(props: {
  label: string
  isGoalScope: boolean
  canGoBack: boolean
  onBack: () => void
  onReturnToProject: () => void
}): JSX.Element {
  return (
    <div class="mafw-content-scope">
      <span class="mafw-content-scope-label" aria-live="polite">{props.label}</span>
      <div class="mafw-content-scope-actions">
        <Show when={props.canGoBack}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-content-scope-back"
            onClick={props.onBack}
          >
            <Icon name="chevron-left" size="small" />
            返回
          </ButtonV2>
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
