import { Show, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { Icon } from "@mafw/ui/v2/icon"

export type DockBannerKind = "info" | "warn" | "error"

/** Banner tone class（纯函数：三档语义色，主题 token 驱动）。 */
export function dockBannerClass(kind: DockBannerKind): string {
  return `mafw-panel-banner mafw-panel-banner-${kind}`
}

/** 统一面板头：左标题 + 右动作位。工作台/会话面板共用。 */
export function DockPanelHeader(props: { title: string; children?: JSX.Element }) {
  return (
    <div class="mafw-panel-head">
      <span class="mafw-panel-head-title" title={props.title}>{props.title}</span>
      <div class="mafw-panel-head-actions">{props.children}</div>
    </div>
  )
}

/** 统一空态：居中图标 + 说明 + 可选下一步提示（welcome view 式动作）。 */
export function DockEmpty(props: {
  icon?: string
  text: string
  hint?: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div class="mafw-panel-empty">
      <Show when={props.icon}>
        <Icon name={props.icon!} size="large" class="mafw-panel-empty-icon" />
      </Show>
      <p class="mafw-panel-empty-text">{props.text}</p>
      <Show when={props.hint}>
        <p class="mafw-panel-empty-hint">{props.hint}</p>
      </Show>
      <Show when={props.action}>
        {(action) => (
          <ButtonV2 variant="outline" size="small" onClick={action().onClick}>
            {action().label}
          </ButtonV2>
        )}
      </Show>
    </div>
  )
}

/** 统一常驻条：info/warn/error + 可选 loading + 恢复动作；
 *  children = 多动作场景（如编辑器冲突的三选一）。 */
export function DockBanner(props: {
  kind: DockBannerKind
  text: string
  action?: { label: string; onClick: () => void }
  busy?: boolean
  children?: JSX.Element
}) {
  return (
    <div class={dockBannerClass(props.kind)} role={props.kind === "error" ? "alert" : "status"}>
      <Show when={props.busy}>
        <LoaderV2 width={16} height={16} />
      </Show>
      <span class="mafw-panel-banner-text">{props.text}</span>
      {props.children}
      <Show when={props.action}>
        {(action) => (
          <ButtonV2 variant="outline" size="small" onClick={action().onClick}>
            {action().label}
          </ButtonV2>
        )}
      </Show>
    </div>
  )
}
