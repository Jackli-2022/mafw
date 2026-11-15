// Task 12: unified plugin-package management UI.
//
// Rows are projected from the Hub inventory + committed client descriptors by
// the pure model in `plugin-packages-model.ts`. This component only calls the
// named preload methods:
//   plugins.list/client/check/installPackage/apply/reload/enablePackage/
//   disablePackage/removePackage/chooseDirectory/invoke (through the existing
//   `PluginConfigPage`).
// Directory selection happens in the main process; the renderer never receives
// a generic filesystem API.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import type { PluginDoctorReport, PluginsPackageEntry } from "@mafw/sdk"
import type { PluginConfigPageDescriptor } from "@mafw/plugin-contract"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/v2/icon"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { SelectV2 } from "@mafw/ui/v2/select-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { ConfirmOverlay } from "../components/ConfirmOverlay"
import { describePackageAction, type PackageActionResultLike } from "../plugins/package-action-feedback"
import { creatorEntryReasonText, type CreatorEntryReason } from "./creator-entry"
import { PluginConfigPage } from "../plugins/PluginConfigPage"
import {
  pluginClientRevision,
  pluginDescriptors,
  pluginDiagnostics,
  pluginPending,
  refreshPluginClient,
} from "../plugins/plugin-store"
import {
  buildPackageRows,
  deleteConfirmation,
  disableConfirmation,
  enableConfirmation,
  installPickResult,
  installReviewConfirmation,
  planInstallPreview,
  type ConfirmationRequest,
  type InstallPreview,
  type PackageRowView,
} from "./plugin-packages-model"

interface PendingConfirmation extends ConfirmationRequest {
  onConfirm: () => void
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function pillClass(view: PackageRowView): string {
  if (view.status === "active") return "mafw-hub-pill mafw-hub-pill-enabled"
  if (view.status === "error") return "mafw-hub-pill mafw-hub-pill-error"
  if (view.status === "pending") return "mafw-hub-pill mafw-hub-pill-config-disabled"
  return "mafw-hub-pill"
}

export interface CreatorEntryControl {
  available: boolean
  reason?: CreatorEntryReason
  onCreate: () => void
}

export function PluginPackagesSection(props: { sessionID?: string; creatorEntry?: CreatorEntryControl }) {
  const [inventory, setInventory] = createSignal<PluginsPackageEntry[]>([])
  const [safeMode, setSafeMode] = createSignal(false)
  const [doctorReport, setDoctorReport] = createSignal<PluginDoctorReport | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [loadError, setLoadError] = createSignal("")
  const [busy, setBusy] = createSignal<string | null>(null)
  const [pickerBusy, setPickerBusy] = createSignal(false)
  const [previewBusy, setPreviewBusy] = createSignal(false)
  const [installBusy, setInstallBusy] = createSignal(false)
  const [checkedPath, setCheckedPath] = createSignal<string | null>(null)
  const [preview, setPreview] = createSignal<InstallPreview | null>(null)
  const [installError, setInstallError] = createSignal("")
  const [confirmReq, setConfirmReq] = createSignal<PendingConfirmation | null>(null)
  const [configTarget, setConfigTarget] = createSignal<{ name: string; pageId: string } | null>(null)

  let loadSequence = 0
  let checkSequence = 0

  const rows = createMemo(() => buildPackageRows(inventory(), pluginDescriptors(), pluginDiagnostics()))
  const globalDiagnostics = createMemo(() =>
    pluginDiagnostics().filter((notice) => !notice.package).slice(-3),
  )

  async function loadInventory(): Promise<void> {
    const sequence = ++loadSequence
    setLoading(true)
    try {
      const result = await window.api.mafw.plugins.list()
      if (sequence !== loadSequence) return
      setInventory(Array.isArray(result?.packages) ? result.packages : [])
      setSafeMode(result?.safeMode === true)
      setLoadError("")
    } catch (err) {
      if (sequence !== loadSequence) return
      setLoadError(errorText(err))
    } finally {
      if (sequence === loadSequence) setLoading(false)
    }
  }

  async function refreshAll(): Promise<void> {
    try {
      await refreshPluginClient()
    } catch {
      // Descriptor refresh is advisory here; inventory still refreshes below.
    }
    await loadInventory()
  }

  // Keep the Hub inventory current when the committed client revision or the
  // advisory pending map moves (SSE `plugins.changed` -> Task 7 store).
  createEffect(() => {
    pluginClientRevision()
    pluginPending()
    pluginDiagnostics()
    void loadInventory()
  })

  // Task 7 suppresses same-revision notifications; an external file scan can
  // change pending/error/disabled state without moving the client revision, so
  // the management view also refreshes on a slow poll while it is mounted.
  onMount(() => {
    const timer = setInterval(() => {
      if (!loading()) void loadInventory()
    }, 10_000)
    onCleanup(() => clearInterval(timer))
  })

  function askConfirmation(request: ConfirmationRequest, run: () => void): void {
    setConfirmReq({ ...request, onConfirm: run })
  }

  // ── Install flow ─────────────────────────────────────────────────────────

  async function chooseInstallDirectory(): Promise<void> {
    if (pickerBusy() || installBusy()) return
    setPickerBusy(true)
    try {
      const picked = await window.api.mafw.plugins.chooseDirectory()
      const result = installPickResult(picked)
      if (result.status === "cancelled") return
      if (result.status === "failed") {
        showToastV2({ description: `目录选择失败：${result.error}`, duration: 4000 })
        return
      }
      await checkCandidate(result.path)
    } catch (err) {
      showToastV2({ description: `目录选择失败：${errorText(err)}`, duration: 4000 })
    } finally {
      setPickerBusy(false)
    }
  }

  async function checkCandidate(path: string): Promise<void> {
    const sequence = ++checkSequence
    setCheckedPath(path)
    setPreview(null)
    setInstallError("")
    setPreviewBusy(true)
    try {
      const check = await window.api.mafw.plugins.check({ path })
      if (sequence !== checkSequence) return
      setPreview(planInstallPreview(inventory(), check))
    } catch (err) {
      if (sequence !== checkSequence) return
      setPreview({
        status: "invalid",
        error: `检查失败：${errorText(err)}`,
        contributions: [],
        overwrite: false,
      })
    } finally {
      if (sequence === checkSequence) setPreviewBusy(false)
    }
  }

  function requestInstall(): void {
    const current = preview()
    const path = checkedPath()
    if (!current || current.status !== "ready" || !path) return
    const confirmation = installReviewConfirmation(current)
    if (confirmation) {
      askConfirmation(confirmation, () => void installPackage(path))
      return
    }
    void installPackage(path)
  }

  async function installPackage(path: string): Promise<void> {
    const current = preview()
    if (!path || !current || current.status !== "ready") return
    setInstallBusy(true)
    setInstallError("")
    try {
      const result = await window.api.mafw.plugins.installPackage({
        path,
        overwrite: current.overwrite,
        ...(current.requiresConsent
          ? {
              accept: {
                trust: current.kind ?? "trusted",
                permissions: current.permissions ?? [],
              },
            }
          : {}),
      })
      if (result.application === "failed") {
        const message = result.error ?? "安装失败"
        setInstallError(message)
        showToastV2({ description: `安装失败：${message}`, duration: 4000 })
      } else if (result.application === "pending") {
        showToastV2({ description: `已安装 ${result.name}，新版本待应用`, duration: 3500 })
        setPreview(null)
        setCheckedPath(null)
      } else {
        showToastV2({ description: `已安装 ${result.name}`, duration: 3000 })
        setPreview(null)
        setCheckedPath(null)
      }
    } catch (err) {
      const message = errorText(err)
      setInstallError(message)
      showToastV2({ description: `安装失败：${message}`, duration: 4000 })
    } finally {
      setInstallBusy(false)
      await refreshAll()
    }
  }

  function cancelPreview(): void {
    if (installBusy()) return
    setPreview(null)
    setCheckedPath(null)
    setInstallError("")
  }

  // ── Row actions ──────────────────────────────────────────────────────────

  async function runPackageAction(
    key: string,
    name: string,
    verb: string,
    action: () => Promise<PackageActionResultLike | void>,
  ): Promise<void> {
    if (busy()) return
    setBusy(key)
    try {
      const result = await action()
      const message = describePackageAction(result, verb)
      showToastV2({
        description: message.description,
        duration: message.isError ? 4000 : 3000,
      })
    } catch (err) {
      showToastV2({ description: `${verb} ${name} 失败：${errorText(err)}`, duration: 4000 })
    } finally {
      setBusy(null)
      await refreshAll()
    }
  }

  function applyPending(view: PackageRowView): void {
    void runPackageAction(`apply:${view.name}`, view.name, "应用", () =>
      window.api.mafw.plugins.apply(view.name),
    )
  }

  function reloadPackage(view: PackageRowView): void {
    void runPackageAction(`reload:${view.name}`, view.name, "重新加载", () =>
      window.api.mafw.plugins.reload(view.name),
    )
  }

  function requestDisable(view: PackageRowView): void {
    askConfirmation(disableConfirmation(view), () => {
      void runPackageAction(`disable:${view.name}`, view.name, "停用", () =>
        window.api.mafw.plugins.disablePackage(view.name),
      )
    })
  }

  function requestEnable(view: PackageRowView): void {
    askConfirmation(enableConfirmation(view), () => {
      void runPackageAction(`enable:${view.name}`, view.name, "启用", () =>
        window.api.mafw.plugins.enablePackage(view.name),
      )
    })
  }

  function requestRemove(view: PackageRowView): void {
    askConfirmation(deleteConfirmation(view), () => {
      void runPackageAction(`remove:${view.name}`, view.name, "删除", () =>
        window.api.mafw.plugins.removePackage(view.name),
      )
    })
  }

  function requestKillAll(): void {
    askConfirmation({
      title: "停止所有插件包？",
      message: "所有非核心插件包会立即停止，并持久保持安全模式；需要人类凭据才能恢复。",
      confirmLabel: "停止全部",
      danger: true,
    }, () => {
      void runPackageAction("kill", "全部插件包", "停止", () =>
        window.api.mafw.plugins.kill().then(() => undefined),
      );
    })
  }

  function requestResumeAll(): void {
    askConfirmation({
      title: "恢复插件包？",
      message: "将退出安全模式并重新扫描未隔离、未停用的插件包。此操作需要人类凭据。",
      confirmLabel: "恢复",
      danger: false,
    }, () => {
      void runPackageAction("resume", "全部插件包", "恢复", () =>
        window.api.mafw.plugins.resume().then(() => undefined),
      );
    })
  }

  function runDoctor(view: PackageRowView): void {
    void (async () => {
      setBusy(`doctor:${view.name}`)
      try {
        setDoctorReport(await window.api.mafw.plugins.doctor(view.name))
      } catch (err) {
        showToastV2({ description: `诊断 ${view.name} 失败：${errorText(err)}`, duration: 4000 })
      } finally {
        setBusy(null)
      }
    })()
  }

  function requestQuarantine(view: PackageRowView): void {
    askConfirmation({
      title: `隔离插件包 ${view.name}？`,
      message: "该包会立即停止并从贡献列表移除，直到人类解除隔离。",
      confirmLabel: "隔离",
      danger: true,
    }, () => {
      void runPackageAction(`quarantine:${view.name}`, view.name, "隔离", () =>
        window.api.mafw.plugins.quarantine(view.name, "manual quarantine from desktop"),
      )
    })
  }

  function requestUnquarantine(view: PackageRowView): void {
    askConfirmation({
      title: `解除隔离 ${view.name}？`,
      message: "解除后该包会被重新扫描并可能立即激活。此操作需要人类凭据。",
      confirmLabel: "解除隔离",
      danger: false,
    }, () => {
      void runPackageAction(`unquarantine:${view.name}`, view.name, "解除隔离", () =>
        window.api.mafw.plugins.unquarantine(view.name),
      )
    })
  }

  function requestRollback(view: PackageRowView): void {
    askConfirmation({
      title: `回滚插件包 ${view.name}？`,
      message: "将恢复上一个 last-known-good 版本并重新加载。此操作需要人类凭据。",
      confirmLabel: "回滚",
      danger: true,
    }, () => {
      void runPackageAction(`rollback:${view.name}`, view.name, "回滚", () =>
        window.api.mafw.plugins.rollback(view.name),
      )
    })
  }

  async function revealSource(view: PackageRowView): Promise<void> {
    if (!view.source) return
    try {
      const ok = await window.api.revealPath(view.source)
      if (!ok) showToastV2({ description: "源文件不存在或无法定位", duration: 3000 })
    } catch (err) {
      showToastV2({ description: `无法定位源文件：${errorText(err)}`, duration: 3000 })
    }
  }

  function openConfig(view: PackageRowView): void {
    const pages = view.descriptor?.ui.configPages ?? []
    const first = pages[0]
    if (!first) return
    setConfigTarget({ name: view.name, pageId: first.id })
  }

  const configView = createMemo(() => {
    const target = configTarget()
    if (!target) return null
    const view = rows().find((row) => row.name === target.name)
    const pages = view?.descriptor?.ui.configPages ?? []
    const page = pages.find((candidate) => candidate.id === target.pageId) ?? pages[0]
    if (!view || !page) return null
    return { view, pages, page }
  })

  const configOptions = createMemo<PluginConfigPageDescriptor[]>(() => configView()?.pages ?? [])
  const safeModeActive = createMemo(() =>
    safeMode()
      || inventory().some((entry) => (entry as PluginsPackageEntry & { state?: string }).state === "safe-mode"),
  )

  return (
    <>
      <div class="mafw-config-section">
        <div class="mafw-config-section-header">
          <span class="mafw-config-section-icon"><Icon name="grid-plus" /></span>
          <span class="mafw-config-section-title">插件包</span>
          <ButtonV2
            variant="outline"
            size="small"
            disabled={loading() || !!busy()}
            onClick={() => void refreshAll()}
          >
            刷新
          </ButtonV2>
          <ButtonV2
            variant="contrast"
            size="small"
            disabled={pickerBusy() || installBusy()}
            onClick={() => void chooseInstallDirectory()}
          >
            {pickerBusy() ? "选择中…" : "安装本地目录"}
          </ButtonV2>
          <Show when={!safeModeActive()}>
            <ButtonV2
              variant="outline"
              size="small"
              disabled={busy() !== null}
              onClick={requestKillAll}
            >
              停止全部
            </ButtonV2>
          </Show>
          <Show when={safeModeActive()}>
            <ButtonV2
              variant="contrast"
              size="small"
              disabled={busy() !== null}
              onClick={requestResumeAll}
            >
              恢复插件
            </ButtonV2>
          </Show>
          {/* Creator entry (spec §15.7): opens an ordinary Session whose agent
              is `mafw-create`. Availability is derived by the shell; the
              inline reason keeps a disabled button from failing silently. */}
          <Show when={props.creatorEntry}>
            {(entry) => (
              <>
                <Show when={!entry().available}>
                  <span
                    class="mafw-config-hint"
                    style={{ "margin-top": "0", "white-space": "nowrap" }}
                  >
                    {creatorEntryReasonText(entry().reason)}
                  </span>
                </Show>
                <ButtonV2
                  variant="outline"
                  size="small"
                  disabled={!entry().available}
                  onClick={() => entry().onCreate()}
                >
                  让 Agent 创建插件
                </ButtonV2>
              </>
            )}
          </Show>
        </div>
        <div class="mafw-config-section-body" style={{ "padding-top": "12px" }}>
          <div class="mafw-config-section-desc">
            统一插件包（目录内含 plugin.json）。安装前先检查候选包；覆盖已安装包会显示版本与贡献差异并要求确认。
          </div>

          <Show when={safeModeActive()}>
            <div class="mafw-hub-empty">
              安全模式：所有插件包已停止。确认问题后由人类凭据恢复。
            </div>
          </Show>

          <Show when={loadError()}>
            <div class="mafw-config-error-row">
              <span>插件包列表加载失败：{loadError()}</span>
              <ButtonV2 variant="outline" size="small" onClick={() => void loadInventory()}>
                重试
              </ButtonV2>
            </div>
          </Show>

          <Show when={globalDiagnostics().length > 0}>
            <div class="mafw-hub-install-hint">
              <For each={globalDiagnostics()}>
                {(notice) => <div>[{notice.code}] {notice.message}</div>}
              </For>
            </div>
          </Show>

          <Show when={previewBusy()}>
            <div class="mafw-config-inline-loading">
              <LoaderV2 width={12} height={12} /> 检查插件包…
            </div>
          </Show>

          <Show when={preview()}>
            {(current) => (
              <div class="mafw-hub-install">
                <div class="mafw-hub-row-top">
                  <span class="mafw-hub-name">
                    {current().name ?? "未命名插件包"}
                    {current().version ? ` · v${current().version}` : ""}
                  </span>
                  <Show when={current().overwrite}>
                    <span class="mafw-hub-pill mafw-hub-pill-config-disabled">
                      <span class="mafw-hub-pill-dot" />
                      覆盖安装
                    </span>
                  </Show>
                </div>
                <Show when={checkedPath()}>
                  <div class="mafw-hub-meta">
                    <span class="mafw-hub-file">{checkedPath()}</span>
                  </div>
                </Show>

                <Show when={current().status === "invalid"}>
                  <div class="mafw-hub-error-text">{current().error}</div>
                </Show>

                <Show when={current().status === "ready"}>
                  <div class="mafw-hub-row-top">
                    <For each={current().contributions}>
                      {(contribution) => <span class="mafw-hub-tag">{contribution}</span>}
                    </For>
                    <Show when={current().contributions.length === 0}>
                      <span class="mafw-config-hint">未声明贡献</span>
                    </Show>
                  </div>
                  <Show when={current().diff}>
                    {(diff) => (
                      <div class="mafw-hub-meta">
                        <span>版本 {diff().existingVersion ?? "未知"} → {diff().nextVersion ?? "未知"}</span>
                        <Show when={diff().added.length > 0}>
                          <span class="mafw-hub-tag">新增：{diff().added.join(", ")}</span>
                        </Show>
                        <Show when={diff().removed.length > 0}>
                          <span class="mafw-hub-error-text">移除：{diff().removed.join(", ")}</span>
                        </Show>
                        <Show when={diff().added.length === 0 && diff().removed.length === 0}>
                          <span>贡献声明无变化</span>
                        </Show>
                        <Show when={diff().replacesActive}>
                          <span>将替换当前运行版本</span>
                        </Show>
                      </div>
                    )}
                  </Show>
                </Show>

                <Show when={installError()}>
                  <div class="mafw-hub-error-text">{installError()}</div>
                </Show>

                <div class="mafw-hub-actions">
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    disabled={installBusy()}
                    onClick={cancelPreview}
                  >
                    取消
                  </ButtonV2>
                  <ButtonV2
                    variant="outline"
                    size="small"
                    disabled={previewBusy() || installBusy() || !checkedPath()}
                    onClick={() => {
                      const path = checkedPath()
                      if (path) void checkCandidate(path)
                    }}
                  >
                    重新检查
                  </ButtonV2>
                  <ButtonV2
                    variant="contrast"
                    size="small"
                    disabled={
                      current().status !== "ready" || installBusy() || !checkedPath()
                    }
                    onClick={requestInstall}
                  >
                    {installBusy()
                      ? "安装中…"
                      : current().overwrite
                        ? "覆盖安装"
                        : "安装"}
                  </ButtonV2>
                  <Show when={installBusy()}>
                    <LoaderV2 width={12} height={12} />
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <Show when={loading() && rows().length === 0}>
            <div class="mafw-config-inline-loading">
              <LoaderV2 width={12} height={12} /> 加载插件包…
            </div>
          </Show>

          <For each={rows()}>
            {(view) => (
              <div class="mafw-hub-row">
                <div class="mafw-hub-row-main">
                  <div class="mafw-hub-row-top">
                    <span class="mafw-hub-name">{view.name}</span>
                    <Show when={view.version}>
                      <span class="mafw-hub-tag">v{view.version}</span>
                    </Show>
                    <span class={pillClass(view)}>
                      <span class="mafw-hub-pill-dot" />
                      {view.statusLabel}
                    </span>
                    <Show when={view.retainsActiveRevision}>
                      <span class="mafw-hub-tag">保留 active 版本</span>
                    </Show>
                    <Show when={view.kind}>
                      <span class="mafw-hub-tag">{view.kind}</span>
                    </Show>
                    <Show when={view.transport}>
                      <span class="mafw-hub-tag">{view.transport}</span>
                    </Show>
                    <Show when={(view.permissions ?? []).length > 0}>
                      <span class="mafw-hub-tag">权限 {view.permissions.join(", ")}</span>
                    </Show>
                  </div>

                  <Show when={view.contributions.length > 0}>
                    <div class="mafw-hub-row-top">
                      <For each={view.contributions}>
                        {(badge) => <span class="mafw-hub-tag">{badge.label}</span>}
                      </For>
                    </div>
                  </Show>

                  <div class="mafw-hub-meta">
                    <Show when={view.source}>
                      <span
                        class="mafw-hub-file"
                        style={{
                          "max-width": "100%",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                      >
                        {view.source}
                      </span>
                    </Show>
                    <Show when={view.activeRevision}>
                      <span>
                        active <span class="mafw-hub-file">{view.activeRevision}</span>
                      </span>
                    </Show>
                    <Show when={view.pendingRevision}>
                      <span>
                        pending <span class="mafw-hub-file">{view.pendingRevision}</span>
                      </span>
                    </Show>
                  </div>

                  <Show when={view.pendingReason}>
                    <div class="mafw-config-hint">{view.pendingReason}</div>
                  </Show>

                  <Show when={view.error}>
                    <div class="mafw-hub-meta">
                      <span class="mafw-hub-error-text">{view.error}</span>
                    </div>
                  </Show>
                  <Show when={view.quarantinedReason}>
                    <div class="mafw-config-hint">隔离原因：{view.quarantinedReason}</div>
                  </Show>
                  <Show when={view.degradedReason}>
                    <div class="mafw-config-hint">降级原因：{view.degradedReason}</div>
                  </Show>

                  <Show when={view.diagnostics.length > 0}>
                    <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                      <For each={view.diagnostics}>
                        {(diagnostic) => (
                          <div
                            classList={{
                              "mafw-hub-error-text": diagnostic.level === "error",
                              "mafw-config-hint": diagnostic.level !== "error",
                            }}
                          >
                            [{diagnostic.code}] {diagnostic.message}
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                <div class="mafw-hub-actions">
                  <Show when={view.actions.apply}>
                    <ButtonV2
                      variant="contrast"
                      size="small"
                      disabled={busy() === `apply:${view.name}`}
                      onClick={() => applyPending(view)}
                    >
                      {busy() === `apply:${view.name}` ? "应用中…" : "应用"}
                    </ButtonV2>
                  </Show>
                  <Show when={view.actions.config}>
                    <ButtonV2 variant="outline" size="small" onClick={() => openConfig(view)}>
                      配置
                    </ButtonV2>
                  </Show>
                  <Show when={view.actions.reload}>
                    <ButtonV2
                      variant="outline"
                      size="small"
                      disabled={busy() === `reload:${view.name}`}
                      onClick={() => reloadPackage(view)}
                    >
                      重新加载
                    </ButtonV2>
                  </Show>
                  <Show when={view.actions.reveal}>
                    <ButtonV2 variant="ghost" size="small" onClick={() => void revealSource(view)}>
                      定位
                    </ButtonV2>
                  </Show>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    disabled={busy() === `doctor:${view.name}`}
                    onClick={() => runDoctor(view)}
                  >
                    诊断
                  </ButtonV2>
                  <Show when={view.actions.quarantine}>
                    <ButtonV2 variant="ghost" size="small" onClick={() => requestQuarantine(view)}>
                      隔离
                    </ButtonV2>
                  </Show>
                  <Show when={view.actions.unquarantine}>
                    <ButtonV2 variant="outline" size="small" onClick={() => requestUnquarantine(view)}>
                      解除隔离
                    </ButtonV2>
                  </Show>
                  <ButtonV2 variant="ghost" size="small" onClick={() => requestRollback(view)}>
                    回滚
                  </ButtonV2>
                  <Show when={view.actions.disable}>
                    <ButtonV2 variant="ghost" size="small" onClick={() => requestDisable(view)}>
                      停用
                    </ButtonV2>
                  </Show>
                  <Show when={view.actions.enable}>
                    <ButtonV2 variant="outline" size="small" onClick={() => requestEnable(view)}>
                      启用
                    </ButtonV2>
                  </Show>
                  <ButtonV2 variant="ghost" size="small" onClick={() => requestRemove(view)}>
                    删除
                  </ButtonV2>
                </div>
              </div>
            )}
          </For>

          <Show when={doctorReport()}>
            {(report) => (
              <div class="mafw-hub-install">
                <div class="mafw-hub-row-top">
                  <span class="mafw-hub-name">诊断 · {report().name}</span>
                  <span class={report().ok ? "mafw-hub-pill mafw-hub-pill-enabled" : "mafw-hub-pill mafw-hub-pill-error"}>
                    {report().ok ? "通过" : "需处理"}
                  </span>
                  <ButtonV2 variant="ghost" size="small" onClick={() => setDoctorReport(null)}>
                    关闭
                  </ButtonV2>
                </div>
                <For each={report().checks}>
                  {(check) => (
                    <div
                      classList={{
                        "mafw-hub-error-text": check.status === "fail",
                        "mafw-config-hint": check.status !== "fail",
                      }}
                    >
                      [{check.status}] {check.id} · {check.message}
                      {check.fix ? ` · 修复：${check.fix}` : ""}
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>

          <Show when={!loading() && !loadError() && rows().length === 0}>
            <div class="mafw-hub-empty">
              暂无统一插件包。点击「安装本地目录」选择包含 plugin.json 的插件包。
            </div>
          </Show>

          <Show when={configView()}>
            {(target) => (
              <div class="mafw-hub-install">
                <div class="mafw-hub-row-top">
                  <span class="mafw-hub-name">{target().view.name} · 配置</span>
                  <Show when={target().pages.length > 1}>
                    <div style={{ width: "180px" }}>
                      <SelectV2<PluginConfigPageDescriptor>
                        options={configOptions()}
                        current={target().page}
                        value={(page) => page.id}
                        label={(page) => page.title || page.id}
                        onSelect={(page) => {
                          if (page) setConfigTarget({ name: target().view.name, pageId: page.id })
                        }}
                      />
                    </div>
                  </Show>
                  <ButtonV2 variant="ghost" size="small" onClick={() => setConfigTarget(null)}>
                    关闭
                  </ButtonV2>
                </div>
                <Show when={target().view.descriptor}>
                  {(descriptor) => (
                    <PluginConfigPage
                      descriptor={descriptor()}
                      page={target().page}
                      sessionID={props.sessionID}
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </div>

      <Portal>
        <ConfirmOverlay
          open={confirmReq() !== null}
          title={confirmReq()?.title ?? ""}
          message={confirmReq()?.message}
          confirmLabel={confirmReq()?.confirmLabel}
          danger={confirmReq()?.danger}
          onConfirm={() => {
            const request = confirmReq()
            setConfirmReq(null)
            request?.onConfirm()
          }}
          onCancel={() => setConfirmReq(null)}
        />
      </Portal>
    </>
  )
}
