// @ts-nocheck
import { createSignal, createEffect, onCleanup } from "solid-js"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"

export function AutomationsPage() {
  const [rules, setRules] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)

  async function fetchRules() {
    setLoading(true)
    try {
      const list = await window.api.mafw.automations.list() as any[]
      setRules(list)
    } catch (e) { console.warn("[mafw]", e) }
    setLoading(false)
  }

  createEffect(() => {
    fetchRules()
    const interval = setInterval(fetchRules, 10000)
    onCleanup(() => clearInterval(interval))
  })

  async function toggleRule(id: string, enabled: boolean) {
    try {
      await window.api.mafw.automations.toggle(id, enabled)
      await fetchRules()
    } catch (e) { console.warn("[mafw]", e) }
  }

  return (
    <div>
      <h2 class="mafw-page-title">Automations</h2>
      {loading() ? (
        <div style={{ display: "flex", "align-items": "center", gap: 8, padding: "20px 0" }}>
          <LoaderV2 width={16} height={16} />
          <span class="mafw-empty">Loading...</span>
        </div>
      ) : rules().length === 0 ? (
        <div class="mafw-empty">No automation rules configured</div>
      ) : (
        rules().map((rule, idx) =>
          <MafwContextMenu items={[
            { label: rule.enabled ? "Disable" : "Enable", onSelect: () => toggleRule(rule.id, !rule.enabled).catch((e: any) => console.warn("[mafw]", e)) },
            { separator: true },
            { label: "Disable", danger: true, onSelect: () => window.api.mafw.automations.toggle(rule.id, false).catch((e: any) => console.warn("[mafw]", e)) },
          ]}>
          <div class="mafw-card">
            <div style={{ flex: 1 }}>
              <div class="mafw-card-title">{rule.name || rule.id}</div>
              {rule.trigger?.schedule && (
                <div class="mafw-card-meta">Schedule: {rule.trigger.schedule}{rule.trigger.timezone ? ` (${rule.trigger.timezone})` : ""}</div>
              )}
              <div class="mafw-card-meta">Type: {rule.action?.type || "-"}</div>
            </div>
            <SwitchV2 checked={rule.enabled} onChange={v => toggleRule(rule.id, v)}>{rule.enabled ? "Enabled" : "Disabled"}</SwitchV2>
          </div>
          </MafwContextMenu>
        )
      )}
    </div>
  )
}
