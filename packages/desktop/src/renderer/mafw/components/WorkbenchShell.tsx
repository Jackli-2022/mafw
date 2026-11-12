// Plan D1 右工作台壳：项目 / Goal / 内容 / 审阅是上下文，不是四个工具 Tab。
// 内容上下文内保留 文件 / 浏览器 / 终端 + 插件 surface；执行详情收进抽屉。
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import { DropdownMenu } from "@mafw/ui/dropdown-menu"
import {
  EXECUTION_SECTIONS,
  executionSectionLabel,
  type ExecutionSection,
  type WorkbenchSurface,
} from "../workbench-views"
import type { WorkbenchContext } from "../workbench-context"
import { observePluginTabCapacity, planPluginTabs, type PluginTabSurface } from "../plugins/plugin-view-model"
import type { PluginWebSurfaceView } from "../plugins/plugin-web-surface"
import { WorkbenchCodeView } from "./WorkbenchCodeView"
import { ContentScopeHeader } from "./ContentScopeHeader"
import { FrameBar } from "./FrameBar"
import { LensBar } from "./LensBar"
import { FocusStage } from "./FocusStage"
import { SubjectPicker } from "./SubjectPicker"
import type { Focus, Lens } from "../focus/focus-model"
import type { FrameView } from "../focus/frame-view"
import type { FocusOpenRequest } from "../focus/focus-open"
import type { PickerItem } from "../focus/picker-model"
import type { ContentIntent } from "../content-intent"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { AnnotationAnchor } from "../../../shared/annotation-types"

export type WorkbenchShellProps = {
  open: boolean
  context: WorkbenchContext
  contextLabel: string
  surface: WorkbenchSurface
  executionSection: ExecutionSection
  executionOpen: boolean
  onContext: (context: WorkbenchContext) => void
  onBackToProject: () => void
  onSurface: (surface: WorkbenchSurface) => void
  onExecutionSection: (section: ExecutionSection) => void
  onExecutionOpen: (open: boolean) => void
  sessionID: string | null
  sessionDirectory?: string | null
  contentRoot: string | null
  contentScopeKey: string | null
  /** Plugin Web surfaces stay session/project-bound; they are not project files. */
  pluginProjectDir: string | null
  contentScopeLabel: string
  contentScopeIsGoal: boolean
  contentIntent: ContentIntent
  onContentIntent: (intent: ContentIntent) => void
  contentDocument: string | null
  onContentDocument: (rel: string | null) => void
  contentSplit: boolean
  onContentSplit: (open: boolean) => void
  canReview: boolean
  onContentReview: () => void
  canGoBack: boolean
  backLabel: string | null
  onBack: () => void
  onReturnToProjectContent: () => void
  diffs: FileDiffEntry[]
  onOpenFile: (rel: string) => void
  onSendAnnotation?: (text: string, opts?: { imageDataUrl?: string }) => void
  onAddAnnotation?: (a: {
    rel: string
    startLine: number
    endLine: number
    code: string
    comment: string
    anchor?: AnnotationAnchor
    imageDataUrl?: string
    scopeKey?: string
    root?: string
  }) => void
  onSendComment?: (sid: string, text: string) => void
  /** 批注反馈标记点击 → 切审阅上下文。 */
  onOpenReview?: () => void
  /** Focus：右工作台占满 chat+workbench 区域（chat 列宽 0，仍保持挂载）。 */
  focus?: boolean
  onToggleFocus?: () => void
  /** 焦点栈当前对象；非空时优先于 legacy context。 */
  focusView: Focus | null
  frame: FrameView | null
  lenses: readonly Lens[]
  onFocusLens: (lens: Lens) => void
  onFocusBack: () => void
  onFocusCrumb: (index: number) => void
  focusOpenRequest?: FocusOpenRequest | null
  /** 器械栏（评审队列 / 决定）；由 MafwShell 按当前 focus 生成。 */
  instrumentRail?: JSX.Element | null
  pickerOpen: boolean
  pickerItems: readonly PickerItem[]
  onOpenPicker: () => void
  onClosePicker: () => void
  onPick: (item: PickerItem) => void
  workView: JSX.Element
  goalView: JSX.Element
  executionView: JSX.Element
  reviewView: JSX.Element
  /** Dynamic L2 tabs contributed by unified plugin packages. */
  pluginSurfaces: readonly PluginTabSurface[]
  /** Mounts one plugin surface (MafwShell owns descriptor resolution). */
  renderPluginSurface: (id: string) => JSX.Element
  /** Task 9: Web surfaces (sandboxed pages) mounted by `WorkbenchCodeView`. */
  webSurfaces?: readonly PluginWebSurfaceView[]
  gatewayUrl?: string
  onWebBadge?: (surfaceId: string, count: number) => void
  onWebTitle?: (surfaceId: string, title: string) => void
  onWebError?: (surfaceId: string, message: string) => void
}

export function WorkbenchShell(props: WorkbenchShellProps) {
  const surfaceTabClass = (id: string) =>
    `mafw-rw-l2-tab-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`

  // Plugin tabs overflow when the L2 strip runs out of horizontal room. The
  // observer is attached lazily from the L2 ref because the strip only exists
  // in the content context.
  const [pluginTabCapacity, setPluginTabCapacity] = createSignal(6)
  let disposeCapacity: (() => void) | null = null
  const attachCapacityObserver = (element: HTMLDivElement | null) => {
    disposeCapacity?.()
    disposeCapacity = null
    if (!element) return
    disposeCapacity = observePluginTabCapacity(element, setPluginTabCapacity, (notify) => {
      if (typeof ResizeObserver === "undefined") return null
      const observer = new ResizeObserver(notify)
      return {
        observe: (target) => observer.observe(target as unknown as Element),
        disconnect: () => observer.disconnect(),
      }
    })
  }
  createEffect(() => {
    if (props.context !== "content") attachCapacityObserver(null)
  })
  onCleanup(() => {
    disposeCapacity?.()
    disposeCapacity = null
  })
  const pluginTabs = createMemo(() =>
    planPluginTabs(props.pluginSurfaces, {
      activeId: props.surface,
      capacity: pluginTabCapacity(),
    }),
  )
  const pluginSurfaceIds = () => props.pluginSurfaces.map((surface) => surface.id)

  // ButtonV2/Kobalte 不把 data-id/tabIndex 透传到原生 button；用 class 标记并在 surface 变化后同步 roving tabindex。
  createEffect(() => {
    const context = props.context
    const surface = props.surface
    const pluginIds = props.pluginSurfaces.map((entry) => entry.id)
    queueMicrotask(() => {
      if (context !== "content") return
      for (const id of pluginIds) {
        const el = document.querySelector<HTMLButtonElement>(`.${surfaceTabClass(id)}`)
        if (el) el.tabIndex = surface === id ? 0 : -1
      }
    })
  })

  const onL2KeyDown = (e: KeyboardEvent) => {
    const ids = pluginSurfaceIds()
    const index = ids.findIndex((id) => id === props.surface)
    if (index < 0) return
    const next = e.key === "ArrowRight" ? ids[index + 1]
      : e.key === "ArrowLeft" ? ids[index - 1]
      : e.key === "Home" ? ids[0]
      : e.key === "End" ? ids[ids.length - 1]
      : undefined
    if (!next) return
    e.preventDefault()
    props.onSurface(next as WorkbenchSurface)
    queueMicrotask(() => {
      document.querySelector<HTMLElement>(`.${surfaceTabClass(next)}`)?.focus()
    })
  }

  return (
    <div class="mafw-rw-shell">
      <Show when={props.focusView} keyed>
        {(focus) => (
          <>
            <FrameBar
              crumbs={props.frame?.crumbs ?? []}
              badges={props.frame?.badges ?? []}
              canBack={true}
              onBack={props.onFocusBack}
              onCrumb={props.onFocusCrumb}
              onOpenPicker={props.onOpenPicker}
            />
            <LensBar
              lenses={props.lenses}
              active={focus.lens}
              onLens={props.onFocusLens}
            />
          </>
        )}
      </Show>

      <Show when={!props.focusView}>
        <div class="mafw-rw-head">
        <div class="mafw-rw-context">
          <Show when={props.context !== "project"}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-rw-back"
              aria-label="返回"
              onClick={props.onBackToProject}
            >
              <Icon name="arrow-left" size="small" />
            </ButtonV2>
          </Show>
          <span class="mafw-rw-context-label">{props.contextLabel}</span>
        </div>
        <div class="mafw-rw-actions">
          <Show when={props.context === "project"}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-rw-files-entry"
              aria-label="打开项目文件"
              onClick={() => props.onSurface("code")}
            >
              <Icon name="code" size="small" />
              文件
            </ButtonV2>
          </Show>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-rw-exec-toggle"
            aria-label={props.executionOpen ? "收起执行详情" : "打开执行详情"}
            aria-pressed={props.executionOpen}
            onClick={() => props.onExecutionOpen(!props.executionOpen)}
          >
            <Icon name="dot-grid" size="small" />
            执行
          </ButtonV2>
          <Show when={props.onToggleFocus}>
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-rw-focus"
              aria-label={props.focus ? "退出工作台全宽" : "工作台全宽"}
              aria-pressed={props.focus}
              onClick={() => props.onToggleFocus?.()}
            >
              <Icon name="layout-right-full" size="small" />
            </ButtonV2>
          </Show>
        </div>
      </div>

      <Show when={props.context === "content" && props.pluginSurfaces.length > 0}>
        <div
          class="mafw-rw-l2"
          ref={(element) => {
            attachCapacityObserver(element)
          }}
          role="tablist"
          aria-label="插件视图"
          onKeyDown={onL2KeyDown}
        >
          <For each={pluginTabs().visible}>
            {(surface) => (
              <ButtonV2
                variant="ghost"
                size="small"
                class={`mafw-rw-l2-tab ${surfaceTabClass(surface.id)}`}
                role="tab"
                aria-selected={props.surface === surface.id}
                aria-label={`${surface.label}（${surface.descriptor.title || surface.descriptor.name}）`}
                onClick={() => props.onSurface(surface.id)}
              >
                {surface.label}
              </ButtonV2>
            )}
          </For>
          <Show when={pluginTabs().overflow.length > 0}>
            <DropdownMenu>
              <DropdownMenu.Trigger
                as={ButtonV2}
                variant="ghost"
                size="small"
                class="mafw-rw-l2-overflow"
                aria-label="更多插件视图"
              >
                <span>更多</span>
                <Icon name="chevron-down" size="small" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="mafw-rw-exec-content">
                  <For each={pluginTabs().overflow}>
                    {(surface) => (
                      <DropdownMenu.Item onSelect={() => props.onSurface(surface.id)}>
                        <DropdownMenu.ItemLabel>{surface.label}</DropdownMenu.ItemLabel>
                        <DropdownMenu.ItemDescription>
                          {surface.descriptor.title || surface.descriptor.name}
                        </DropdownMenu.ItemDescription>
                        <Show when={props.surface === surface.id}>
                          <Icon name="check-small" size="small" class="mafw-rw-check" />
                        </Show>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </Show>
        </div>
      </Show>

      <Show when={props.context === "content"}>
        <ContentScopeHeader
          label={props.contentScopeLabel}
          isGoalScope={props.contentScopeIsGoal}
          intent={props.surface === "code" ? props.contentIntent : undefined}
          onIntent={props.surface === "code" ? props.onContentIntent : undefined}
          surface={props.surface}
          onSurface={props.onSurface}
          splitOpen={props.contentSplit}
          onToggleSplit={() => props.onContentSplit(!props.contentSplit)}
          canReview={props.canReview}
          onReview={props.onContentReview}
          canGoBack={props.canGoBack}
          backLabel={props.backLabel}
          onBack={props.onBack}
          onReturnToProject={props.onReturnToProjectContent}
        />
      </Show>
      </Show>

      <Show when={props.focusView} keyed>
        {(focus) => (
          <div class="mafw-focus-body">
            <FocusStage
              focus={focus}
              active={props.open}
              sessionID={props.sessionID}
              sessionDirectory={props.sessionDirectory}
              contentRoot={props.contentRoot}
              contentScopeKey={props.contentScopeKey}
              diffs={props.diffs}
              onActiveFileChange={props.onContentDocument}
              openRequest={props.focusOpenRequest}
              onSendAnnotation={props.onSendAnnotation}
              onAddAnnotation={props.onAddAnnotation}
              onSendComment={props.onSendComment}
              onOpenReview={props.onOpenReview}
              renderPluginSurface={props.renderPluginSurface}
              webSurfaces={props.webSurfaces}
              gatewayUrl={props.gatewayUrl}
              onWebBadge={props.onWebBadge}
              onWebTitle={props.onWebTitle}
              onWebError={props.onWebError}
              renderGoal={() => props.goalView}
              renderWorld={() => props.workView}
            />
            <Show when={props.instrumentRail}>
              <div class="mafw-focus-rail-slot">{props.instrumentRail}</div>
            </Show>
          </div>
        )}
      </Show>

      <div class="mafw-rw-content" style={{ display: props.focusView ? "none" : undefined }}>
        <div class="mafw-rw-pane" classList={{ "is-active": props.context === "project" }}>
          {props.workView}
        </div>
        <div class="mafw-rw-pane" classList={{ "is-active": props.context === "goal" }}>
          {props.goalView}
        </div>
        <div class="mafw-rw-pane" classList={{ "is-active": props.context === "content" }}>
          <Show when={!props.focusView}>
            <WorkbenchCodeView
              active={props.open && props.context === "content"}
              surface={props.surface}
              sessionID={props.sessionID}
              contentRoot={props.contentRoot}
              contentScopeKey={props.contentScopeKey}
              intent={props.contentIntent}
              onIntent={props.onContentIntent}
              onActiveFileChange={props.onContentDocument}
              splitOpen={props.contentSplit}
              onSplitOpen={props.onContentSplit}
              pluginProjectDir={props.pluginProjectDir}
              diffs={props.diffs}
              onOpenFile={props.onOpenFile}
              onSendAnnotation={props.onSendAnnotation}
              onAddAnnotation={props.onAddAnnotation}
              onSendComment={props.onSendComment}
              onOpenReview={props.onOpenReview}
              renderPluginSurface={props.renderPluginSurface}
              webSurfaces={props.webSurfaces}
              gatewayUrl={props.gatewayUrl}
              onWebBadge={props.onWebBadge}
              onWebTitle={props.onWebTitle}
              onWebError={props.onWebError}
            />
          </Show>
        </div>
        <div class="mafw-rw-pane" classList={{ "is-active": props.context === "review" }}>
          {props.reviewView}
        </div>
      </div>

      <Show when={!props.focusView && props.executionOpen}>
        <div class="mafw-rw-exec-drawer" role="region" aria-label="执行详情">
          <div class="mafw-rw-exec-head">
            <span class="mafw-rw-exec-title">执行详情</span>
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
            <ButtonV2
              variant="ghost"
              size="small"
              class="mafw-rw-exec-close"
              aria-label="关闭执行详情"
              onClick={() => props.onExecutionOpen(false)}
            >
              <Icon name="close" size="small" />
            </ButtonV2>
          </div>
          <div class="mafw-rw-exec-body">{props.executionView}</div>
        </div>
      </Show>

      <SubjectPicker
        open={props.pickerOpen}
        items={props.pickerItems}
        onClose={props.onClosePicker}
        onPick={props.onPick}
      />
    </div>
  )
}
