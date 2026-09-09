// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For, ErrorBoundary } from "solid-js"
import { Portal } from "solid-js/web"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { UsageProviders } from "../components/UsageProviders"

interface ConfigSection {
  key: string
  expanded: boolean
  fields: [string, any][]
}

export type NavKey = "gateway" | "plugins" | "models" | "memory" | "usage" | "opencode" | "mafw"

export function isNavKey(v: unknown): v is NavKey {
  return NAV_ITEMS.some(n => n.key === v)
}

const NAV_ITEMS: { key: NavKey; icon: string; label: string; desc: string }[] = [
  { key: "gateway",  icon: "⚡", label: "Gateway",  desc: "管理 Gateway 进程状态、重启服务和查看日志" },
  { key: "plugins",  icon: "🧩", label: "Plugins",  desc: "切换 Runtime 引擎和媒体分析引擎" },
  { key: "models",   icon: "🤖", label: "Models",   desc: "配置记忆 worker 和媒体分析使用的 AI 模型" },
  { key: "memory",   icon: "🧠", label: "Memory",   desc: "记忆系统嵌入引擎（ONNX / llama.cpp / GPU 卸载）与向量索引" },
  { key: "usage",    icon: "📊", label: "Usage",    desc: "设置 token 限额、余额预算和平台 cookie" },
  { key: "opencode", icon: "⚙️", label: "opencode", desc: "编辑 opencode 原生配置文件" },
  { key: "mafw",     icon: "🔧", label: "MAFW",     desc: "MAFW 原始配置文件（高级用户）" },
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

  onMount(() => { loadConfig(); loadOpenCodeConfig(); loadPluginState(); loadModelState(); loadEmbeddingConfig() })

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

  const [restartingAgent, setRestartingAgent] = createSignal(false)

  const restartAgentRuntime = async () => {
    setRestartingAgent(true)
    try {
      await window.api.mafw.runtime.restartAgent()
      showToastV2({ description: "Agent 运行时重启中…", duration: 2000 })
    } catch (err: any) {
      showToastV2({ description: `Agent 重启失败: ${err.message}`, duration: 3000 })
    }
    setRestartingAgent(false)
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

  // ── Memory embedding ──
  const [embState, setEmbState] = createSignal<any>(null)
  const [embError, setEmbError] = createSignal("")
  const [embSaving, setEmbSaving] = createSignal(false)
  const [embDraft, setEmbDraft] = createSignal<any>(null)

  async function loadEmbeddingConfig() {
    setEmbError("")
    try {
      const st = await window.api.mafw.embedding.get()
      setEmbState(st)
      setEmbDraft({
        provider: st?.current?.provider ?? "off",
        engine: st?.current?.engine ?? "onnx",
        gpu: st?.current?.llamacpp?.gpu ?? "cpu",
        threads: st?.current?.threads ?? 2,
        contextSize: st?.current?.llamacpp?.contextSize ?? 2048,
      })
    } catch (err: any) {
      setEmbError(err.message)
    }
  }

  function embDirty() {
    const d = embDraft()
    const c = embState()?.current
    if (!d || !c) return false
    return d.provider !== c.provider
      || d.engine !== c.engine
      || d.gpu !== (c.llamacpp?.gpu ?? "cpu")
      || Number(d.threads) !== c.threads
      || Number(d.contextSize) !== (c.llamacpp?.contextSize ?? 2048)
  }

  async function saveEmbeddingConfig() {
    const d = embDraft()
    if (!d) return
    setEmbSaving(true)
    try {
      const res = await window.api.mafw.embedding.update({
        provider: d.provider,
        engine: d.engine,
        threads: Number(d.threads),
        llamacpp: { gpu: d.gpu, contextSize: Number(d.contextSize) },
      })
      setEmbState((prev: any) => ({ ...(prev ?? {}), current: res.current, runtime: res.runtime }))
      showToastV2({ description: res.note ? `已保存：${res.note}` : "嵌入配置已保存", duration: 4000 })
      // 后台回填进行中，稍后再拉一次覆盖率
      setTimeout(() => { loadEmbeddingConfig() }, 15000)
    } catch (err: any) {
      showToastV2({ description: `保存失败: ${err.message}`, duration: 4000 })
      await loadEmbeddingConfig()
    }
    setEmbSaving(false)
  }

  const embDirtyMemo = () => embDirty()


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
        <div class="mafw-config-nav-desc" style={{ "padding": "0 16px 12px", "font-size": 11, "color": "var(--text-4)", "line-height": 1.4 }}>
          配置 Gateway、插件、模型和用量
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
              <div class="mafw-config-section-body" style={{ "padding-top": 12 }}>
                <div class="mafw-config-section-desc">
                  Gateway 进程管理。查看连接状态、重启服务、获取日志路径。
                </div>
                <div class="mafw-config-actions-row">
                  <ButtonV2 variant="outline" size="small" onClick={restartGateway} disabled={restarting()}>
                    {restarting() ? "重启中…" : "Restart Gateway"}
                  </ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={restartAgentRuntime} disabled={restartingAgent()}>
                    {restartingAgent() ? "重启中…" : "重启 Agent 运行时"}
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
              <div class="mafw-config-section-body" style={{ "padding-top": 12 }}>
                <div class="mafw-config-section-desc">
                  切换运行时引擎和媒体分析引擎。Runtime 控制 AI 模型调用方式，Media 控制图片/视频/音频分析引擎。
                </div>
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
              <div class="mafw-config-section-body" style={{ "padding-top": 12 }}>
                <div class="mafw-config-section-desc">
                  配置记忆 worker 和媒体分析使用的 AI 模型。记忆 worker 负责压缩和反思，媒体模型负责多模态分析。
                </div>
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

          {/* ═══ Memory ═══*/}
          <Show when={activeNav() === "memory"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">🧠</span>
                <span class="mafw-config-section-title">记忆系统</span>
              </div>
              <div class="mafw-config-section-body" style={{ "padding-top": 12 }}>
                <div class="mafw-config-section-desc">
                  配置长期记忆的嵌入引擎（dense 检索通道）。切换引擎会热重建运行时并后台回填向量索引，无需重启 Gateway。
                </div>
                {embError() ? (
                  <div class="mafw-config-error-row">
                    <span>加载失败: {embError()}</span>
                    <ButtonV2 variant="outline" size="small" onClick={loadEmbeddingConfig}>重试</ButtonV2>
                  </div>
                ) : !embState() || !embDraft() ? (
                  <div class="mafw-config-inline-loading">
                    <LoaderV2 width={14} height={14} /> 加载中…
                  </div>
                ) : (
                  <div class="mafw-config-models-grid">
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">嵌入提供方</label>
                      <span class="mafw-config-hint">off = 仅 BM25 检索；local = 本地模型；dashscope = 云端 API</span>
                      <SelectV2
                        options={embState()?.available?.providers ?? ["off", "local", "dashscope"]}
                        current={embDraft().provider}
                        value={(x: string) => x}
                        label={(x: string) => x === "off" ? "off（关闭 dense 通道）" : x === "local" ? "local（本地嵌入）" : "dashscope（云端 API）"}
                        onSelect={(v) => v && setEmbDraft((p: any) => ({ ...p, provider: v }))}
                        disabled={embSaving()}
                      />
                    </div>
                    <Show when={embDraft().provider === "local"}>
                      <div class="mafw-config-field-group">
                        <label class="mafw-config-label">本地引擎</label>
                        <span class="mafw-config-hint">onnx = 进程内 transformers.js；llamacpp = llama-server 子进程（内存更低，支持 GPU）</span>
                        <SelectV2
                          options={embState()?.available?.engines ?? ["onnx", "llamacpp"]}
                          current={embDraft().engine}
                          value={(x: string) => x}
                          label={(x: string) => x === "onnx" ? "onnx（进程内）" : "llamacpp（sidecar，支持 GPU）"}
                          onSelect={(v) => v && setEmbDraft((p: any) => ({ ...p, engine: v }))}
                          disabled={embSaving()}
                        />
                      </div>
                    </Show>
                    <Show when={embDraft().provider === "local" && embDraft().engine === "llamacpp"}>
                      <div class="mafw-config-field-group">
                        <label class="mafw-config-label">运行设备</label>
                        <span class="mafw-config-hint">vulkan / cuda 会自动下载对应二进制变体（cuda 含 cudart 约 615MB）</span>
                        <SelectV2
                          options={embState()?.available?.gpus ?? ["cpu", "vulkan", "cuda"]}
                          current={embDraft().gpu}
                          value={(x: string) => x}
                          label={(x: string) => x}
                          onSelect={(v) => v && setEmbDraft((p: any) => ({ ...p, gpu: v }))}
                          disabled={embSaving()}
                        />
                      </div>
                      <div class="mafw-config-field-group">
                        <label class="mafw-config-label">上下文窗口（token）</label>
                        <span class="mafw-config-hint">需 ≥ 嵌入文本上限；过大会涨内存（KV/计算缓冲随其线性增长）</span>
                        <TextInputV2
                          type="number"
                          value={String(embDraft().contextSize)}
                          onInput={e => setEmbDraft((p: any) => ({ ...p, contextSize: e.currentTarget.value }))}
                          style={{ width: 100 }}
                        />
                      </div>
                    </Show>
                    <Show when={embDraft().provider === "local" && embDraft().engine === "onnx"}>
                      <div class="mafw-config-field-group">
                        <label class="mafw-config-label">CPU 线程帽</label>
                        <span class="mafw-config-hint">ONNX 默认占满全核；2 是后台服务的推荐值</span>
                        <TextInputV2
                          type="number"
                          value={String(embDraft().threads)}
                          onInput={e => setEmbDraft((p: any) => ({ ...p, threads: e.currentTarget.value }))}
                          style={{ width: 80 }}
                        />
                      </div>
                    </Show>
                    <div class="mafw-config-field-group">
                      <label class="mafw-config-label">运行时状态</label>
                      <span class="mafw-config-hint">
                        {embState()?.runtime?.active
                          ? `${embState().runtime.active} · 向量 ${embState().runtime.vectors}/${embState().runtime.indexEntries}（覆盖 ${(embState().runtime.coverage * 100).toFixed(0)}%）`
                          : "dense 通道未启用"}
                      </span>
                    </div>
                    <div style={{ "margin-top": 8 }}>
                      <ButtonV2 variant="contrast" size="small" onClick={saveEmbeddingConfig} disabled={embSaving() || !embDirtyMemo()}>
                        {embSaving() ? "保存中…" : "应用"}
                      </ButtonV2>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Show>

          {/* ═══ Usage ═══*/}
          <Show when={activeNav() === "usage"}>
            <UsageProviders modelAvailable={modelAvailable} />
          </Show>

          {/* ═══ OpenCode Config ═══*/}
          <Show when={activeNav() === "opencode"}>
            <div class="mafw-config-section">
              <div class="mafw-config-section-header">
                <span class="mafw-config-section-icon">⚙️</span>
                <span class="mafw-config-section-title">opencode 配置</span>
              </div>
              <div class="mafw-config-section-body" style={{ "padding-top": 12 }}>
                <div class="mafw-config-section-desc">
                  opencode 原生配置编辑器。修改后可能需要重启 Gateway 生效。
                </div>
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
              <div class="mafw-config-section-body" style={{ "padding-top": 12 }}>
                <div class="mafw-config-section-desc">
                  MAFW 原始配置文件编辑。高级用户使用，修改前请了解配置项含义。
                </div>
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

function SearchSelect(props: {
  options: { id: string; label: string }[]
  current: { id: string; label: string } | undefined
  disabled?: boolean
  placeholder?: string
  width?: number
  /** Enter with typed text picks it verbatim when no exact option matches (free-form ids). */
  allowFree?: boolean
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [hi, setHi] = createSignal(0)
  const [listPos, setListPos] = createSignal<{ top: number; left: number; width: number } | null>(null)
  let wrapRef: HTMLDivElement | undefined
  const filtered = () => {
    const q = query().trim().toLowerCase()
    if (!q) return props.options
    return props.options.filter(o => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
  }
  const display = () => (open() ? query() : (props.current?.label || props.current?.id || ""))
  const pick = (id: string) => { props.onSelect(id); setOpen(false); setQuery("") }
  // The list is portaled to <body> with fixed positioning: card-level
  // overflow:hidden would otherwise clip it for rows near the section bottom.
  const openList = () => {
    const el = wrapRef
    if (el) {
      const r = el.getBoundingClientRect()
      setListPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    setOpen(true)
    setHi(0)
  }
  const closeList = () => { setOpen(false); setQuery("") }
  onCleanup(() => window.removeEventListener("scroll", closeList, true))
  return (
    <div class="mafw-search-select" ref={wrapRef} style={props.width ? { width: props.width + "px" } : undefined}>
      <TextInputV2
        value={display()}
        onInput={e => { setQuery(e.currentTarget.value); openList() }}
        onFocus={() => openList()}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          const list = filtered()
          if (e.key === "ArrowDown") { e.preventDefault(); openList(); setHi(h => Math.min(h + 1, list.length - 1)) }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
          else if (e.key === "Enter") {
            e.preventDefault()
            const typed = query().trim()
            const exact = list.find(o => o.id === typed || o.label === typed)
            if (exact) pick(exact.id)
            else if (props.allowFree && typed) pick(typed)
            else if (list[hi()]) pick(list[hi()].id)
          }
          else if (e.key === "Escape") closeList()
        }}
        disabled={props.disabled}
        placeholder={props.placeholder}
      />
      <Show when={open() && listPos() && filtered().length > 0}>
        <Portal>
          <div
            class="mafw-search-select-list"
            style={{
              position: "fixed",
              top: listPos()!.top + "px",
              left: listPos()!.left + "px",
              width: listPos()!.width + "px",
            }}
            onMouseDown={e => e.preventDefault()}
          >
            <For each={filtered()}>
              {(o, i) => (
                <div
                  class="mafw-search-select-item"
                  classList={{ hi: i() === hi(), current: props.current?.id === o.id }}
                  onMouseDown={e => { e.preventDefault(); pick(o.id) }}
                  onMouseEnter={() => setHi(i())}
                >
                  {o.label}
                  {props.current?.id === o.id && <span class="mafw-search-select-check">✓</span>}
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
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
  // props.current arrives async (models.get resolves after mount) — keep the
  // local pending selection in sync with the saved value.
  createEffect(() => {
    if (props.current.provider) setPendingProvider(props.current.provider)
  })
  const providerOptions = () => (props.providers ?? [])
    .map(p => ({ id: p.providerID, label: p.providerName || p.providerID }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  const modelsFor = (pid: string) => (props.providers ?? []).find(p => p.providerID === pid)?.models ?? []
  const currentProviderOption = () => providerOptions().find(o => o.id === pendingProvider())
  const modelOptions = () => props.allowClear
    ? [{ id: "", label: "（跟随默认）" }, ...modelsFor(pendingProvider()).map(m => ({ id: m.id, label: m.name || m.id }))]
    : modelsFor(pendingProvider()).map(m => ({ id: m.id, label: m.name || m.id }))
  const currentModelOption = () => modelOptions().find(o => o.id === props.current.model)
  return (
    <div class="mafw-config-model-row">
      <span class="mafw-config-model-label">{props.label}</span>
      <div style={{ display: "flex", gap: 6, "align-items": "center" }}>
        <SearchSelect
          options={providerOptions()}
          current={currentProviderOption()}
          width={180}
          onSelect={id => setPendingProvider(id)}
          disabled={props.saving}
          placeholder="provider"
        />
        <SearchSelect
          options={modelOptions()}
          current={currentModelOption()}
          width={190}
          onSelect={id => { if (id !== props.current.model) props.onSave(pendingProvider(), id) }}
          disabled={props.saving || !pendingProvider()}
          placeholder={props.allowClear ? "（跟随默认）" : "model"}
        />
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

