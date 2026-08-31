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

type NavKey = "gateway" | "plugins" | "models" | "usage" | "opencode" | "mafw"

const NAV_ITEMS: { key: NavKey; icon: string; label: string; desc: string }[] = [
  { key: "gateway",  icon: "鈿?, label: "Gateway",  desc: "杩愯鐘舵€併€侀噸鍚笌鏃ュ織" },
  { key: "plugins",  icon: "馃З", label: "Plugins",  desc: "Runtime 涓庡獟浣撳紩鎿庡垏鎹? },
  { key: "models",   icon: "馃", label: "Models",   desc: "璁板繂 worker 涓庡獟浣撴瘡妯℃€佹ā鍨? },
  { key: "usage",    icon: "馃搳", label: "Usage",    desc: "Token Plan 闄愰銆佷綑棰濋绠椼€佸钩鍙?Cookie" },
  { key: "opencode", icon: "鈿欙笍", label: "opencode", desc: "opencode 閰嶇疆缂栬緫鍣? },
  { key: "mafw",     icon: "馃敡", label: "MAFW",     desc: "MAFW 鍘熷閰嶇疆锛堥珮绾э級" },
]

export function ConfigPage(props: { onBack?: () => void; initialSection?: NavKey }) {
  const [activeNav, setActiveNav] = createSignal<NavKey>(props.initialSection || "gateway")
  // Config page stays mounted while the right dock is visible 鈥?sync external
  // navigation requests ("mafw:open-config" 鈫?MafwShell configSection signal)
  // instead of reading initialSection once at mount.
  createEffect(() => {
    const s = props.initialSection
    if (s) setActiveNav(s)
  })

  // 鈹€鈹€ MAFW raw config 鈹€鈹€
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

  // 鈹€鈹€ Gateway ops 鈹€鈹€
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
    if (s.state === "starting" || s.state === "stopped") return "Reconnecting鈥?
    if (s.state === "failed") return "杩炴帴澶辫触"
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
      showToastV2({ description: `${label} 宸插鍒禶, duration: 2000 })
    } catch { /* ignore */ }
  }

  const restartGateway = async () => {
    setRestarting(true)
    try {
      await window.api.mafw.gateway.restart()
      showToastV2({ description: "Gateway 閲嶅惎涓€?, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `閲嶅惎澶辫触: ${err.message}`, duration: 3000 })
    }
    setRestarting(false)
  }

  // 鈹€鈹€ Plugin Switcher 鈹€鈹€
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
    if (!confirm(`鍒囨崲 Runtime 鍒?"${plugin || 'opencode'}"锛焅n\n闇€瑕佺瓑寰?Gateway 閲嶆柊杩炴帴銆俙)) return
    setRtSwitching(true)
    try {
      const res = await window.api.mafw.runtime.switch(plugin)
      showToastV2({ description: `Runtime 宸插垏鎹㈠埌 ${res.active.name}`, duration: 3000 })
      setRtInfo(prev => ({ ...prev, active: res.active }))
    } catch (err: any) {
      showToastV2({ description: `鍒囨崲澶辫触: ${err.message}`, duration: 4000 })
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
      showToastV2({ description: `Media ${kind} 宸插垏鎹, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `Media 鍒囨崲澶辫触: ${err.message}`, duration: 3000 })
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

  // 鈹€鈹€ Models 鈹€鈹€
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
      showToastV2({ description: `璁板繂 worker 妯″瀷宸插垏鎹㈠埌 ${provider}/${model}`, duration: 2500 })
    } catch (err: any) {
      showToastV2({ description: `淇濆瓨澶辫触: ${err.message}`, duration: 4000 })
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
      showToastV2({ description: `Media ${kind} 妯″瀷宸蹭繚瀛榒, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `淇濆瓨澶辫触: ${err.message}`, duration: 4000 })
      await loadModelState()
    }
    setModelSaving(prev => ({ ...prev, [kind]: false }))
  }

  // 鈹€鈹€ Usage Config 鈹€鈹€
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
      showToastV2({ description: "鐢ㄩ噺閰嶇疆宸蹭繚瀛?, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `淇濆瓨澶辫触: ${err.message}`, duration: 3000 })
    }
    setUsageSaving(false)
  }

  const reloadUsagePlugins = async () => {
    setUsageReloading(true)
    try {
      const res = await window.api.mafw.sessions.usagePluginsReload()
      setUsagePluginState(res?.plugins ?? [])
      showToastV2({ description: '鎻掍欢宸查噸杞?, duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `閲嶈浇澶辫触: ${err.message}`, duration: 3000 })
    }
    setUsageReloading(false)
  }

  // 鈹€鈹€ OpenCode config 鈹€鈹€
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
      setOcMessage(`鍔犺浇澶辫触: ${err.message}`)
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
      setOcMessage(`Section "${sectionKey}" saved锛堝彲鑳介渶瑕侀噸鍚?Gateway 鐢熸晥锛塦)
    } catch (err: any) {
      setOcMessage(`Error: ${err.message}`)
    }
    setOcSaving(false)
  }

  const navDesc = () => NAV_ITEMS.find(n => n.key === activeNav())?.desc ?? ""

  return (
    <ErrorBoundary fallback={(err, reset) => (
      <div style={{ padding: 16, "font-size": 13 }}>
        <div style={{ color: "#b91c1c", "margin-bottom": 8 }}>Config 椤垫覆鏌撻敊璇? {String(err?.message ?? err)}</div>
        <pre style={{ "white-space": "pre-wrap", "font-size": 11, color: "var(--text-base)", "max-height": 200, overflow: "auto" }}>{String(err?.stack ?? "")}</pre>
        <ButtonV2 variant="outline" size="small" onClick={reset}>閲嶈瘯娓叉煋</ButtonV2>
      </div>
    )}>
    <div class="mafw-config-layout">
      {/* 鈹€鈹€ Left Nav 鈹€鈹€ */}
      <nav class="mafw-config-nav">
        <div class="mafw-config-nav-head">
          {props.onBack && (
            <ButtonV2 variant="ghost" size="small" onClick={() => props.onBack?.()}>鈫?杩斿洖</ButtonV2>
          )}
          <span class="mafw-config-nav-title">Settings</span>
        </div>
        <div class="mafw-config-nav-list">
          <For each={NAV_ITEMS}>
            {(item) => (
              <button
                class="mafw-config-nav-item"
                classList={{ "mafw-config-nav-item--active": activeNav() === item.key }}
                onClick={() => setActiveNav(item.key)}
              >
                <span class="mafw-config-nav-icon">{item.icon}</span>
                <span class="mafw-config-nav-label">{item.label}</span>
                {activeNav() === item.key && <span class="mafw-config-nav-indicator" />}
              </button>
            )}
          </For>
        </div>
      </nav>

      {/* 鈹€鈹€ Content Panel 鈹€鈹€ */}
      <main class="mafw-config-panel">
        <div class="mafw-config-panel-head">
          <h2 class="mafw-config-panel-title">
            {NAV_ITEMS.find(n => n.key === activeNav())?.icon}{' '}
            {NAV_ITEMS.find(n => n.key === activeNav())?.label}
          </h2>
          <span class="mafw-config-panel-desc">{navDesc()}</span>
        </div>
        <div class="mafw-config-panel-body">

          {/* 鈺愨晲鈺?Gateway 鈺愨晲鈺?*/}
          <Show when={activeNav() === "gateway"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">鈿?/span>
                <span class="mafw-config-section-title">Gateway 杩愮淮</span>
                <span class={`mafw-config-status-badge mafw-config-status-${gwStateClass()}`}>
                  <span class="mafw-config-status-dot" />
                  {gwStateText()}
                </span>
              </div>
              <div class="mafw-config-section-body">
                <div class="mafw-config-actions-row">
                  <ButtonV2 variant="outline" size="small" onClick={restartGateway} disabled={restarting()}>
                    {restarting() ? "閲嶅惎涓€? : "Restart Gateway"}
                  </ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={() => gwStatus()?.url && copyText(gwStatus().url, "URL")} disabled={!gwStatus()?.url}>
                    Copy URL
                  </ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={async () => {
                    try { const p = await window.api.mafw.gateway.logsPath(); copyText(p, "鏃ュ織璺緞") } catch {}
                  }}>
                    Copy logs path
                  </ButtonV2>
                </div>
              </div>
            </div>
          </Show>

          {/* 鈺愨晲鈺?Plugins 鈺愨晲鈺?*/}
          <Show when={activeNav() === "plugins"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">馃З</span>
                <span class="mafw-config-section-title">Runtime &amp; Media</span>
              </div>
              <div class="mafw-config-section-body">
                {rtEnvOverride() && (
                  <div class="mafw-config-env-warning">
                    鈿狅笍 鐜鍙橀噺 MAFW_RUNTIME_PLUGIN 宸茶鐩?config.yaml 璁剧疆
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
                        label={(x: string) => (x === 'opencode' ? 'opencode锛堥粯璁わ級' : x)}
                        onSelect={(v) => { if (v && v !== (rtInfo()?.active?.name ?? 'opencode')) switchRuntime(v) }}
                        disabled={rtSwitching()}
                        placeholder="閫夋嫨 runtime"
                      />
                    </div>
                    {rtSwitching() && <LoaderV2 width={14} height={14} />}
                    <span class="mafw-config-hint">褰撳墠: {rtInfo()?.active?.name ?? 'opencode'}</span>
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
                            placeholder="閫夋嫨寮曟搸"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {mediaSwitching() && (
                    <div class="mafw-config-inline-loading">
                      <LoaderV2 width={12} height={12} /> 鍒囨崲涓€?                    </div>
                  )}
                </div>
              </div>
            </div>
          </Show>

          {/* 鈺愨晲鈺?Models 鈺愨晲鈺?*/}
          <Show when={activeNav() === "models"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">馃</span>
                <span class="mafw-config-section-title">妯″瀷閰嶇疆</span>
              </div>
              <div class="mafw-config-section-body">
                {modelError() ? (
                  <div class="mafw-config-error-row">
                    <span>鍔犺浇澶辫触: {modelError()}</span>
                    <ButtonV2 variant="outline" size="small" onClick={loadModelState}>閲嶈瘯</ButtonV2>
                  </div>
                ) : !modelState() ? (
                  <div class="mafw-config-inline-loading">
                    <LoaderV2 width={14} height={14} /> 鍔犺浇涓€?                  </div>
                ) : (
                  <div class="mafw-config-models-grid">
                    {!modelAvailable() && (
                      <div class="mafw-config-hint">provider 鍒楄〃涓嶅彲鐢紝璇锋墜鍔ㄨ緭鍏?providerID / modelID</div>
                    )}
                    {modelAvailable() ? (
                      <ModelSelectRow
                        label="璁板繂 worker"
                        current={{ provider: modelState()?.recall?.workerModel?.providerID ?? "", model: modelState()?.recall?.workerModel?.modelID ?? "" }}
                        providers={modelAvailable() ?? []}
                        saving={!!modelSaving().recall}
                        onSave={(p, m) => saveRecallModel(p, m)}
                      />
                    ) : (
                      <ModelTextRow
                        label="璁板繂 worker"
                        current={{ provider: modelState()?.recall?.workerModel?.providerID ?? "", model: modelState()?.recall?.workerModel?.modelID ?? "" }}
                        saving={!!modelSaving().recall}
                        onSave={(p, m) => saveRecallModel(p, m)}
                      />
                    )}
                    {([
                      { kind: "default", label: "濯掍綋榛樿" },
                      { kind: "image", label: "濯掍綋 image" },
                      { kind: "video", label: "濯掍綋 video" },
                      { kind: "audio", label: "濯掍綋 audio" },
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

          {/* 鈺愨晲鈺?Usage 鈺愨晲鈺?*/}
          <Show when={activeNav() === "usage"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">馃搳</span>
                <span class="mafw-config-section-title">鐢ㄩ噺閰嶇疆</span>
              </div>
              <div class="mafw-config-section-body">
                {usageLoading() ? (
                  <div class="mafw-config-inline-loading">
                    <LoaderV2 width={14} height={14} /> 鍔犺浇涓€?                  </div>
                ) : (
                  <div class="mafw-usage-config-grid">
                    {/* Token Plan 闄愰 */}
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">Token Plan 闄愰 (5h/7d/month)</label>
                      <div class="mafw-config-usage-rows">
                        <Show when={Object.keys(usageLimits()).length > 0} fallback={
                          <div class="mafw-config-hint">鏃?token plan 閰嶇疆</div>
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

                    {/* API 浣欓棰勭畻 */}
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">API 浣欓棰勭畻 (budget)</label>
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
                                placeholder="鐣欑┖鍒犻櫎"
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
                                placeholder="provider 鍚嶇О"
                              />
                              <ButtonV2 variant="contrast" size="small" onClick={commitUsageAdd}>纭畾</ButtonV2>
                              <ButtonV2 variant="ghost" size="small" onClick={() => { setUsageAddKind(null); setUsageAddName('') }}>鍙栨秷</ButtonV2>
                            </div>
                          }>
                            <ButtonV2 variant="ghost" size="small" onClick={() => { setUsageAddKind('budget'); setUsageAddName('') }}>+ 娣诲姞 provider 棰勭畻</ButtonV2>
                          </Show>
                        </div>
                      </div>
                    </div>

                    {/* 骞冲彴 Cookie */}
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">骞冲彴 Cookie (鐢ㄩ噺鏌ヨ)</label>
                      <div class="mafw-config-usage-rows">
                        <Show when={Object.keys(usageCookies()).length > 0} fallback={
                          <div class="mafw-config-hint">鏃犲钩鍙?cookie锛屽彲鐐瑰嚮涓嬫柟娣诲姞锛堝 commandcode锛?/div>
                        }>
                          <For each={Object.keys(usageCookies())}>
                            {(name: string) => (
                              <div class="mafw-config-usage-provider-row cookie-row">
                                <span class="mafw-config-usage-provider-name">{name}</span>
                                <TextInputV2
                                  value={usageCookies()[name] ?? ""}
                                  onInput={e => setUsageCookie(name, e.currentTarget.value)}
                                  style={{ flex: 1, minWidth: 0 }}
                                  placeholder={`${name} 骞冲彴鐧诲綍鍚庣殑 session cookie`}
                                />
                                <ButtonV2 variant="ghost" size="small" onClick={() => removeUsageCookie(name)} aria-label="鍒犻櫎 cookie">鉁?/ButtonV2>
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
                                placeholder="cookie 鍚嶇О"
                              />
                              <ButtonV2 variant="contrast" size="small" onClick={commitUsageAdd}>纭畾</ButtonV2>
                              <ButtonV2 variant="ghost" size="small" onClick={() => { setUsageAddKind(null); setUsageAddName('') }}>鍙栨秷</ButtonV2>
                            </div>
                          }>
                            <ButtonV2 variant="ghost" size="small" onClick={() => { setUsageAddKind('cookie'); setUsageAddName('') }}>+ 娣诲姞骞冲彴 cookie</ButtonV2>
                          </Show>
                        </div>
                      </div>
                    </div>

                    {/* 骞冲彴鎻掍欢 */}
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">骞冲彴鎻掍欢</label>
                      <div class="mafw-config-usage-rows">
                        <Show when={usagePluginState().length > 0} fallback={
                          <div class="mafw-config-hint">鏃犳彃浠?/div>
                        }>
                          <For each={usagePluginState()}>
                            {(p: any) => (
                              <div class="mafw-config-usage-provider-row">
                                <span class="mafw-config-usage-provider-name">
                                  {p.status === 'ok' ? '鉁? : '鉂?} {p.file}
                                  {p.name && <span class="mafw-config-hint"> ({p.name})</span>}
                                  {p.overridden && <span class="mafw-config-hint"> [瑕嗙洊鍐呯疆]</span>}
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
                            馃搨 鎵撳紑鎻掍欢鐩綍
                          </ButtonV2>
                          <ButtonV2 variant="ghost" size="small" onClick={reloadUsagePlugins} disabled={usageReloading()}>
                            {usageReloading() ? '閲嶈浇涓?..' : '馃攧 閲嶆柊鍔犺浇'}
                          </ButtonV2>
                        </div>
                      </div>
                    </div>

                    {/* 淇濆瓨鎸夐挳 */}
                    <div class="mafw-config-actions-row" style={{ "margin-top": 8 }}>
                      <ButtonV2 variant="contrast" size="small" onClick={saveUsageConfig} disabled={usageSaving()}>
                        {usageSaving() ? "淇濆瓨涓?.." : "淇濆瓨鐢ㄩ噺閰嶇疆"}
                      </ButtonV2>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Show>

          {/* 鈺愨晲鈺?OpenCode Config 鈺愨晲鈺?*/}
          <Show when={activeNav() === "opencode"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">鈿欙笍</span>
                <span class="mafw-config-section-title">opencode 閰嶇疆</span>
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

          {/* 鈺愨晲鈺?MAFW Raw Config 鈺愨晲鈺?*/}
          <Show when={activeNav() === "mafw"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">馃敡</span>
                <span class="mafw-config-section-title">MAFW 鍘熷閰嶇疆</span>
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
            label={(x: string) => (x === "" ? "锛堣窡闅忛粯璁わ級" : modelLabel(x))}
            onSelect={(v) => { if (v != null && v !== props.current.model) props.onSave(pendingProvider(), v) }}
            disabled={props.saving || !pendingProvider()}
            placeholder={props.allowClear ? "锛堣窡闅忛粯璁わ級" : "model"}
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
          {props.saving ? "鈥? : "淇濆瓨"}
        </ButtonV2>
      </div>
    </div>
  )
}

