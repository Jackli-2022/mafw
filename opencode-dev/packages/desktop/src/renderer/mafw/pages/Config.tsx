// @ts-nocheck
import { createSignal, createEffect, onCleanup, onMount } from "solid-js"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"

interface ConfigSection {
  key: string
  expanded: boolean
  fields: [string, any][]
}

export function ConfigPage() {
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

  onMount(() => { loadConfig() })

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

  return (
    <div>
      <h2 class="mafw-page-title">Configuration</h2>
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
