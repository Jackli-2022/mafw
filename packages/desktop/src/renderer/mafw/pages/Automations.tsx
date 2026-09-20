// @ts-nocheck
import { createSignal, createEffect, onCleanup, Show } from "solid-js"
import { Switch as SwitchV2 } from "@mafw/ui/v2/switch-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { PageHeader } from "../components/PageHeader"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { SelectV2 } from "@mafw/ui/v2/select-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { MafwContextMenu } from "../components/MafwContextMenu"
import type { ContextMenuItem } from "../components/MafwContextMenu"

export function AutomationsPage() {
  const [rules, setRules] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)

  // Draft form state (POST /api/automations/draft — saved disabled).
  const [formOpen, setFormOpen] = createSignal(false)
  const [fId, setFId] = createSignal("")
  const [fSchedule, setFSchedule] = createSignal("")
  const [fTimezone, setFTimezone] = createSignal("Asia/Shanghai")
  const [fAction, setFAction] = createSignal<"triage" | "goal">("triage")
  const [fTemplate, setFTemplate] = createSignal("")
  const [fSkill, setFSkill] = createSignal("")
  const [fMaxLoops, setFMaxLoops] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

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

  async function submitDraft() {
    if (!fId().trim() || !fSchedule().trim() || submitting()) return
    setSubmitting(true)
    try {
      const res = await window.api.mafw.automations.draft({
        id: fId().trim(),
        trigger: { schedule: fSchedule().trim(), timezone: fTimezone().trim() || "UTC" },
        skill: fSkill().trim() || undefined,
        action: { type: fAction(), template: fTemplate().trim() || undefined },
        goal_defaults: fMaxLoops().trim() ? { maxLoops: parseInt(fMaxLoops().trim(), 10) } : undefined,
      })
      if (res?.valid) {
        showToastV2({ description: `规则 ${res.id} 已保存为草稿（禁用态），在列表中手动启用`, duration: 4000 })
        setFormOpen(false)
        setFId(""); setFSchedule(""); setFTemplate(""); setFSkill(""); setFMaxLoops("")
        await fetchRules()
      } else {
        showToastV2({ description: `校验失败: ${(res?.errors || []).join("; ") || "unknown"}`, duration: 5000 })
      }
    } catch (e: any) {
      showToastV2({ description: `起草失败: ${e?.message || e}`, duration: 4000 })
    }
    setSubmitting(false)
  }

  return (
    <div>
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": 12 }}>
        <PageHeader title="Automations" subtitle="定时与事件驱动任务" />
        <ButtonV2 variant="outline" size="small" onClick={() => setFormOpen(o => !o)}>{formOpen() ? "收起" : "+ 新建规则"}</ButtonV2>
      </div>

      <Show when={formOpen()}>
        <div class="mafw-card" style={{ display: "flex", "flex-direction": "column", gap: 8, "margin-bottom": 16 }}>
          <div style={{ display: "flex", gap: 8, "flex-wrap": "wrap" }}>
            <TextInputV2 style={{ width: 200 }} value={fId()} onInput={e => setFId(e.currentTarget.value)} placeholder="规则 ID（如 nightly-review）" />
            <TextInputV2 style={{ width: 200 }} value={fSchedule()} onInput={e => setFSchedule(e.currentTarget.value)} placeholder="cron（如 0 3 * * *）" />
            <TextInputV2 style={{ width: 160 }} value={fTimezone()} onInput={e => setFTimezone(e.currentTarget.value)} placeholder="时区（Asia/Shanghai）" />
          </div>
          <div style={{ display: "flex", gap: 8, "flex-wrap": "wrap", "align-items": "center" }}>
            <div style={{ width: 140 }}>
              <SelectV2
                value={fAction()}
                onChange={(v: any) => setFAction(v)}
                options={[
                  { value: "triage", label: "triage（建议确认）" },
                  { value: "goal", label: "goal（直接建 Goal）" },
                ]}
              />
            </div>
            <TextInputV2 style={{ width: 240 }} value={fTemplate()} onInput={e => setFTemplate(e.currentTarget.value)} placeholder="模板文案（可选）" />
            <TextInputV2 style={{ width: 180 }} value={fSkill()} onInput={e => setFSkill(e.currentTarget.value)} placeholder="执行 skill（可选）" />
            <TextInputV2 style={{ width: 100 }} value={fMaxLoops()} onInput={e => setFMaxLoops(e.currentTarget.value)} placeholder="maxLoops" />
          </div>
          <div style={{ display: "flex", gap: 8, "align-items": "center" }}>
            <ButtonV2 variant="contrast" size="small" disabled={!fId().trim() || !fSchedule().trim() || submitting()} onClick={() => void submitDraft()}>
              {submitting() ? "提交中…" : "保存草稿（禁用态）"}
            </ButtonV2>
            <span style={{ "font-size": 11, color: "var(--text-base)" }}>草稿保存后需在列表中手动启用；启用前请确认 cron 表达式无误。</span>
          </div>
        </div>
      </Show>

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
