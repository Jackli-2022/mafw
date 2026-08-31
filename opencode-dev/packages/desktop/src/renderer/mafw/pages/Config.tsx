// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For, ErrorBoundary } from "solid-js"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

interface ConfigSection {
  key: string
  expanded: boolean
  fields: [string, any][]
}

export type NavKey = "gateway" | "plugins" | "models" | "usage" | "opencode" | "mafw"

export function isNavKey(v: unknown): v is NavKey {
  return NAV_ITEMS.some(n => n.key === v)
}

const NAV_ITEMS: { key: NavKey; icon: string; label: string; desc: string }[] = [
  { key: "gateway",  icon: "⚡", label: "Gateway",  desc: "运行状态、重启与日志" },
  { key: "plugins",  icon: "🧩", label: "Plugins",  desc: "Runtime 与媒体引擎切换" },
  { key: "models",   icon: "🤖", label: "Models",   desc: "记忆 worker 与媒体每模态模型" },
  { key: "usage",    icon: "📊", label: "Usage",    desc: "Token Plan 限额、余额预算、平台 Cookie" },
  { key: "opencode", icon: "⚙️", label: "opencode", desc: "opencode 配置编辑器" },
  { key: "mafw",     icon: "🔧", label: "MAFW",     desc: "MAFW 原始配置（高级）" },
]

export function ConfigPage(props: { onBack?: () => void; initialSection?: NavKey }) {
  const [activeNav, setActiveNav] = createSignal<NavKey>(isNavKey(props.initialSection) ? props.initialSection : "gateway")

  // ── MAFW raw config ──
  const [sections, setSections] = createSignal<ConfigSection[]>([])
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [message, setMessage] = createSignal("")

  async function loadConfig() {
    setLoading(true)
    try {
      const data = await window.api.mafw.config.get() as Record<string, any>
      const secs: ConfigSection[] = Object.entries(data).map(([key, value]) => ({
        key,
        expanded: false,
        fields: typeof value === "object" && value !== null
          ? Object.entries(value).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])
          : [["value", String(value)]],
      }))
      setSections(secs)
    } catch {
      setSections([])
    }
    setLoading(false)
  }

  onMount(() => { loadConfig(); loadOpenCodeConfig(); loadPluginState(); loadModelState(); loadUsageConfig(); loadUsagePlugins() })

  // Dock "配置" requests arrive as window events; the config page can already be
  // mounted when one fires, so listen here instead of relying on mount-time props.
  onMount(() => {
    const handler = (e: Event) => {
      const section = (e as CustomEvent).detail
      if (isNavKey(section)) setActiveNav(section)
    }
    window.addEventListener('mafw:open-config', handler)
    onCleanup(() => window.removeEventListener('mafw:open-config', handler))
  })

  // Sync activeNav when initialSection prop changes (e.g., Rail settings opens config with default section).
  createEffect(() => {
    const section = props.initialSection
    if (isNavKey(section)) setActiveNav(section)
    else setActiveNav("gateway")
  })

  function toggleSection(key: string) {
    setSections(prev => prev.map(s => s.key === key ? { ...s, expanded: !s.expanded } : s))
  }

  function updateField(sectionKey: string, fieldKey: string, value: string) {
    setSections(prev => prev.map(s => {
      if (s.key !== sectionKey) return s
      return { ...s, fields: s.fields.map(([k, v]) => k === fieldKey ? [k, value] : [k, v]) }
    }))
  }

  async function saveSection(sectionKey: string) {
    const sec = sections().find(s => s.key === sectionKey)
    if (!sec) return
    setSaving(true)
    setMessage("")
    try {
      const obj: Record<string, any> = {}
      for (const [k, v] of sec.fields) {
        try { obj[k] = JSON.parse(v) } catch { obj[k] = v }
      }
      await window.api.mafw.config.set(sectionKey, obj)
      await loadConfig()
      setMessage(`Section "${sectionKey}" saved`)
    } catch (err: any) {
      setMessage(`Error: ${err.message}`)
    }
    setSaving(false)
  }

  // ── Gateway ops ──
  const [gwStatus, setGwStatus] = createSignal<any>(null)
  const [restarting, setRestarting] = createSignal(false)

  onMount(() => {
    window.api.mafw.gateway.info().then(setGwStatus).catch(() => {})
    const unsub = window.api.mafw.gateway.onStateChange(s => setGwStatus(s))
    onCleanup(unsub)
  })

  const gwStateText = () => {
    const s = gwStatus()
    if (!s) return "unknown"
    if (s.state === "ready") return `connected :${s.port ?? 3000}`
    if (s.state === "starting" || s.state === "stopped") return "Reconnecting…"
    if (s.state === "failed") return "连接失败"
    return s.state
  }

  const gwStateClass = () => {
    const s = gwStatus()
    if (!s) return "stopped"
    return s.state
  }

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToastV2({ description: `${label} 已复制`, duration: 2000 })
    } catch { /* ignore */ }
  }

  const restartGateway = async () => {
    setRestarting(true)
    try {
      await window.api.mafw.gateway.restart()
      showToastV2({ description: "Gateway 重启中…", duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `重启失败: ${err.message}`, duration: 3000 })
    }
    setRestarting(false)
  }

  // ── Plugin Switcher ──
  const [rtInfo, setRtInfo] = createSignal<any>(null)
  const [rtPlugins, setRtPlugins] = createSignal<any[]>([])
  const [rtSwitching, setRtSwitching] = createSignal(false)
  const [rtEnvOverride, setRtEnvOverride] = createSignal(false)

  const [mediaPlugins, setMediaPlugins] = createSignal<any[]>([])
  const [mediaEngine, setMediaEngine] = createSignal("")
  const [mediaImage, setMediaImage] = createSignal("")
  const [mediaVideo, setMediaVideo] = createSignal("")
  const [mediaAudio, setMediaAudio] = createSignal("")
  const [mediaSwitching, setMediaSwitching] = createSignal(false)

  async function loadPluginState() {
    try {
      const rt = await window.api.mafw.runtime.get()
      setRtInfo(rt)
      setRtPlugins(rt?.plugins ?? [])
      setRtEnvOverride(rt?.active?.envOverride ?? false)
    } catch { /* ignore */ }
    try {
      const mp = await window.api.mafw.media.plugins()
      setMediaPlugins(mp?.plugins ?? [])
    } catch { /* ignore */ }
    try {
      const fullCfg = await window.api.mafw.config.get()
      const mc = fullCfg?.media ?? {}
      setMediaEngine(mc.engine ?? "")
      setMediaImage(mc.image?.engine ?? "")
      setMediaVideo(mc.video?.engine ?? "")
      setMediaAudio(mc.audio?.engine ?? "")
    } catch { /* ignore */ }
  }

  async function switchRuntime(plugin: string) {
    if (!confirm(`切换 Runtime 到 "${plugin || 'opencode'}"？\n\n需要等待 Gateway 重新连接。`)) return
    setRtSwitching(true)
    try {
      const res = await window.api.mafw.runtime.switch(plugin)
      showToastV2({ description: `Runtime 已切换到 ${res.active.name}`, duration: 3000 })
      setRtInfo(prev => ({ ...prev, active: res.active }))
    } catch (err: any) {
      showToastV2({ description: `切换失败: ${err.message}`, duration: 4000 })
    }
    setRtSwitching(false)
  }

  async function switchMediaEngine(kind: string, value: string) {
    setMediaSwitching(true)
    try {
      const opts = kind === 'engine' ? { engine: value } : { [kind]: { engine: value } }
      await window.api.mafw.media.switch(opts)
      if (kind === 'engine') setMediaEngine(value)
      else if (kind === 'image') setMediaImage(value)
      else if (kind === 'video') setMediaVideo(value)
      else if (kind === 'audio') setMediaAudio(value)
      showToastV2({ description: `Media ${kind} 已切换`, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `Media 切换失败: ${err.message}`, duration: 3000 })
    }
    setMediaSwitching(false)
  }

  const runtimeOptions = () => {
    const ok = rtPlugins().filter(p => p.status === 'ok').map(p => p.name).filter(Boolean)
    if (!ok.includes('opencode')) ok.unshift('opencode')
    return ok
  }

  const mediaOptions = () => {
    const ok = mediaPlugins().filter(p => p.status === 'ok').map(p => p.name).filter(Boolean)
    if (!ok.includes('pi')) ok.push('pi')
    return ok
  }

  // ── Models ──
  const [modelState, setModelState] = createSignal<any>(null)
  const [modelAvailable, setModelAvailable] = createSignal<any[] | null>(null)
  const [modelError, setModelError] = createSignal("")
  const [modelSaving, setModelSaving] = createSignal<Record<string, boolean>>({})

  async function loadModelState() {
    setModelError("")
    try {
      const st = await window.api.mafw.models.get()
      setModelState(st)
      setModelAvailable(Array.isArray(st?.available) && st.available.length > 0 ? st.available : null)
    } catch (err: any) {
      setModelError(err.message)
    }
  }

  async function saveRecallModel(provider: string, model: string) {
    setModelSaving(prev => ({ ...prev, recall: true }))
    try {
      const res = await window.api.mafw.models.update({ recall: { providerID: provider, modelID: model } })
      setModelState(res)
      showToastV2({ description: `记忆 worker 模型已切换到 ${provider}/${model}`, duration: 2500 })
    } catch (err: any) {
      showToastV2({ description: `保存失败: ${err.message}`, duration: 4000 })
      await loadModelState()
    }
    setModelSaving(prev => ({ ...prev, recall: false }))
  }

  async function saveMediaModel(kind: "default" | "image" | "video" | "audio", provider: string, model: string) {
    setModelSaving(prev => ({ ...prev, [kind]: true }))
    try {
      const mediaUpdate = kind === "default" ? { provider, model } : { [kind]: { provider, model } }
      const res = await window.api.mafw.models.update({ media: mediaUpdate })
      setModelState(res)
      showToastV2({ description: `Media ${kind} 模型已保存`, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `保存失败: ${err.message}`, duration: 4000 })
      await loadModelState()
    }
    setModelSaving(prev => ({ ...prev, [kind]: false }))
  }

  // ── Usage Config ──
  const [usageConfig, setUsageConfig] = createSignal<any>(null)
  const [usageLoading, setUsageLoading] = createSignal(true)
  const [usageSaving, setUsageSaving] = createSignal(false)
  const [usagePluginState, setUsagePluginState] = createSignal<any[]>([])
  const [usageReloading, setUsageReloading] = createSignal(false)
  const [usageAddKind, setUsageAddKind] = createSignal<'cookie' | 'budget' | null>(null)
  const [usageAddName, setUsageAddName] = createSignal('')

  async function loadUsageConfig() {
    setUsageLoading(true)
    try {
      const c = await window.api.mafw.config.get("usage")
      setUsageConfig(c || { limits: {}, budgets: {}, cookies: {} })
    } catch {
      setUsageConfig({ limits: {}, budgets: {}, cookies: {} })
    }
    setUsageLoading(false)
  }

  async function loadUsagePlugins() {
    try {
      const res = await window.api.mafw.sessions.usagePlugins()
      setUsagePluginState(res?.plugins ?? [])
    } catch { /* ignore */ }
  }

  const usageLimits = () => usageConfig()?.limits || {}
  const usageBudgets = () => usageConfig()?.budgets || {}
  const usageCookies = () => usageConfig()?.cookies || {}

  const setUsageLimitWindow = (provider: string, window: string, v: string) => {
    setUsageConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.limits = next.limits || {}
      next.limits[provider] = next.limits[provider] || {}
      next.limits[provider][window] = v === "" ? 0 : parseFloat(v) || 0
      return next
    })
  }

  const setUsageBudget = (provider: string, v: string) => {
    setUsageConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.budgets = next.budgets || {}
      if (v === "") delete next.budgets[provider]
      else next.budgets[provider] = parseFloat(v) || 0
      return next
    })
  }

  const setUsageCookie = (name: string, v: string) => {
    setUsageConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.cookies = next.cookies || {}
      if (v === "") delete next.cookies[name]
      else next.cookies[name] = v
      return next
    })
  }

  const removeUsageCookie = (name: string) => {
    setUsageConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.cookies = next.cookies || {}
      delete next.cookies[name]
      return next
    })
  }

  const commitUsageAdd = () => {
    const name = usageAddName().trim()
    if (!name) return
    if (usageAddKind() === 'cookie') {
      setUsageConfig(prev => {
        const next = JSON.parse(JSON.stringify(prev))
        next.cookies = next.cookies || {}
        if (next.cookies[name] === undefined) next.cookies[name] = ""
        return next
      })
    } else if (usageAddKind() === 'budget') {
      setUsageConfig(prev => {
        const next = JSON.parse(JSON.stringify(prev))
        next.budgets = next.budgets || {}
        if (next.budgets[name] === undefined) next.budgets[name] = 0
        return next
      })
    }
    setUsageAddKind(null)
    setUsageAddName('')
  }

  const saveUsageConfig = async () => {
    setUsageSaving(true)
    try {
      const c = usageConfig()
      const clean = {
        limits: c.limits || {},
        budgets: c.budgets || {},
        cookies: c.cookies || {},
        pluginConfig: c.pluginConfig || {},
      }
      await window.api.mafw.config.set("usage", clean)
      // The right dock's usage summary listens for this to refresh its numbers.
      window.dispatchEvent(new CustomEvent('mafw:usage-config-saved'))
      showToastV2({ description: "用量配置已保存", duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `保存失败: ${err.message}`, duration: 3000 })
    }
    setUsageSaving(false)
  }

  const reloadUsagePlugins = async () => {
    setUsageReloading(true)
    try {
      const res = await window.api.mafw.sessions.usagePluginsReload()
      setUsagePluginState(res?.plugins ?? [])
      showToastV2({ description: '插件已重载', duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `重载失败: ${err.message}`, duration: 3000 })
    }
    setUsageReloading(false)
  }

  // ── OpenCode config ──
  const [ocSections, setOcSections] = createSignal<ConfigSection[]>([])
  const [ocLoading, setOcLoading] = createSignal(true)
  const [ocSaving, setOcSaving] = createSignal(false)
  const [ocMessage, setOcMessage] = createSignal("")

  async function loadOpenCodeConfig() {
    setOcLoading(true)
    try {
      const cfg = await window.api.mafw.opencodeConfig.get() as Record<string, any>
      const secs: ConfigSection[] = Object.entries(cfg || {}).map(([key, value]) => ({
        key,
        expanded: false,
        fields: typeof value === "object" && value !== null
          ? Object.entries(value).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])
          : [["value", String(value)]],
      }))
      setOcSections(secs)
    } catch (err: any) {
      setOcMessage(`加载失败: ${err.message}`)
      setOcSections([])
    }
    setOcLoading(false)
  }

  function toggleOcSection(key: string) {
    setOcSections(prev => prev.map(s => s.key === key ? { ...s, expanded: !s.expanded } : s))
  }

  function updateOcField(sectionKey: string, fieldKey: string, value: string) {
    setOcSections(prev => prev.map(s => {
      if (s.key !== sectionKey) return s
      return { ...s, fields: s.fields.map(([k, v]) => k === fieldKey ? [k, value] : [k, v]) }
    }))
  }

  async function saveOcSection(sectionKey: string) {
    const sec = ocSections().find(s => s.key === sectionKey)
    if (!sec) return
    setOcSaving(true)
    setOcMessage("")
    try {
      const obj: Record<string, any> = {}
      for (const [k, v] of sec.fields) {
        try { obj[k] = JSON.parse(v) } catch { obj[k] = v }
      }
      await window.api.mafw.opencodeConfig.update({ [sectionKey]: obj })
      setOcMessage(`Section "${sectionKey}" saved（可能需要重启 Gateway 生效）`)
    } catch (err: any) {
      setOcMessage(`Error: ${err.message}`)
    }
    setOcSaving(false)
  }

  const navDesc = () => NAV_ITEMS.find(n => n.key === activeNav())?.desc ?? ""

  return (
    <ErrorBoundary fallback={(err, reset) => (
      <div style={{ padding: 16, "font-size": 13 }}>
        <div style={{ color: "#b91c1c", "margin-bottom": 8 }}>Config 页渲染错误: {String(err?.message ?? err)}</div>
        <pre style={{ "white-space": "pre-wrap", "font-size": 11, color: "var(--text-base)", "max-height": 200, overflow: "auto" }}>{String(err?.stack ?? "")}</pre>
        <ButtonV2 variant="outline" size="small" onClick={reset}>重试渲染</ButtonV2>
      </div>
    )}>
    <div class="mafw-config-layout">
      {/* ── Left Nav ── */}
      <nav class="mafw-config-nav">
        <div class="mafw-config-nav-head">
          {props.onBack && (
            <ButtonV2 variant="ghost" size="small" onClick={() => props.onBack?.()}>← 返回</ButtonV2>
          )}
          <span class="mafw-config-nav-title">Settings</span>
        </div>
        <div class="mafw-config-nav-list">
          <For each={NAV_ITEMS}>
            {(item) => (
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-config-nav-item"
                classList={{ "mafw-config-nav-item--active": activeNav() === item.key }}
                aria-current={activeNav() === item.key ? "page" : undefined}
                onClick={() => setActiveNav(item.key)}
              >
                <span class="mafw-config-nav-icon">{item.icon}</span>
                <span class="mafw-config-nav-label">{item.label}</span>
                {activeNav() === item.key && <span class="mafw-config-nav-indicator" />}
              </ButtonV2>
            )}
          </For>
        </div>
      </nav>

      {/* ── Content Panel ── */}
      <main class="mafw-config-panel">
        <div class="mafw-config-panel-head">
          <h2 class="mafw-config-panel-title">
            {NAV_ITEMS.find(n => n.key === activeNav())?.icon}{' '}
            {NAV_ITEMS.find(n => n.key === activeNav())?.label}
          </h2>
          <span class="mafw-config-panel-desc">{navDesc()}</span>
        </div>
        <div class="mafw-config-panel-body">

          {/* ═══ Gateway ═══*/}
          <Show when={activeNav() === "gateway"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">⚡</span>
                <span class="mafw-config-section-title">Gateway 运维</span>
                <span class={`mafw-config-status-badge mafw-config-status-${gwStateClass()}`}>
                  <span class="mafw-config-status-dot" />
                  {gwStateText()}
                </span>
              </div>
              <div class="mafw-config-section-body">
                <div class="mafw-config-actions-row">
                  <ButtonV2 variant="outline" size="small" onClick={restartGateway} disabled={restarting()}>
                    {restarting() ? "重启中…" : "Restart Gateway"}
                  </ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={() => gwStatus()?.url && copyText(gwStatus().url, "URL")} disabled={!gwStatus()?.url}>
                    Copy URL
                  </ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={async () => {
                    try { const p = await window.api.mafw.gateway.logsPath(); copyText(p, "日志路径") } catch {}
                  }}>
                    Copy logs path
                  </ButtonV2>
                </div>
              </div>
            </div>
          </Show>

          {/* ═══ Plugins ═══*/}
          <Show when={activeNav() === "plugins"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">🧩</span>
                <span class="mafw-config-section-title">Runtime &amp; Media</span>
              </div>
              <div class="mafw-config-section-body">
                {rtEnvOverride() && (
                  <div class="mafw-config-env-warning">
                    ⚠️ 环境变量 MAFW_RUNTIME_PLUGIN 已覆盖 config.yaml 设置
                  </div>
                )}
                <div class="mafw-config-field-group">
                  <label class="mafw-config-label">Runtime</label>
                  <div class="mafw-config-field-row">
                    <div style={{ width: 220 }}>
                      <SelectV2
                        options={runtimeOptions()}
                        current={rtInfo()?.active?.name ?? 'opencode'}
                        value={(x: string) => x}
                        label={(x: string) => (x === 'opencode' ? 'opencode（默认）' : x)}
                        onSelect={(v) => { if (v && v !== (rtInfo()?.active?.name ?? 'opencode')) switchRuntime(v) }}
                        disabled={rtSwitching()}
                        placeholder="选择 runtime"
                      />
                    </div>
                    {rtSwitching() && <LoaderV2 width={14} height={14} />}
                    <span class="mafw-config-hint">当前: {rtInfo()?.active?.name ?? 'opencode'}</span>
                  </div>
                </div>
                <div class="mafw-config-field-group">
                  <label class="mafw-config-label">Media Engine</label>
                  <div class="mafw-config-grid">
                    {[
                      { kind: 'engine', label: 'Default', value: mediaEngine() },
                      { kind: 'image', label: 'Image', value: mediaImage() },
                      { kind: 'video', label: 'Video', value: mediaVideo() },
                      { kind: 'audio', label: 'Audio', value: mediaAudio() },
                    ].map(({ kind, label, value }) => (
                      <div class="mafw-config-grid-row">
                        <span class="mafw-config-grid-label">{label}</span>
                        <div style={{ width: 180 }}>
                          <SelectV2
                            options={mediaOptions()}
                            current={value || 'pi'}
                            value={(x: string) => x}
                            onSelect={(v) => { if (v != null && v !== (value || 'pi')) switchMediaEngine(kind, v) }}
                            disabled={mediaSwitching()}
                            placeholder="选择引擎"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {mediaSwitching() && (
                    <div class="mafw-config-inline-loading">
                      <LoaderV2 width={12} height={12} /> 切换中…                    </div>
                  )}
                </div>
              </div>
            </div>
          </Show>

          {/* ═══ Models ═══*/}
          <Show when={activeNav() === "models"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">🤖</span>
                <span class="mafw-config-section-title">模型配置</span>
              </div>
              <div class="mafw-config-section-body">
                {modelError() ? (
                  <div class="mafw-config-error-row">
                    <span>加载失败: {modelError()}</span>
                    <ButtonV2 variant="outline" size="small" onClick={loadModelState}>重试</ButtonV2>
                  </div>
                ) : !modelState() ? (
                  <div class="mafw-config-inline-loading">
                    <LoaderV2 width={14} height={14} /> 加载中…                  </div>
                ) : (
                  <div class="mafw-config-models-grid">
                    {!modelAvailable() && (
                      <div class="mafw-config-hint">provider 列表不可用，请手动输入 providerID / modelID</div>
                    )}
                    {modelAvailable() ? (
                      <ModelSelectRow
                        label="记忆 worker"
                        current={{ provider: modelState()?.recall?.workerModel?.providerID ?? "", model: modelState()?.recall?.workerModel?.modelID ?? "" }}
                        providers={modelAvailable() ?? []}
                        saving={!!modelSaving().recall}
                        onSave={(p, m) => saveRecallModel(p, m)}
                      />
                    ) : (
                      <ModelTextRow
                        label="记忆 worker"
                        current={{ provider: modelState()?.recall?.workerModel?.providerID ?? "", model: modelState()?.recall?.workerModel?.modelID ?? "" }}
                        saving={!!modelSaving().recall}
                        onSave={(p, m) => saveRecallModel(p, m)}
                      />
                    )}
                    {([
                      { kind: "default", label: "媒体默认" },
                      { kind: "image", label: "媒体 image" },
                      { kind: "video", label: "媒体 video" },
                      { kind: "audio", label: "媒体 audio" },
                    ] as const).map(({ kind, label }) => {
                      const cur = kind === "default"
                        ? { provider: modelState()?.media?.provider ?? "", model: modelState()?.media?.model ?? "" }
                        : { provider: modelState()?.media?.[kind]?.provider ?? "", model: modelState()?.media?.[kind]?.model ?? "" }
                      const save = (p: string, m: string) => saveMediaModel(kind, p, m)
                      return modelAvailable() ? (
                        <ModelSelectRow label={label} allowClear={kind !== "default"} current={cur} providers={modelAvailable() ?? []} saving={!!modelSaving()[kind]} onSave={save} />
                      ) : (
                        <ModelTextRow label={label} current={cur} saving={!!modelSaving()[kind]} onSave={save} />
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </Show>

          {/* ═══ Usage ═══*/}
          <Show when={activeNav() === "usage"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">📊</span>
                <span class="mafw-config-section-title">用量配置</span>
              </div>
              <div class="mafw-config-section-body">
                {usageLoading() ? (
                  <div class="mafw-config-inline-loading">
                    <LoaderV2 width={14} height={14} /> 加载中…                  </div>
                ) : (
                  <div class="mafw-usage-config-grid">
                    {/* Token Plan 限额 */}
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">Token Plan 限额 (5h/7d/month)</label>
                      <div class="mafw-config-usage-rows">
                        <Show when={Object.keys(usageLimits()).length > 0} fallback={
                          <div class="mafw-config-hint">无 token plan 配置</div>
                        }>
                          <For each={Object.keys(usageLimits())}>
                            {(provider: string) => (
                              <div class="mafw-config-usage-provider-row">
                                <span class="mafw-config-usage-provider-name">{provider}</span>
                                <div class="mafw-config-usage-fields">
                                  <For each={Object.keys(usageLimits()[provider] || {})}>
                                    {(window: string) => (
                                      <div class="mafw-config-field-group compact">
                                        <label>{window}</label>
                                        <TextInputV2
                                          type="number"
                                          value={String(usageLimits()[provider][window] ?? 0)}
                                          onInput={e => setUsageLimitWindow(provider, window, e.currentTarget.value)}
                                          style={{ width: 60 }}
                                        />
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </div>

                    {/* API 余额预算 */}
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">API 余额预算 (budget)</label>
                      <div class="mafw-config-usage-rows">
                        <For each={Object.keys(usageBudgets())}>
                          {(provider: string) => (
                            <div class="mafw-config-usage-provider-row">
                              <span class="mafw-config-usage-provider-name">{provider}</span>
                              <TextInputV2
                                type="number"
                                value={String(usageBudgets()[provider] ?? "")}
                                onInput={e => setUsageBudget(provider, e.currentTarget.value)}
                                style={{ width: 80 }}
                                placeholder="留空删除"
                              />
                            </div>
                          )}
                        </For>
                        <div class="mafw-config-usage-add-row">
                          <Show when={usageAddKind() !== 'budget'} fallback={
                            <div class="mafw-config-usage-add-inline">
                              <TextInputV2
                                value={usageAddName()}
                                onInput={e => setUsageAddName(e.currentTarget.value)}
                                onKeyDown={e => { if (e.key === 'Enter') commitUsageAdd(); if (e.key === 'Escape') { setUsageAddKind(null); setUsageAddName('') } }}
                                style={{ width: 140 }}
                                placeholder="provider 名称"
                              />
                              <ButtonV2 variant="contrast" size="small" onClick={commitUsageAdd}>确定</ButtonV2>
                              <ButtonV2 variant="ghost" size="small" onClick={() => { setUsageAddKind(null); setUsageAddName('') }}>取消</ButtonV2>
                            </div>
                          }>
                            <ButtonV2 variant="ghost" size="small" onClick={() => { setUsageAddKind('budget'); setUsageAddName('') }}>+ 添加 provider 预算</ButtonV2>
                          </Show>
                        </div>
                      </div>
                    </div>

                    {/* 平台 Cookie */}
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">平台 Cookie (用量查询)</label>
                      <div class="mafw-config-usage-rows">
                        <Show when={Object.keys(usageCookies()).length > 0} fallback={
                          <div class="mafw-config-hint">无平台 cookie，可点击下方添加（如 commandcode）</div>
                        }>
                          <For each={Object.keys(usageCookies())}>
                            {(name: string) => (
                              <div class="mafw-config-usage-provider-row cookie-row">
                                <span class="mafw-config-usage-provider-name">{name}</span>
                                <TextInputV2
                                  value={usageCookies()[name] ?? ""}
                                  onInput={e => setUsageCookie(name, e.currentTarget.value)}
                                  style={{ flex: 1, minWidth: 0 }}
                                  placeholder={`${name} 平台登录后的 session cookie`}
                                />
                                <ButtonV2 variant="ghost" size="small" onClick={() => removeUsageCookie(name)} aria-label="删除 cookie">✕</ButtonV2>
                              </div>
                            )}
                          </For>
                        </Show>
                        <div class="mafw-config-usage-add-row">
                          <Show when={usageAddKind() !== 'cookie'} fallback={
                            <div class="mafw-config-usage-add-inline">
                              <TextInputV2
                                value={usageAddName()}
                                onInput={e => setUsageAddName(e.currentTarget.value)}
                                onKeyDown={e => { if (e.key === 'Enter') commitUsageAdd(); if (e.key === 'Escape') { setUsageAddKind(null); setUsageAddName('') } }}
                                style={{ width: 140 }}
                                placeholder="cookie 名称"
                              />
                              <ButtonV2 variant="contrast" size="small" onClick={commitUsageAdd}>确定</ButtonV2>
                              <ButtonV2 variant="ghost" size="small" onClick={() => { setUsageAddKind(null); setUsageAddName('') }}>取消</ButtonV2>
                            </div>
                          }>
                            <ButtonV2 variant="ghost" size="small" onClick={() => { setUsageAddKind('cookie'); setUsageAddName('') }}>+ 添加平台 cookie</ButtonV2>
                          </Show>
                        </div>
                      </div>
                    </div>

                    {/* 平台插件 */}
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">平台插件</label>
                      <div class="mafw-config-usage-rows">
                        <Show when={usagePluginState().length > 0} fallback={
                          <div class="mafw-config-hint">无插件</div>
                        }>
                          <For each={usagePluginState()}>
                            {(p: any) => (
                              <div class="mafw-config-usage-provider-row">
                                <span class="mafw-config-usage-provider-name">
                                  {p.status === 'ok' ? '✅' : '❌'} {p.file}
                                  {p.name && <span class="mafw-config-hint"> ({p.name})</span>}
                                  {p.overridden && <span class="mafw-config-hint"> [覆盖内置]</span>}
                                </span>
                                <Show when={p.error}>
                                  <span class="mafw-config-usage-error">{p.error}</span>
                                </Show>
                              </div>
                            )}
                          </For>
                        </Show>
                        <div class="mafw-config-usage-add-row">
                          <ButtonV2 variant="ghost" size="small" onClick={() => window.api.mafw.sessions.openUsagePluginsDir()}>
                            📂 打开插件目录
                          </ButtonV2>
                          <ButtonV2 variant="ghost" size="small" onClick={reloadUsagePlugins} disabled={usageReloading()}>
                            {usageReloading() ? '重载中…' : '🔄 重新加载'}
                          </ButtonV2>
                        </div>
                      </div>
                    </div>

                    {/* 保存按钮 */}
                    <div class="mafw-config-actions-row" style={{ "margin-top": 8 }}>
                      <ButtonV2 variant="contrast" size="small" onClick={saveUsageConfig} disabled={usageSaving()}>
                        {usageSaving() ? "保存中…" : "保存用量配置"}
                      </ButtonV2>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Show>

          {/* ═══ OpenCode Config ═══*/}
          <Show when={activeNav() === "opencode"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">⚙️</span>
                <span class="mafw-config-section-title">opencode 配置</span>
              </div>
              <div class="mafw-config-section-body">
                {ocLoading() ? (
                  <div class="mafw-config-inline-loading">
                    <LoaderV2 width={16} height={16} /> Loading...
                  </div>
                ) : ocSections().length === 0 ? (
                  <div class="mafw-config-hint">Unable to load opencode config</div>
                ) : (
                  <div class="mafw-config-oc-grid">
                    {ocSections().map(sec => (
                      <div class="mafw-config-oc-card">
                        <div
                          onClick={() => toggleOcSection(sec.key)}
                          class="mafw-config-oc-header"
                        >
                          <Icon name="chevron-down" size="small" style={{ transform: sec.expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s", flexShrink: 0 }} />
                          <span class="mafw-config-oc-name">{sec.key}</span>
                        </div>
                        {sec.expanded && (
                          <div class="mafw-config-oc-body">
                            {sec.fields.map(([fieldKey, fieldValue]) => (
                              <div class="mafw-config-field-group compact">
                                <label class="mafw-config-label">{fieldKey}</label>
                                <TextInputV2
                                  value={fieldValue}
                                  onInput={e => updateOcField(sec.key, fieldKey, e.currentTarget.value)}
                                  style={{ width: "100%" }}
                                />
                              </div>
                            ))}
                            <ButtonV2 variant="contrast" size="small" onClick={() => saveOcSection(sec.key)} disabled={ocSaving()} style={{ "margin-top": 4 }}>
                              {ocSaving() ? "Saving..." : `Save ${sec.key}`}
                            </ButtonV2>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {ocMessage() && <div class="mafw-config-message">{ocMessage()}</div>}
              </div>
            </div>
          </Show>

          {/* ═══ MAFW Raw Config ═══*/}
          <Show when={activeNav() === "mafw"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">🔧</span>
                <span class="mafw-config-section-title">MAFW 原始配置</span>
              </div>
              <div class="mafw-config-section-body">
                {loading() ? (
                  <div class="mafw-config-inline-loading">
                    <LoaderV2 width={16} height={16} /> Loading...
                  </div>
                ) : sections().length === 0 ? (
                  <div class="mafw-config-hint">Unable to load configuration</div>
                ) : (
                  <div class="mafw-config-oc-grid">
                    {sections().map(sec => (
                      <div class="mafw-config-oc-card">
                        <div
                          onClick={() => toggleSection(sec.key)}
                          class="mafw-config-oc-header"
                        >
                          <Icon name="chevron-down" size="small" style={{ transform: sec.expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s", flexShrink: 0 }} />
                          <span class="mafw-config-oc-name">{sec.key}</span>
                        </div>
                        {sec.expanded && (
                          <div class="mafw-config-oc-body">
                            {sec.fields.map(([fieldKey, fieldValue]) => (
                              <div class="mafw-config-field-group compact">
                                <label class="mafw-config-label">{fieldKey}</label>
                                <TextInputV2
                                  value={fieldValue}
                                  onInput={e => updateField(sec.key, fieldKey, e.currentTarget.value)}
                                  style={{ width: "100%" }}
                                />
                              </div>
                            ))}
                            <ButtonV2 variant="contrast" size="small" onClick={() => saveSection(sec.key)} disabled={saving()} style={{ "margin-top": 4 }}>
                              {saving() ? "Saving..." : `Save ${sec.key}`}
                            </ButtonV2>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {message() && <div class="mafw-config-message">{message()}</div>}
              </div>
            </div>
          </Show>

        </div>
      </main>
    </div>
    </ErrorBoundary>
  )
}

function ModelSelectRow(props: {
  label: string
  allowClear?: boolean
  current: { provider: string; model: string }
  providers: any[]
  saving: boolean
  onSave: (provider: string, model: string) => void
}) {
  const [pendingProvider, setPendingProvider] = createSignal(props.current.provider)
  const modelsFor = (pid: string) => (props.providers ?? []).find(p => p.providerID === pid)?.models ?? []
  const modelLabel = (id: string) => modelsFor(pendingProvider()).find(m => m.id === id)?.name ?? id
  return (
    <div class="mafw-config-model-row">
      <span class="mafw-config-model-label">{props.label}</span>
      <div style={{ display: "flex", gap: 6, "align-items": "center" }}>
        <div style={{ width: 130 }}>
          <SelectV2
            options={(props.providers ?? []).map(p => p.providerID)}
            current={pendingProvider()}
            value={(x: string) => x}
            onSelect={(v) => { if (v != null) setPendingProvider(v) }}
            disabled={props.saving}
            placeholder="provider"
          />
        </div>
        <div style={{ width: 160 }}>
          <SelectV2
            options={props.allowClear ? ["", ...modelsFor(pendingProvider()).map(m => m.id)] : modelsFor(pendingProvider()).map(m => m.id)}
            current={props.current.model}
            value={(x: string) => x}
            label={(x: string) => (x === "" ? "（跟随默认）" : modelLabel(x))}
            onSelect={(v) => { if (v != null && v !== props.current.model) props.onSave(pendingProvider(), v) }}
            disabled={props.saving || !pendingProvider()}
            placeholder={props.allowClear ? "（跟随默认）" : "model"}
          />
        </div>
        {props.saving && <LoaderV2 width={14} height={14} />}
      </div>
    </div>
  )
}

function ModelTextRow(props: {
  label: string
  current: { provider: string; model: string }
  saving: boolean
  onSave: (provider: string, model: string) => void
}) {
  const [prov, setProv] = createSignal(props.current.provider)
  const [model, setModel] = createSignal(props.current.model)
  return (
    <div class="mafw-config-model-row">
      <span class="mafw-config-model-label">{props.label}</span>
      <div style={{ display: "flex", gap: 6, "align-items": "center" }}>
        <div style={{ width: 120 }}>
          <TextInputV2 value={prov()} onInput={e => setProv(e.currentTarget.value)} placeholder="providerID" disabled={props.saving} />
        </div>
        <div style={{ width: 150 }}>
          <TextInputV2 value={model()} onInput={e => setModel(e.currentTarget.value)} placeholder="modelID" disabled={props.saving} />
        </div>
        <ButtonV2 variant="outline" size="small" disabled={props.saving || !prov() || !model()} onClick={() => props.onSave(prov(), model())}>
          {props.saving ? "…" : "保存"}
        </ButtonV2>
      </div>
    </div>
  )
}

