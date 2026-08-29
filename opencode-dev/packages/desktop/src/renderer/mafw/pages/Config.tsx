// @ts-nocheck
import { createSignal, createEffect, onCleanup, onMount } from "solid-js"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"

interface ConfigSection {
  key: string
  expanded: boolean
  fields: [string, any][]
}

export function ConfigPage(props: { onBack?: () => void }) {
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

  onMount(() => { loadConfig(); loadOpenCodeConfig(); loadPluginState(); loadModelState() })

  function toggleSection(key: string) {
    setSections(prev => prev.map(s => s.key === key ? { ...s, expanded: !s.expanded } : s))
  }

  function updateField(sectionKey: string, fieldKey: string, value: string) {
    setSections(prev => prev.map(s => {
      if (s.key !== sectionKey) return s
      return {
        ...s,
        fields: s.fields.map(([k, v]) => k === fieldKey ? [k, value] : [k, v]),
      }
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

  // ── Gateway ops (moved from the rail status bar) ──
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

  // ── Plugin Switcher (Runtime + Media) ──
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

  // Runtime switch
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

  // Media engine switch
  async function switchMediaEngine(kind: string, value: string) {
    setMediaSwitching(true)
    try {
      const opts = kind === 'engine' ? { engine: value } : { [kind]: { engine: value } }
      const res = await window.api.mafw.media.switch(opts)
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

  // Available runtime plugin names (status=ok + opencode)
  const runtimeOptions = () => {
    const ok = rtPlugins().filter(p => p.status === 'ok').map(p => p.name).filter(Boolean)
    if (!ok.includes('opencode')) ok.unshift('opencode')
    return ok
  }

  // Available media engine names
  const mediaOptions = () => {
    const ok = mediaPlugins().filter(p => p.status === 'ok').map(p => p.name).filter(Boolean)
    if (!ok.includes('pi')) ok.push('pi')
    return ok
  }

  // ── Models (recall worker + media models) ──
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

  // ── OpenCode config (native opencode /config) ──
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

  return (
    <div>
      <div class="mafw-config-head">
        {props.onBack && (
          <ButtonV2 variant="ghost" size="small" onClick={() => props.onBack?.()}>← 返回</ButtonV2>
        )}
        <h2 class="mafw-page-title">Configuration</h2>
      </div>
      {/* Gateway ops */}
      <div class="mafw-config-ops">
        <div class="mafw-config-ops-title">Gateway 运维</div>
        <div class="mafw-config-ops-row">
          <span class="mafw-config-ops-status">
            <span class="mafw-titlebar-dot" classList={{
              ready: gwStatus()?.state === "ready",
              starting: gwStatus()?.state === "starting",
              failed: gwStatus()?.state === "failed",
              stopped: !gwStatus() || gwStatus()?.state === "stopped",
            }} />
            {gwStateText()}
          </span>
        </div>
        <div class="mafw-config-ops-actions">
          <ButtonV2 variant="outline" size="small" onClick={restartGateway} disabled={restarting()}>
            {restarting() ? "重启中…" : "Restart Gateway"}
          </ButtonV2>
          <ButtonV2 variant="outline" size="small" onClick={() => gwStatus()?.url && copyText(gwStatus().url, "URL")} disabled={!gwStatus()?.url}>
            Copy Gateway URL
          </ButtonV2>
          <ButtonV2 variant="outline" size="small" onClick={async () => {
            try {
              const p = await window.api.mafw.gateway.logsPath()
              copyText(p, "日志路径")
            } catch { /* ignore */ }
          }}>
            Copy logs path
          </ButtonV2>
        </div>
      </div>

      {/* Plugin Switcher */}
      <div class="mafw-config-ops" style={{ "margin-bottom": 16 }}>
        <div class="mafw-config-ops-title">插件 Plugins</div>

        {rtEnvOverride() && (
          <div style={{
            "background": "var(--color-warning-subtle, #fef3cd)",
            "border": "1px solid var(--color-warning-border, #ffc107)",
            "border-radius": 6,
            "padding": "6px 10px",
            "font-size": 12,
            "margin-bottom": 8,
            color: "var(--color-warning-text, #856404)",
          }}>
            ⚠️ 环境变量 MAFW_RUNTIME_PLUGIN 已覆盖 config.yaml 设置，下方 Runtime 下拉仅展示当前状态。
          </div>
        )}

        {/* Runtime */}
        <div style={{ "margin-bottom": 12 }}>
          <label style={{ display: "block", "font-size": 12, "font-weight": 500, "margin-bottom": 4 }}>
            Runtime（{rtInfo()?.active?.name ?? 'opencode'}）
          </label>
          <div style={{ display: "flex", gap: 8, "align-items": "center" }}>
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
          </div>
        </div>

        {/* Media Engine */}
        <div>
          <label style={{ display: "block", "font-size": 12, "font-weight": 500, "margin-bottom": 4 }}>
            Media Engine
          </label>
          {[
            { kind: 'engine', label: 'Default', value: mediaEngine() },
            { kind: 'image', label: 'Image', value: mediaImage() },
            { kind: 'video', label: 'Video', value: mediaVideo() },
            { kind: 'audio', label: 'Audio', value: mediaAudio() },
          ].map(({ kind, label, value }) => (
            <div class="mafw-plugin-row">
              <span class="mafw-plugin-row-label">{label}</span>
              <div style={{ width: 220 }}>
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
          {mediaSwitching() && (
            <div style={{ display: "flex", "align-items": "center", gap: 4, "margin-top": 4 }}>
              <LoaderV2 width={12} height={12} />
              <span style={{ "font-size": 11, color: "var(--text-base)" }}>切换中…</span>
            </div>
          )}
        </div>
      </div>

      {/* Models */}
      <div class="mafw-config-ops" style={{ "margin-bottom": 16 }}>
        <div class="mafw-config-ops-title">模型 Models</div>
        {modelError() ? (
          <div>
            <div style={{ "font-size": 12, color: "var(--color-warning-text, #856404)", "margin-bottom": 8 }}>
              加载失败: {modelError()}
            </div>
            <ButtonV2 variant="outline" size="small" onClick={loadModelState}>重试</ButtonV2>
          </div>
        ) : !modelState() ? (
          <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "8px 0" }}>
            <LoaderV2 width={14} height={14} />
            <span style={{ "font-size": 12 }}>加载中…</span>
          </div>
        ) : (
          <div>
            {!modelAvailable() && (
              <div style={{ "font-size": 11, color: "var(--text-base)", "margin-bottom": 8 }}>
                provider 列表不可用，请手动输入 providerID / modelID
              </div>
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

      {/* OpenCode config */}
      <div class="mafw-config-ops" style={{ "margin-bottom": 16 }}>
        <div class="mafw-config-ops-title">opencode 配置</div>
        {ocLoading() ? (
          <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "8px 0" }}>
            <LoaderV2 width={16} height={16} />
            <span class="mafw-empty">Loading...</span>
          </div>
        ) : ocSections().length === 0 ? (
          <div class="mafw-empty">Unable to load opencode config</div>
        ) : (
          ocSections().map(sec => (
            <div style={{ "margin-bottom": 8 }}>
              <div
                onClick={() => toggleOcSection(sec.key)}
                class="mafw-card"
                style={{ cursor: "pointer", "font-size": 13, "font-weight": 500 }}
              >
                <Icon name="chevron-down" size="small" style={{ transform: sec.expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }} />
                {sec.key}
              </div>
              {sec.expanded && (
                <div style={{ padding: "8px 10px 8px 24px" }}>
                  {sec.fields.map(([fieldKey, fieldValue]) => (
                    <div style={{ "margin-bottom": 8 }}>
                      <label style={{ display: "block", "font-size": 11, "margin-bottom": 2, color: "var(--text-base)" }}>{fieldKey}</label>
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
          ))
        )}
        {ocMessage() && <div style={{ "font-size": 11, "margin-top": 8, color: "var(--text-interactive-base)" }}>{ocMessage()}</div>}
      </div>
      {loading() ? (
          <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "20px 0" }}>
            <LoaderV2 width={16} height={16} />
            <span class="mafw-empty">Loading...</span>
          </div>
      ) : sections().length === 0 ? (
        <div class="mafw-empty">Unable to load configuration</div>
      ) : (
        sections().map(sec => (
          <div style={{ "margin-bottom": 8 }}>
            <div
              onClick={() => toggleSection(sec.key)}
              class="mafw-card"
              style={{ cursor: "pointer", "font-size": 13, "font-weight": 500 }}
            >
              <Icon name="chevron-down" size="small" style={{ transform: sec.expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s" }} />
              {sec.key}
            </div>
            {sec.expanded && (
              <div style={{ padding: "8px 10px 8px 24px" }}>
                {sec.fields.map(([fieldKey, fieldValue]) => (
                  <div style={{ "margin-bottom": 8 }}>
                    <label style={{ display: "block", "font-size": 11, "margin-bottom": 2, color: "var(--text-base)" }}>{fieldKey}</label>
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
        ))
      )}
      {message() && <div style={{ "font-size": 11, "margin-top": 8, color: "var(--text-interactive-base)" }}>{message()}</div>}
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
  const modelsFor = (pid: string) => (props.providers ?? []).find(p => p.providerID === pid)?.models ?? []
  const modelLabel = (id: string) => modelsFor(pendingProvider()).find(m => m.id === id)?.name ?? id
  return (
    <div class="mafw-plugin-row">
      <span class="mafw-plugin-row-label">{props.label}</span>
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
    <div class="mafw-plugin-row">
      <span class="mafw-plugin-row-label">{props.label}</span>
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
