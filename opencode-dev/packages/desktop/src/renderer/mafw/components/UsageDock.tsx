// @ts-nocheck
import { createSignal, createEffect, createMemo, Show, For, onCleanup } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"

const fmt = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

const fmtCost = (c: number): string => {
  if (c >= 1) return `$${c.toFixed(2)}`
  if (c >= 0.01) return `$${c.toFixed(3)}`
  return `$${c.toFixed(4)}`
}

const asciiBar = (pct: number, width = 20): string => {
  const filled = Math.round((Math.min(pct, 100) / 100) * width)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled)
}

const fmtTime = (ms: number): string => {
  if (ms <= 0) return '<1h'
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}d${hours % 24}h`
  }
  return hours > 0 ? `${hours}h${minutes}m` : `${minutes}m`
}

const pacingIcon = (pacing?: string): string => {
  if (pacing === 'ahead') return '\u2191'
  if (pacing === 'under') return '\u2193'
  return '\u2192'
}

const severityClass = (severity: string): string => {
  if (severity === 'critical') return 'mafw-usage-severity-critical'
  if (severity === 'high') return 'mafw-usage-severity-high'
  if (severity === 'mid') return 'mafw-usage-severity-mid'
  return 'mafw-usage-severity-low'
}

type TokenSummary = {
  totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  totalCost: number
  turnCount: number
  sessionCount?: number
  avgTokensPerTurn?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

type StoreShape = { message: Record<string, any[]> }

function TokenGrid(props: { data: TokenSummary; showSessions?: boolean }) {
  const t = () => props.data.totalTokens
  const total = () => t().input + t().output + t().reasoning + t().cache.read + t().cache.write
  return (
    <div class="mafw-usage-grid">
      <div class="mafw-usage-row">
        <span class="mafw-usage-dot mafw-usage-dot-input" />
        <span class="mafw-usage-label">输入</span>
        <span class="mafw-usage-value">{fmt(t().input)}</span>
      </div>
      <div class="mafw-usage-row">
        <span class="mafw-usage-dot mafw-usage-dot-output" />
        <span class="mafw-usage-label">输出</span>
        <span class="mafw-usage-value">{fmt(t().output)}</span>
      </div>
      <Show when={t().reasoning > 0}>
        <div class="mafw-usage-row">
          <span class="mafw-usage-dot mafw-usage-dot-reasoning" />
          <span class="mafw-usage-label">推理</span>
          <span class="mafw-usage-value">{fmt(t().reasoning)}</span>
        </div>
      </Show>
      <div class="mafw-usage-row">
        <span class="mafw-usage-dot mafw-usage-dot-cache-read" />
        <span class="mafw-usage-label">缓存读取</span>
        <span class="mafw-usage-value">{fmt(t().cache.read)}</span>
      </div>
      <Show when={t().cache.write > 0}>
        <div class="mafw-usage-row">
          <span class="mafw-usage-dot mafw-usage-dot-cache-write" />
          <span class="mafw-usage-label">缓存写入</span>
          <span class="mafw-usage-value">{fmt(t().cache.write)}</span>
        </div>
      </Show>
      <div class="mafw-usage-total">
        <span>总计</span>
        <span>{fmt(total())}</span>
      </div>
      <div class="mafw-usage-meta">
        <span>{props.data.turnCount} 回合{props.showSessions && props.data.sessionCount ? ` · ${props.data.sessionCount} 会话` : ''}</span>
        <Show when={props.data.totalCost > 0}>
          <span class="mafw-usage-cost">{fmtCost(props.data.totalCost)}</span>
        </Show>
      </div>
    </div>
  )
}

function ProviderSection(props: { provider: any }) {
  const p = () => props.provider
  return (
    <div class={`mafw-usage-provider ${severityClass(p().severity)}`}>
      <div class="mafw-usage-provider-header">
        <span class="mafw-usage-provider-name">{p().name}</span>
        <Show when={p().plan}>
          <span class="mafw-usage-provider-plan">({p().plan})</span>
        </Show>
      </div>
      <For each={p().windows}>
        {(w: any) => (
          <Show when={w.limit > 0} fallback={
            <div class="mafw-usage-window mafw-usage-window-no-limit">
              <span class="mafw-usage-window-label">{w.window}</span>
              <Show when={w.remaining !== undefined} fallback={
                <>
                  <span class="mafw-usage-window-spent">${w.used}</span>
                  <span class="mafw-usage-window-hint">spent</span>
                </>
              }>
                <span class="mafw-usage-window-spent">${w.remaining}</span>
                <span class="mafw-usage-window-hint">余额</span>
              </Show>
            </div>
          }>
            <div class="mafw-usage-window">
              <span class="mafw-usage-window-label">{w.window}</span>
              <span class="mafw-usage-window-bar">{asciiBar(w.pct)}</span>
              <span class="mafw-usage-window-pct">{w.pct}%</span>
              <Show when={w.unit === 'pct'} fallback={
                <span class="mafw-usage-window-detail">
                  {w.unit === '$' ? `$${w.used}/${w.limit}` : `${w.used}/${w.limit}`}
                </span>
              }>
                <span class="mafw-usage-window-detail">已用 {w.pct}%</span>
              </Show>
              <Show when={w.remaining !== undefined}>
                <span class="mafw-usage-window-remaining">剩${w.remaining}</span>
              </Show>
              <Show when={w.resetAt}>
                <span class="mafw-usage-window-reset">{fmtTime(w.resetAt - Date.now())}</span>
              </Show>
              <Show when={w.pacing}>
                <span class="mafw-usage-window-pacing">{pacingIcon(w.pacing)}</span>
              </Show>
              <Show when={w.projected !== undefined && w.projected > w.pct}>
                <span class="mafw-usage-window-projected">→{w.projected}%</span>
              </Show>
            </div>
          </Show>
        )}
      </For>
    </div>
  )
}

function UsageConfigEditor(props: { onSaved: () => void }) {
  const [config, setConfig] = createSignal<any>(null)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)

  const load = async () => {
    setLoading(true)
    try {
      const c = await window.api.mafw.config.get("usage")
      setConfig(c || { limits: {}, budgets: {} })
    } catch (e: any) {
      console.warn("[UsageConfig] load failed:", e?.message)
      setConfig({ limits: {}, budgets: {} })
    }
    setLoading(false)
  }

  createEffect(() => { load() })

  const limits = () => config()?.limits || {}
  const budgets = () => config()?.budgets || {}
  const cookies = () => config()?.cookies || {}

  const setCookie = (name: string, v: string) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.cookies = next.cookies || {}
      if (v === "") delete next.cookies[name]
      else next.cookies[name] = v
      return next
    })
  }

  const addCookie = () => {
    const name = prompt("Cookie 名称 (如 commandcode):")
    if (!name || !name.trim()) return
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.cookies = next.cookies || {}
      if (next.cookies[name.trim()] === undefined) next.cookies[name.trim()] = ""
      return next
    })
  }

  const setLimitWindow = (provider: string, window: string, v: string) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.limits = next.limits || {}
      next.limits[provider] = next.limits[provider] || {}
      next.limits[provider][window] = v === "" ? 0 : parseFloat(v) || 0
      return next
    })
  }

  const setBudget = (provider: string, v: string) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.budgets = next.budgets || {}
      if (v === "") delete next.budgets[provider]
      else next.budgets[provider] = parseFloat(v) || 0
      return next
    })
  }

  const addBudget = () => {
    const name = prompt("Provider 名称 (如 xiaomi):")
    if (!name || !name.trim()) return
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.budgets = next.budgets || {}
      if (next.budgets[name.trim()] === undefined) next.budgets[name.trim()] = 0
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      const c = config()
      const clean = {
        limits: c.limits || {},
        budgets: c.budgets || {},
        cookies: c.cookies || {},
      }
      await window.api.mafw.config.set("usage", clean)
      showToastV2({ description: "用量配置已保存", duration: 2000 })
      props.onSaved()
    } catch (e: any) {
      showToastV2({ description: `保存失败: ${e.message}`, duration: 3000 })
    }
    setSaving(false)
  }

  return (
    <div class="mafw-usage-config">
      {loading() ? (
        <div class="mafw-usage-config-hint">加载中...</div>
      ) : (
        <>
          <div class="mafw-usage-config-title">Token Plan 限额 (5h/7d/month)</div>
          <For each={Object.keys(limits())}>
            {(provider: string) => (
              <div class="mafw-usage-config-row">
                <span class="mafw-usage-config-name">{provider}</span>
                <For each={Object.keys(limits()[provider] || {})}>
                  {(window: string) => (
                    <div class="mafw-usage-config-field">
                      <label>{window}</label>
                      <TextInputV2
                        type="number"
                        value={String(limits()[provider][window] ?? 0)}
                        onInput={e => setLimitWindow(provider, window, e.currentTarget.value)}
                        style={{ width: 60 }}
                      />
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
          <Show when={Object.keys(limits()).length === 0}>
            <div class="mafw-usage-config-hint">无 token plan 配置</div>
          </Show>

          <div class="mafw-usage-config-title">API 余额预算 (budget)</div>
          <For each={Object.keys(budgets())}>
            {(provider: string) => (
              <div class="mafw-usage-config-row">
                <span class="mafw-usage-config-name">{provider}</span>
                <TextInputV2
                  type="number"
                  value={String(budgets()[provider] ?? "")}
                  onInput={e => setBudget(provider, e.currentTarget.value)}
                  style={{ width: 80 }}
                  placeholder="留空删除"
                />
              </div>
            )}
          </For>
          <div class="mafw-usage-config-row">
            <ButtonV2 variant="ghost" size="small" onClick={addBudget}>+ 添加 provider 预算</ButtonV2>
          </div>

          <div class="mafw-usage-config-title">平台 Cookie (用量查询)</div>
          <Show when={cookies()['commandcode'] !== undefined}>
            <div class="mafw-usage-config-row">
              <span class="mafw-usage-config-name">commandcode</span>
              <TextInputV2
                value={cookies()['commandcode'] ?? ""}
                onInput={e => setCookie('commandcode', e.currentTarget.value)}
                style={{ width: "100%" }}
                placeholder="commandcode.ai 登录后的 session cookie，留空删除"
              />
            </div>
          </Show>
          <For each={Object.keys(cookies()).filter(k => k !== 'commandcode')}>
            {(name: string) => (
              <div class="mafw-usage-config-row">
                <span class="mafw-usage-config-name">{name}</span>
                <TextInputV2
                  value={cookies()[name] ?? ""}
                  onInput={e => setCookie(name, e.currentTarget.value)}
                  style={{ width: "100%" }}
                  placeholder="session cookie，留空删除"
                />
              </div>
            )}
          </For>
          <div class="mafw-usage-config-row">
            <ButtonV2 variant="ghost" size="small" onClick={addCookie}>+ 添加平台 cookie</ButtonV2>
          </div>

          <div class="mafw-usage-config-actions">
            <ButtonV2 variant="contrast" size="small" onClick={save} disabled={saving()}>
              {saving() ? "保存中..." : "保存配置"}
            </ButtonV2>
          </div>
        </>
      )}
    </div>
  )
}

export function UsageDock(props: {
  sessionID: string
  projectID?: string | null
  store: StoreShape
  model: () => { providerID: string; modelID: string } | null
  modelGroups: () => { provider: string; providerID: string; models: { id: string; contextK?: number }[] }[]
}) {
  const [apiData, setApiData] = createSignal<{
    summary: { session: TokenSummary | null; project: TokenSummary | null; global: TokenSummary | null }
    providers: any[]
    updatedAt: number
  } | null>(null)
  const [loading, setLoading] = createSignal(false)

  const fetchSummary = async () => {
    const sid = props.sessionID
    if (!sid) return
    setLoading(true)
    try {
      const r = await window.api.mafw.sessions.usage(sid, props.projectID || undefined)
      setApiData(r)
    } catch (e: any) {
      console.warn("[UsageDock] fetch failed:", e?.message)
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    const sid = props.sessionID
    if (sid) fetchSummary()
  })

  const summaryTimer = setInterval(fetchSummary, 15000)
  onCleanup(() => clearInterval(summaryTimer))

  const contextInfo = createMemo(() => {
    const sid = props.sessionID
    if (!sid) return null
    const msgs = props.store.message[sid] || []
    let lastInput = 0
    for (const m of msgs) {
      if (m.role !== "assistant" || !m.tokens) continue
      lastInput = (m.tokens.input || 0) + (m.tokens.cache?.read || 0)
    }
    const m = props.model()
    let contextWindow = 0
    if (m) {
      for (const g of props.modelGroups()) {
        if (g.providerID === m.providerID) {
          const entry = g.models.find((em: any) => em.id === m.modelID)
          if (entry?.contextK) contextWindow = entry.contextK * 1000
          break
        }
      }
    }
    const pct = contextWindow > 0 ? Math.round((lastInput / contextWindow) * 100) : 0
    return { lastInput, contextWindow, pct }
  })

  const hasData = () => {
    const d = apiData()
    if (!d) return false
    if (d.providers && d.providers.length > 0) return true
    return d.summary?.session?.turnCount || d.summary?.project?.turnCount || d.summary?.global?.turnCount
  }

  const [showConfig, setShowConfig] = createSignal(false)

  return (
    <div class="mafw-usage-dock">
      <div class="mafw-usage-dock-toolbar">
        <span class="mafw-usage-dock-title">用量</span>
        <ButtonV2
          variant={showConfig() ? "contrast" : "ghost"}
          size="small"
          onClick={() => setShowConfig(!showConfig())}
        >
          <Icon name="settings-gear" size="small" />
          配置
        </ButtonV2>
      </div>

      <Show when={showConfig()}>
        <UsageConfigEditor onSaved={() => fetchSummary()} />
      </Show>

      <Show when={hasData()} fallback={
        <div class="mafw-usage-empty">
          <div class="mafw-usage-empty-icon">📈</div>
          <div class="mafw-usage-empty-text">暂无用量数据</div>
          <div class="mafw-usage-empty-hint">发送消息后此处显示 token 用量</div>
        </div>
      }>
        <Show when={contextInfo() && contextInfo()!.lastInput > 0}>
          <div class="mafw-usage-section">
            <div class="mafw-usage-section-title">上下文窗口</div>
            <Show when={contextInfo()!.contextWindow > 0} fallback={
              <div class="mafw-usage-ctx-fallback">
                <span class="mafw-usage-ctx-value">{fmt(contextInfo()!.lastInput || 0)}</span>
                <span class="mafw-usage-ctx-label">当前上下文 tokens</span>
              </div>
            }>
              <div class="mafw-usage-ctx-bar-wrap">
                <div class="mafw-usage-ctx-bar">
                  <div
                    class="mafw-usage-ctx-fill"
                    classList={{
                      "mafw-usage-ctx-warn": contextInfo()!.pct >= 70,
                      "mafw-usage-ctx-danger": contextInfo()!.pct >= 90,
                    }}
                    style={{ width: `${Math.min(contextInfo()!.pct, 100)}%` }}
                  />
                </div>
                <div class="mafw-usage-ctx-labels">
                  <span class="mafw-usage-ctx-pct">{contextInfo()!.pct}%</span>
                  <span class="mafw-usage-ctx-detail">{fmt(contextInfo()!.lastInput || 0)} / {fmt(contextInfo()!.contextWindow)}</span>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={apiData()?.providers && apiData()!.providers.length > 0}>
          <div class="mafw-usage-section">
            <div class="mafw-usage-section-title">配额窗口</div>
            <For each={apiData()!.providers}>
              {(provider: any) => <ProviderSection provider={provider} />}
            </For>
          </div>
        </Show>

        <Show when={apiData()?.summary?.session?.turnCount}>
          <div class="mafw-usage-section">
            <div class="mafw-usage-section-title">当前会话</div>
            <TokenGrid data={apiData()!.summary!.session!} />
          </div>
        </Show>

        <Show when={apiData()?.summary?.project?.turnCount}>
          <div class="mafw-usage-section">
            <div class="mafw-usage-section-title">当前项目</div>
            <TokenGrid data={apiData()!.summary!.project!} showSessions />
          </div>
        </Show>

        <Show when={apiData()?.summary?.global?.turnCount}>
          <div class="mafw-usage-section">
            <div class="mafw-usage-section-title">系统总计</div>
            <TokenGrid data={apiData()!.summary!.global!} showSessions />
          </div>
        </Show>
      </Show>
    </div>
  )
}
