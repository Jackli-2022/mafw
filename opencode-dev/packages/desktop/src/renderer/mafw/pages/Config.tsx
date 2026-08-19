// @ts-nocheck
import { createSignal, createEffect, onCleanup, onMount } from "solid-js"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
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

  onMount(() => { loadConfig(); loadOpenCodeConfig() })

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
