// Usage provider workbench: one card per provider (JS usage plugin or local-stats
// provider), config lives inside the per-card drawer — no flat lists. Templates
// generate plugin files server-side; custom plugins edit via the built-in code editor.
import { createSignal, createEffect, For, Show, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TextareaV2 } from "@mafw/ui/v2/textarea-v2"
import { Switch as SwitchV2 } from "@mafw/ui/v2/switch-v2"
import { SelectV2 } from "@mafw/ui/v2/select-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"

type SchemaField = { key: string; label: string; type: string; options?: string[]; default?: string | number | boolean }
type TemplateField = { key: string; label: string; type: string; required?: boolean; options?: string[]; placeholder?: string; hint?: string; default?: string | number | boolean }
type UsageTemplate = { id: string; label: string; description: string; fields: TemplateField[] }

type Card = {
  key: string
  name: string
  displayName: string
  origin: "user" | "builtin" | "override" | "local"
  kind: "local" | "balance" | "plan"
  implicit?: boolean
  badge: string
  status: "ok" | "error" | "disabled"
  error?: string
  summary?: string
  configSchema?: SchemaField[]
  windows?: any[]
}

const fmt = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

const fmtReset = (ms: number): string => {
  if (ms <= 0) return '<1h'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h >= 24) return `${Math.floor(h / 24)}d${h % 24}h`
  return h > 0 ? `${h}h${m}m` : `${m}m`
}

// Per-kind overview rendering. A balance plugin without a budget must NOT
// degrade into local-stats-shaped tokens — platform money data leads, local
// tokens are demoted to meta.
function windowView(card: Card, w: any, budget: number | undefined): { label: string; value: string; bar?: number; meta: string[] } {
  if (card.kind === "balance") {
    if (w.limit > 0) {
      return { label: "余额", value: `$${w.used ?? 0} / $${w.limit}`, bar: w.pct ?? 0, meta: w.remaining !== undefined ? [`剩余 $${w.remaining}`] : [] }
    }
    if (w.remaining !== undefined && w.remaining > 0) {
      return { label: "余额", value: `$${w.remaining}`, meta: w.tokens > 0 ? [`本机累计 ${fmt(w.tokens)} tok`] : [] }
    }
    return {
      label: "已花费",
      value: `$${w.used ?? 0}`,
      meta: [w.tokens > 0 ? `本机累计 ${fmt(w.tokens)} tok` : "", w.projectedCost > 0 ? `预计 $${w.projectedCost}` : ""].filter(Boolean),
    }
  }
  if (card.kind === "plan") {
    return {
      label: w.window,
      value: w.limit > 0 ? `${w.pct ?? 0}% · $${w.used ?? 0}/$${w.limit}` : `${w.pct ?? 0}%`,
      bar: w.pct ?? 0,
      meta: w.resetAt ? [`${fmtReset(w.resetAt - Date.now())}后重置`] : [],
    }
  }
  const used = w.used ?? 0
  if (budget && budget > 0) {
    return { label: "预算", value: `$${used} / $${budget}`, bar: Math.min(100, Math.round((used / budget) * 100)), meta: w.tokens > 0 ? [`${fmt(w.tokens)} tok`] : [] }
  }
  return { label: "累计", value: w.tokens > 0 ? `${fmt(w.tokens)} tok` : `$${used}`, meta: w.projectedCost > 0 ? [`预计 $${w.projectedCost}`] : [] }
}

function summaryOf(provider: any): string | undefined {
  const w = provider?.windows?.[0]
  if (!w) return undefined
  if (w.limit > 0) return `${w.pct ?? 0}% · $${w.used ?? 0} / $${w.limit}`
  if (w.tokens !== undefined && w.tokens > 0) return `${fmt(w.tokens)} tok`
  if (w.used !== undefined && w.used > 0) return `$${w.used}`
  return undefined
}

function mergeCards(
  plugins: any[],
  usageProviders: any[],
  limits: Record<string, any>,
  budgets: Record<string, number>,
  nameOf: (id: string) => string,
): Card[] {
  const cards: Card[] = []
  const seen = new Set<string>()
  for (const p of plugins) {
    const name = p.name || p.file
    if (p.name && seen.has(p.name)) continue
    if (p.name) seen.add(p.name)
    const usage = usageProviders.find((u: any) => u.name === p.name)
    const status: Card["status"] = p.status === "error" ? "error" : p.disabled ? "disabled" : "ok"
    const kind: Card["kind"] = p.pluginType === "local" ? "local" : usage?.type === "token-plan" ? "plan" : "balance"
    cards.push({
      key: p.file || name,
      name: p.name || name,
      displayName: nameOf(p.name || name),
      origin: p.origin || "user",
      kind,
      badge: kind === "local" ? "本地统计" : `插件 · ${kind === "plan" ? "token-plan" : "balance"}`,
      status,
      error: p.error,
      summary: summaryOf(usage),
      configSchema: p.configSchema,
      windows: usage?.windows,
    })
  }
  for (const u of usageProviders) {
    if (seen.has(u.name)) continue
    if (!u.windows?.length && budgets[u.name] === undefined && limits[u.name] === undefined) continue
    seen.add(u.name)
    cards.push({
      key: u.name,
      name: u.name,
      displayName: nameOf(u.name),
      origin: "local",
      kind: "local",
      implicit: true,
      badge: "本地统计",
      status: "ok",
      summary: summaryOf(u),
      windows: u.windows,
    })
  }
  for (const name of Object.keys({ ...limits, ...budgets })) {
    if (seen.has(name)) continue
    seen.add(name)
    cards.push({ key: name, name, displayName: nameOf(name), origin: "local", kind: "local", implicit: true, badge: "本地统计", status: "ok" })
  }
  return cards
}

const badgeText = (c: Card): string => {
  if (c.status === "disabled") return "已禁用"
  if (c.status === "error") return "错误"
  if (c.origin === "builtin") return "内置"
  if (c.origin === "override") return "覆盖内置"
  return ""
}

export function UsageProviders(props: { modelAvailable: () => any[] | null }) {
  const [pluginsData, setPluginsData] = createSignal<{ plugins: any[]; templates: UsageTemplate[]; builtins: string[] } | null>(null)
  const [usageProviders, setUsageProviders] = createSignal<any[]>([])
  const [cfg, setCfg] = createSignal<any>({ limits: {}, budgets: {}, cookies: {}, pluginConfig: {}, disabledPlugins: [] })
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [selected, setSelected] = createSignal<string | null>(null)
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [testResult, setTestResult] = createSignal<string | null>(null)
  const [source, setSource] = createSignal<string | null>(null)
  const [sourceOrigin, setSourceOrigin] = createSignal<string>("user")
  const [sourceLoading, setSourceLoading] = createSignal(false)
  const [wizardStep, setWizardStep] = createSignal<"closed" | "pick" | "form">("closed")
  const [wizardTemplate, setWizardTemplate] = createSignal<UsageTemplate | null>(null)
  const [wizardValues, setWizardValues] = createSignal<Record<string, any>>({})
  const [schemaDraft, setSchemaDraft] = createSignal<Record<string, any>>({})

  const nameOf = (id: string) => {
    const p = (props.modelAvailable() ?? []).find(p => p.providerID === id)
    return p?.providerName || id
  }

  const loadPlugins = async () => {
    try {
      const res = await window.api.mafw.sessions.usagePlugins()
      setPluginsData({ plugins: res?.plugins ?? [], templates: (res as any)?.templates ?? [], builtins: (res as any)?.builtins ?? [] })
    } catch { /* keep old state */ }
  }

  const loadUsage = async () => {
    try {
      const r = await window.api.mafw.sessions.usage()
      setUsageProviders(r?.providers ?? [])
    } catch { /* keep old state */ }
  }

  const loadCfg = async () => {
    try {
      const c = await window.api.mafw.config.get("usage")
      setCfg(c || { limits: {}, budgets: {}, cookies: {}, pluginConfig: {}, disabledPlugins: [] })
    } catch { /* keep old state */ }
  }

  const refreshAll = async () => {
    await Promise.all([loadPlugins(), loadUsage(), loadCfg()])
  }

  onMount(() => {
    refreshAll().finally(() => setLoading(false))
  })

  const cards = () => mergeCards(pluginsData()?.plugins ?? [], usageProviders(), cfg().limits || {}, cfg().budgets || {}, nameOf)

  const selectedCard = () => cards().find(c => c.key === selected()) || null

  createEffect(() => {
    const card = selectedCard()
    setTestResult(null)
    setConfirmDelete(false)
    setSource(null)
    setSchemaDraft(card?.name ? { ...(cfg().pluginConfig?.[card.name] || {}) } : {})
    if (card && card.origin !== "local") {
      setSourceLoading(true)
      window.api.mafw.sessions.usagePluginSource(card.name)
        .then(r => {
          setSource(r?.source ?? null)
          setSourceOrigin(r?.origin ?? "user")
          if (r?.error && !r?.source) showToastV2({ description: r.error, duration: 2500 })
        })
        .catch((e: any) => showToastV2({ description: `读取源码失败: ${e.message}`, duration: 2500 }))
        .finally(() => setSourceLoading(false))
    }
  })

  const saveCfg = async (next: any) => {
    setSaving(true)
    try {
      const clean = {
        limits: next.limits || {},
        budgets: next.budgets || {},
        cookies: next.cookies || {},
        pluginConfig: next.pluginConfig || {},
        disabledPlugins: next.disabledPlugins || [],
      }
      await window.api.mafw.config.set("usage", clean)
      window.dispatchEvent(new CustomEvent('mafw:usage-config-saved'))
      showToastV2({ description: "用量配置已保存", duration: 2000 })
      await refreshAll()
    } catch (err: any) {
      showToastV2({ description: `保存失败: ${err.message}`, duration: 3000 })
    }
    setSaving(false)
  }

  const mutateCfg = (mut: (draft: any) => void) => {
    const next = JSON.parse(JSON.stringify(cfg()))
    mut(next)
    setCfg(next)
    return next
  }

  const setBudget = (name: string, v: string) => mutateCfg(d => {
    d.budgets = d.budgets || {}
    if (v === "") delete d.budgets[name]
    else d.budgets[name] = parseFloat(v) || 0
  })

  const setLimit = (name: string, win: string, v: string) => mutateCfg(d => {
    d.limits = d.limits || {}
    d.limits[name] = d.limits[name] || {}
    d.limits[name][win] = v === "" ? 0 : parseFloat(v) || 0
  })

  const setCookie = (name: string, v: string) => mutateCfg(d => {
    d.cookies = d.cookies || {}
    if (v === "") delete d.cookies[name]
    else d.cookies[name] = v
  })

  const toggleDisabled = async (name: string, enabled: boolean) => {
    const next = mutateCfg(d => {
      const list: string[] = d.disabledPlugins || []
      d.disabledPlugins = enabled ? list.filter(n => n !== name) : [...new Set([...list, name])]
    })
    await saveCfg(next)
  }

  const saveSchemaDraft = async (name: string) => {
    const next = mutateCfg(d => {
      d.pluginConfig = d.pluginConfig || {}
      d.pluginConfig[name] = schemaDraft()
    })
    await saveCfg(next)
  }

  const saveSource = async (name: string) => {
    if (source() === null) return
    try {
      const r = await window.api.mafw.sessions.usagePluginSourceSave(name, source()!)
      if (r?.ok) {
        showToastV2({ description: "源码已保存，插件已热加载", duration: 2000 })
        await loadPlugins()
      } else {
        showToastV2({ description: r?.error || "保存失败", duration: 3000 })
      }
    } catch (e: any) {
      showToastV2({ description: `保存失败: ${e.message}`, duration: 3000 })
    }
  }

  const runTest = async (name: string) => {
    setTestResult("运行中…")
    try {
      const r = await window.api.mafw.sessions.usagePluginTest(name)
      setTestResult(JSON.stringify(r, null, 2))
    } catch (e: any) {
      setTestResult(`测试失败: ${e.message}`)
    }
  }

  const deletePlugin = async (name: string) => {
    try {
      const r = await window.api.mafw.sessions.usagePluginDelete(name)
      if (r?.ok) {
        showToastV2({ description: `插件 ${name} 已删除`, duration: 2000 })
        setSelected(null)
        await refreshAll()
      } else {
        showToastV2({ description: r?.error || "删除失败", duration: 3000 })
      }
    } catch (e: any) {
      showToastV2({ description: `删除失败: ${e.message}`, duration: 3000 })
    }
    setConfirmDelete(false)
  }

  const cloneBuiltin = async (sourceName: string) => {
    try {
      const r = await window.api.mafw.sessions.usagePluginsCreate({ template: "clone-builtin", values: { sourceName } })
      if (r?.ok) {
        showToastV2({ description: `已克隆 ${sourceName}，可自由编辑（覆盖内置）`, duration: 2500 })
        await refreshAll()
      } else {
        showToastV2({ description: r?.error || "克隆失败", duration: 3000 })
      }
    } catch (e: any) {
      showToastV2({ description: `克隆失败: ${e.message}`, duration: 3000 })
    }
  }

  const createLocalPlugin = async (name: string, displayName: string) => {
    try {
      const r = await window.api.mafw.sessions.usagePluginsCreate({ template: "local-stats", values: { name, displayName } })
      if (r?.ok) {
        showToastV2({ description: `已创建本地统计插件 ${name}`, duration: 2500 })
        await refreshAll()
      } else {
        showToastV2({ description: r?.error || "创建失败", duration: 3000 })
      }
    } catch (e: any) {
      showToastV2({ description: `创建失败: ${e.message}`, duration: 3000 })
    }
  }

  const startWizard = () => {
    setWizardStep("pick")
    setWizardTemplate(null)
    setWizardValues({})
  }

  const pickTemplate = (t: UsageTemplate) => {
    setWizardTemplate(t)
    const values: Record<string, any> = {}
    for (const f of t.fields) {
      if (f.type === 'select' && f.key === 'sourceName') values[f.key] = pluginsData()?.builtins?.[0] ?? ''
      else if (f.default !== undefined) values[f.key] = f.default
      else values[f.key] = f.type === 'number' ? '' : ''
    }
    setWizardValues(values)
    setWizardStep("form")
  }

  const submitWizard = async () => {
    const t = wizardTemplate()
    if (!t) return
    try {
      const r = await window.api.mafw.sessions.usagePluginsCreate({ template: t.id, values: wizardValues() })
      if (r?.ok) {
        showToastV2({ description: `插件 ${r.name} 已创建`, duration: 2000 })
        setWizardStep("closed")
        await refreshAll()
        if (r.name) setSelected(`${r.name}.js`)
      } else {
        showToastV2({ description: r?.error || "创建失败", duration: 3500 })
      }
    } catch (e: any) {
      showToastV2({ description: `创建失败: ${e.message}`, duration: 3500 })
    }
  }

  return (
    <div class="mafw-usage-wb">
      <div class="mafw-usage-wb-main">
      <div class="mafw-config-section-desc">
        每个 provider 一张卡片：点开配置预算 / 限额 / Cookie；用量插件支持模板生成与在线编辑。
      </div>
      <Show when={loading()} fallback={
        <div class="mafw-usage-wb-cards">
          <For each={cards()}>
            {(c) => (
              <div class="mafw-usage-wb-card" classList={{ selected: selected() === c.key, disabled: c.status === 'disabled' }} onClick={() => setSelected(c.key)}>
                <div class="mafw-usage-wb-card-head">
                  <span class="mafw-usage-wb-card-name">{c.displayName}</span>
                  <span class="mafw-usage-wb-badge">{c.badge}</span>
                </div>
                <div class="mafw-usage-wb-card-sub">
                  <span class={`mafw-usage-wb-dot ${c.status}`}>{badgeText(c)}</span>
                  <span class="mafw-usage-wb-summary">{c.summary || '—'}</span>
                </div>
              </div>
            )}
          </For>
          <div class="mafw-usage-wb-card add" onClick={startWizard}>
            <div class="mafw-usage-wb-card-name">＋ 新建插件</div>
            <div class="mafw-usage-wb-card-sub"><span class="mafw-usage-wb-summary">模板生成或自定义</span></div>
          </div>
        </div>
      }>
        <div class="mafw-config-inline-loading"><LoaderV2 width={14} height={14} /> 加载中…</div>
      </Show>

      <Show when={wizardStep() !== "closed"}>
        <div class="mafw-usage-wb-wizard">
          <div class="mafw-usage-wb-wizard-head">
            <span>{wizardStep() === "pick" ? "选择模板" : `模板：${wizardTemplate()?.label}`}</span>
            <ButtonV2 variant="ghost" size="small" onClick={() => setWizardStep("closed")}>✕</ButtonV2>
          </div>
          <Show when={wizardStep() === "pick"} fallback={
            <div class="mafw-usage-wb-wizard-body">
              <For each={wizardTemplate()?.fields ?? []}>
                {(f) => (
                  <div class="mafw-usage-wb-row">
                    <label>{f.label}{f.required && <span class="mafw-usage-wb-req"> *</span>}</label>
                    <Show when={f.type === 'select'} fallback={
                      <TextInputV2
                        value={String(wizardValues()[f.key] ?? "")}
                        onInput={e => setWizardValues(v => ({ ...v, [f.key]: e.currentTarget.value }))}
                        placeholder={f.placeholder}
                        style={{ width: "100%" }}
                      />
                    }>
                      <SelectV2
                        options={f.key === 'sourceName' ? (pluginsData()?.builtins ?? []) : (f.options ?? [])}
                        current={wizardValues()[f.key] ?? ''}
                        value={(x: string) => x}
                        label={(x: string) => x}
                        onSelect={(v) => { if (v != null) setWizardValues(vals => ({ ...vals, [f.key]: v })) }}
                        placeholder={f.placeholder}
                      />
                    </Show>
                    <Show when={f.hint}><span class="mafw-config-hint">{f.hint}</span></Show>
                  </div>
                )}
              </For>
              <div class="mafw-usage-wb-btnrow">
                <ButtonV2 variant="contrast" size="small" onClick={submitWizard}>创建</ButtonV2>
                <ButtonV2 variant="ghost" size="small" onClick={() => setWizardStep("pick")}>上一步</ButtonV2>
              </div>
            </div>
          }>
            <div class="mafw-usage-wb-wizard-body">
              <For each={pluginsData()?.templates ?? []}>
                {(t) => (
                  <div class="mafw-usage-wb-tpl" onClick={() => pickTemplate(t)}>
                    <div class="mafw-usage-wb-card-name">{t.label}</div>
                    <div class="mafw-usage-wb-card-sub"><span class="mafw-usage-wb-summary">{t.description}</span></div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>

      </div>

      <Show when={selectedCard()}>
        {(card) => (
          <div class="mafw-usage-wb-drawer">
            <div class="mafw-usage-wb-drawer-head">
              <div>
                <div class="mafw-usage-wb-card-name">{card().displayName}</div>
                <div class="mafw-usage-wb-card-sub">
                  <span class="mafw-usage-wb-badge">{card().badge}</span>
                  <span class="mafw-usage-wb-badge" classList={{ ok: card().status === 'ok', error: card().status === 'error', disabled: card().status === 'disabled' }}>{badgeText(card()) || '运行中'}</span>
                  <span class="mafw-config-hint">{card().name}</span>
                </div>
              </div>
              <ButtonV2 variant="ghost" size="small" onClick={() => setSelected(null)} aria-label="关闭">✕</ButtonV2>
            </div>

            <Show when={card().error}>
              <div class="mafw-usage-wb-error">{card().error}</div>
            </Show>

            <Show when={card().windows && card().windows!.length > 0}>
              <div class="mafw-usage-wb-section">
                <span class="mafw-usage-wb-sec-title">
                  {card().kind === "plan" ? "窗口用量" : card().kind === "balance" ? "余额用量" : "用量概览"}
                </span>
                <For each={card().windows}>
                  {(w: any) => { const v = windowView(card(), w, cfg().budgets?.[card().name]); return (
                    <div class="mafw-usage-wb-ovw">
                      <div class="mafw-usage-wb-ovw-head">
                        <span class="mafw-usage-wb-ovw-label">{v.label}</span>
                        <span class="mafw-usage-wb-ovw-val">{v.value}</span>
                      </div>
                      <Show when={v.bar !== undefined}>
                        <div class="mafw-usage-wb-ovw-bar">
                          <div class="mafw-usage-wb-ovw-fill" style={{ width: `${Math.min(v.bar!, 100)}%` }} />
                        </div>
                      </Show>
                      <Show when={v.meta.length > 0}>
                        <div class="mafw-usage-wb-ovw-meta">
                          <For each={v.meta}>{(m) => <span>{m}</span>}</For>
                        </div>
                      </Show>
                    </div>
                  )}}
                </For>
              </div>
            </Show>

            <Show when={card().implicit}>
              <div class="mafw-usage-wb-section">
                <span class="mafw-usage-wb-sec-title">创建插件</span>
                <div class="mafw-config-hint">
                  此 provider 尚无插件文件。自动创建本地统计占位插件后即可统一管理（启用/禁用、源码升级为余额查询）。
                </div>
                <div class="mafw-usage-wb-btnrow">
                  <ButtonV2 variant="contrast" size="small" onClick={() => createLocalPlugin(card().name, card().displayName)}>自动创建本地统计插件</ButtonV2>
                </div>
              </div>
            </Show>

            <div class="mafw-usage-wb-section">
              <span class="mafw-usage-wb-sec-title">配额配置</span>
              <div class="mafw-usage-wb-field">
                <label class="mafw-config-label">预算（$，留空取消）</label>
                <TextInputV2
                  type="number"
                  value={cfg().budgets?.[card().name] !== undefined ? String(cfg().budgets[card().name]) : ""}
                  onInput={e => setBudget(card().name, e.currentTarget.value)}
                  placeholder="留空删除"
                />
              </div>
              <div class="mafw-usage-wb-field">
                <label class="mafw-config-label">Token 限额（$）</label>
                <div class="mafw-usage-wb-row3">
                  <For each={["5h", "7d", "month"]}>
                    {(win) => (
                      <TextInputV2
                        type="number"
                        value={cfg().limits?.[card().name]?.[win] !== undefined ? String(cfg().limits[card().name][win]) : ""}
                        onInput={e => setLimit(card().name, win, e.currentTarget.value)}
                        placeholder={win}
                      />
                    )}
                  </For>
                </div>
              </div>
              <div class="mafw-usage-wb-field">
                <label class="mafw-config-label">Cookie（{card().name}）</label>
                <TextInputV2
                  value={cfg().cookies?.[card().name] ?? ""}
                  onInput={e => setCookie(card().name, e.currentTarget.value)}
                  placeholder="平台 session cookie（可选）"
                />
              </div>
              <div class="mafw-usage-wb-btnrow">
                <ButtonV2 variant="contrast" size="small" onClick={() => saveCfg(cfg())} disabled={saving()}>
                  {saving() ? "保存中…" : "保存配置"}
                </ButtonV2>
              </div>
            </div>

            <Show when={card().origin !== "local"}>
              <div class="mafw-usage-wb-section">
                <span class="mafw-usage-wb-sec-title">插件操作</span>
                <div class="mafw-usage-wb-row">
                  <SwitchV2 checked={card().status !== "disabled"} onChange={v => toggleDisabled(card().name, v)}>启用</SwitchV2>
                  <ButtonV2 variant="ghost" size="small" onClick={() => runTest(card().name)}>▶ 测试运行</ButtonV2>
                  <ButtonV2 variant="ghost" size="small" onClick={() => window.api.mafw.sessions.usagePluginsReload().then(() => refreshAll())}>🔄 重载</ButtonV2>
                  <Show when={card().origin === "user" || card().origin === "override"}>
                    <Show when={!confirmDelete()} fallback={
                      <>
                        <ButtonV2 variant="contrast" size="small" onClick={() => deletePlugin(card().name)}>确认删除</ButtonV2>
                        <ButtonV2 variant="ghost" size="small" onClick={() => setConfirmDelete(false)}>取消</ButtonV2>
                      </>
                    }>
                      <ButtonV2 variant="ghost" size="small" onClick={() => setConfirmDelete(true)}>{card().origin === "override" ? "还原内置" : "删除"}</ButtonV2>
                    </Show>
                  </Show>
                </div>
                <Show when={testResult()}>
                  <pre class="mafw-usage-wb-test">{testResult()}</pre>
                </Show>
              </div>

              <div class="mafw-usage-wb-section">
                <span class="mafw-usage-wb-sec-title">源码</span>
                <Show when={sourceLoading()} fallback={
                  <Show when={source() !== null} fallback={
                    <div class="mafw-config-hint">内置插件源码只读。克隆到用户目录后可编辑。</div>
                  }>
                    <TextareaV2
                      value={source() ?? ""}
                      onInput={e => setSource(e.currentTarget.value)}
                      rows={10}
                      class="mafw-usage-wb-code"
                    />
                  </Show>
                }>
                  <div class="mafw-config-inline-loading"><LoaderV2 width={14} height={14} /> 读取中…</div>
                </Show>
                <div class="mafw-usage-wb-btnrow">
                  <Show when={source() !== null}>
                    <ButtonV2 variant="contrast" size="small" onClick={() => saveSource(card().name)}>保存源码</ButtonV2>
                  </Show>
                  <Show when={card().origin === "builtin"}>
                    <ButtonV2 variant="ghost" size="small" onClick={() => cloneBuiltin(card().name)}>克隆以编辑</ButtonV2>
                  </Show>
                </div>
              </div>

              <Show when={card().configSchema && card().configSchema!.length > 0}>
                <div class="mafw-usage-wb-section">
                  <span class="mafw-usage-wb-sec-title">插件参数（pluginConfig）</span>
                  <For each={card().configSchema}>
                    {(f) => (
                      <div class="mafw-usage-wb-row">
                        <label>{f.label}</label>
                        <TextInputV2
                          type={f.type === "number" ? "number" : "text"}
                          value={schemaDraft()[f.key] !== undefined && schemaDraft()[f.key] !== null ? String(schemaDraft()[f.key]) : (f.default !== undefined ? String(f.default) : "")}
                          onInput={e => setSchemaDraft(v => ({ ...v, [f.key]: f.type === "number" ? (parseFloat(e.currentTarget.value) || 0) : e.currentTarget.value }))}
                        />
                      </div>
                    )}
                  </For>
                  <div class="mafw-usage-wb-btnrow">
                    <ButtonV2 variant="contrast" size="small" onClick={() => saveSchemaDraft(card().name)}>保存参数</ButtonV2>
                  </div>
                </div>
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
