// @ts-nocheck
import { createSignal, createEffect, createMemo, Show, For, onCleanup } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { showToastV2 } from "@opencode-ai/ui/v2/toast-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

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

const roleLabels: Record<string, string> = {
  'turn-compress': '回合压缩',
  'index-scan': '索引扫描',
  'manager': '管理器',
  'reflect': '反思',
}
const roleLabel = (role: string): string => roleLabels[role] || role

const fmtRoleTokens = (t: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }): string => {
  const total = t.input + t.output + t.reasoning + t.cache.read + t.cache.write
  return fmt(total)
}

const roleColors: Record<string, string> = {
  'turn-compress': '#8b5cf6',
  'index-scan': '#06b6d4',
  'manager': '#f59e0b',
  'reflect': '#ec4899',
}

const tokenColors = {
  input: '#3b82f6',
  output: '#10b981',
  reasoning: '#8b5cf6',
  cacheRead: '#f59e0b',
  cacheWrite: '#ef4444',
} as const

function TokenStackBar(props: { data: TokenSummary['totalTokens'] }) {
  const t = () => props.data
  const total = () => t().input + t().output + t().reasoning + t().cache.read + t().cache.write
  const pct = (v: number) => total() > 0 ? (v / total()) * 100 : 0
  return (
    <div class="mafw-usage-stack-bar">
      <Show when={pct(t().input) > 0}>
        <div class="mafw-usage-stack-seg" style={{ width: `${pct(t().input)}%`, background: tokenColors.input }} />
      </Show>
      <Show when={pct(t().output) > 0}>
        <div class="mafw-usage-stack-seg" style={{ width: `${pct(t().output)}%`, background: tokenColors.output }} />
      </Show>
      <Show when={pct(t().reasoning) > 0}>
        <div class="mafw-usage-stack-seg" style={{ width: `${pct(t().reasoning)}%`, background: tokenColors.reasoning }} />
      </Show>
      <Show when={pct(t().cache.read) > 0}>
        <div class="mafw-usage-stack-seg" style={{ width: `${pct(t().cache.read)}%`, background: tokenColors.cacheRead }} />
      </Show>
      <Show when={pct(t().cache.write) > 0}>
        <div class="mafw-usage-stack-seg" style={{ width: `${pct(t().cache.write)}%`, background: tokenColors.cacheWrite }} />
      </Show>
    </div>
  )
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

function TokenGrid(props: { data: TokenSummary }) {
  const t = () => props.data.totalTokens
  const total = () => t().input + t().output + t().reasoning + t().cache.read + t().cache.write
  const pctOf = (v: number) => total() > 0 ? Math.round((v / total()) * 100) : 0
  return (
    <div class="mafw-usage-grid">
      <TokenStackBar data={t()} />
      <div class="mafw-usage-row">
        <span class="mafw-usage-dot mafw-usage-dot-input" />
        <span class="mafw-usage-label">输入</span>
        <span class="mafw-usage-pct">{pctOf(t().input)}%</span>
        <span class="mafw-usage-value">{fmt(t().input)}</span>
      </div>
      <div class="mafw-usage-row">
        <span class="mafw-usage-dot mafw-usage-dot-output" />
        <span class="mafw-usage-label">输出</span>
        <span class="mafw-usage-pct">{pctOf(t().output)}%</span>
        <span class="mafw-usage-value">{fmt(t().output)}</span>
      </div>
      <Show when={t().reasoning > 0}>
        <div class="mafw-usage-row">
          <span class="mafw-usage-dot mafw-usage-dot-reasoning" />
          <span class="mafw-usage-label">推理</span>
          <span class="mafw-usage-pct">{pctOf(t().reasoning)}%</span>
          <span class="mafw-usage-value">{fmt(t().reasoning)}</span>
        </div>
      </Show>
      <div class="mafw-usage-row">
        <span class="mafw-usage-dot mafw-usage-dot-cache-read" />
        <span class="mafw-usage-label">缓存读取</span>
        <span class="mafw-usage-pct">{pctOf(t().cache.read)}%</span>
        <span class="mafw-usage-value">{fmt(t().cache.read)}</span>
      </div>
      <Show when={t().cache.write > 0}>
        <div class="mafw-usage-row">
          <span class="mafw-usage-dot mafw-usage-dot-cache-write" />
          <span class="mafw-usage-label">缓存写入</span>
          <span class="mafw-usage-pct">{pctOf(t().cache.write)}%</span>
          <span class="mafw-usage-value">{fmt(t().cache.write)}</span>
        </div>
      </Show>
      <div class="mafw-usage-total">
        <span>总计</span>
        <span>{fmt(total())}</span>
      </div>
    </div>
  )
}

// 紧凑统计行：label + 总 token + 成本 + 回合，点击展开详情
function TokenStatRow(props: {
  label: string
  color: string
  data: TokenSummary
  showSessions?: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const t = () => props.data.totalTokens
  const total = () => t().input + t().output + t().reasoning + t().cache.read + t().cache.write
  return (
    <div class="mafw-usage-stat">
      <div class="mafw-usage-stat-row" onClick={props.onToggle}>
        <span class="mafw-usage-dot" style={{ background: props.color }} />
        <span class="mafw-usage-stat-label">{props.label}</span>
        <span class="mafw-usage-stat-value">{fmt(total())}</span>
        <Show when={props.data.totalCost > 0}>
          <span class="mafw-usage-cost">{fmtCost(props.data.totalCost)}</span>
        </Show>
        <span class="mafw-usage-stat-meta">
          {props.data.turnCount} 回合{props.showSessions && props.data.sessionCount ? ` · ${props.data.sessionCount} 会话` : ''}
        </span>
        <span class={`mafw-usage-stat-chevron ${props.expanded ? 'mafw-usage-stat-chevron-open' : ''}`}>▸</span>
      </div>
      <Show when={props.expanded}>
        <div class="mafw-usage-stat-detail">
          <TokenGrid data={props.data} />
        </div>
      </Show>
    </div>
  )
}

function ProviderSection(props: { provider: any }) {
  const p = () => props.provider
  const barColor = (severity: string) => {
    if (severity === 'critical') return 'var(--danger)'
    if (severity === 'high') return '#d19a66'
    if (severity === 'mid') return 'var(--warning)'
    return 'var(--accent)'
  }
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
              <Show when={w.tokens !== undefined && w.tokens > 0} fallback={
                <Show when={w.remaining !== undefined} fallback={
                  <>
                    <span class="mafw-usage-window-spent">${w.used}</span>
                    <span class="mafw-usage-window-hint">spent</span>
                  </>
                }>
                  <span class="mafw-usage-window-spent">${w.remaining}</span>
                  <span class="mafw-usage-window-hint">余额</span>
                </Show>
              }>
                <span class="mafw-usage-window-spent">{fmt(w.tokens)}</span>
                <span class="mafw-usage-window-hint">tokens · 预计 ${w.projectedCost !== undefined ? w.projectedCost.toFixed(2) : w.used.toFixed(2)}</span>
              </Show>
            </div>
          }>
            {(() => {
              const tooltip = () => {
                const parts = [
                  w.unit === '$' ? `已用 $${w.used} / $${w.limit}` : w.unit === 'pct' ? `已用 ${w.pct}%` : `已用 ${w.used} / ${w.limit}`,
                ]
                if (w.remaining !== undefined) parts.push(`剩余 $${w.remaining}`)
                if (w.resetAt) parts.push(`重置 ${fmtTime(w.resetAt - Date.now())}`)
                if (w.projected !== undefined && w.projected > w.pct) parts.push(`预计 ${w.projected}%`)
                return parts.join(' · ')
              }
              return (
                <TooltipV2 value={tooltip()} openDelay={300}>
                  <div class="mafw-usage-window">
                    <span class="mafw-usage-window-label">{w.window}</span>
                    <div class="mafw-usage-window-progress">
                      <div class="mafw-usage-window-progress-fill" style={{ width: `${Math.min(w.pct, 100)}%`, background: barColor(p().severity) }} />
                    </div>
                    <span class="mafw-usage-window-pct">{w.pct}%</span>
                    <Show when={w.resetAt}>
                      <span class="mafw-usage-window-reset">{fmtTime(w.resetAt - Date.now())}</span>
                    </Show>
                    <Show when={w.pacing}>
                      <span class="mafw-usage-window-pacing">{pacingIcon(w.pacing)}</span>
                    </Show>
                  </div>
                </TooltipV2>
              )
            })()}
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

  const setRemoveCookie = (name: string) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      next.cookies = next.cookies || {}
      delete next.cookies[name]
      return next
    })
  }

  const [addKind, setAddKind] = createSignal<'cookie' | 'budget' | null>(null)
  const [addName, setAddName] = createSignal('')

  const commitAdd = () => {
    const name = addName().trim()
    if (!name) return
    if (addKind() === 'cookie') {
      setConfig(prev => {
        const next = JSON.parse(JSON.stringify(prev))
        next.cookies = next.cookies || {}
        if (next.cookies[name] === undefined) next.cookies[name] = ""
        return next
      })
    } else if (addKind() === 'budget') {
      setConfig(prev => {
        const next = JSON.parse(JSON.stringify(prev))
        next.budgets = next.budgets || {}
        if (next.budgets[name] === undefined) next.budgets[name] = 0
        return next
      })
    }
    setAddKind(null)
    setAddName('')
  }

  const [pluginState, setPluginState] = createSignal<any[]>([])
  const [reloading, setReloading] = createSignal(false)

  const loadPlugins = async () => {
    try {
      const res = await window.api.mafw.sessions.usagePlugins()
      setPluginState(res.plugins)
    } catch (e: any) {
      console.warn('[UsageConfig] loadPlugins failed:', e?.message)
    }
  }

  const reloadPlugins = async () => {
    setReloading(true)
    try {
      const res = await window.api.mafw.sessions.usagePluginsReload()
      setPluginState(res.plugins)
      showToastV2({ description: '插件已重载', duration: 2000 })
      props.onSaved()
    } catch (e: any) {
      showToastV2({ description: `重载失败: ${e.message}`, duration: 3000 })
    }
    setReloading(false)
  }

  createEffect(() => { loadPlugins() })

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

  const save = async () => {
    setSaving(true)
    try {
      const c = config()
      const clean = {
        limits: c.limits || {},
        budgets: c.budgets || {},
        cookies: c.cookies || {},
        pluginConfig: c.pluginConfig || {},
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
            <Show when={addKind() !== 'budget'} fallback={
              <>
                <TextInputV2
                  value={addName()}
                  onInput={e => setAddName(e.currentTarget.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitAdd()
                    if (e.key === 'Escape') { setAddKind(null); setAddName('') }
                  }}
                  style={{ width: 160 }}
                  placeholder="provider 名称"
                />
                <ButtonV2 variant="contrast" size="small" onClick={commitAdd}>确定</ButtonV2>
                <ButtonV2 variant="ghost" size="small" onClick={() => { setAddKind(null); setAddName('') }}>取消</ButtonV2>
              </>
            }>
              <ButtonV2 variant="ghost" size="small" onClick={() => { setAddKind('budget'); setAddName('') }}>+ 添加 provider 预算</ButtonV2>
            </Show>
          </div>

          <div class="mafw-usage-config-title">平台 Cookie (用量查询)</div>
          <For each={Object.keys(cookies())}>
            {(name: string) => (
              <div class="mafw-usage-config-row">
                <span class="mafw-usage-config-name">{name}</span>
                <TextInputV2
                  value={cookies()[name] ?? ""}
                  onInput={e => setCookie(name, e.currentTarget.value)}
                  style={{ width: "100%" }}
                  placeholder={`${name} 平台登录后的 session cookie，留空删除`}
                />
                <ButtonV2 variant="ghost" size="small" onClick={() => setRemoveCookie(name)} aria-label="删除 cookie">✕</ButtonV2>
              </div>
            )}
          </For>
          <Show when={Object.keys(cookies()).length === 0}>
            <div class="mafw-usage-config-hint">无平台 cookie，可点击下方添加（如 commandcode）</div>
          </Show>
          <div class="mafw-usage-config-row">
            <Show when={addKind() !== 'cookie'} fallback={
              <>
                <TextInputV2
                  value={addName()}
                  onInput={e => setAddName(e.currentTarget.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitAdd()
                    if (e.key === 'Escape') { setAddKind(null); setAddName('') }
                  }}
                  style={{ width: 160 }}
                  placeholder="cookie 名称"
                />
                <ButtonV2 variant="contrast" size="small" onClick={commitAdd}>确定</ButtonV2>
                <ButtonV2 variant="ghost" size="small" onClick={() => { setAddKind(null); setAddName('') }}>取消</ButtonV2>
              </>
            }>
              <ButtonV2 variant="ghost" size="small" onClick={() => { setAddKind('cookie'); setAddName('') }}>+ 添加平台 cookie</ButtonV2>
            </Show>
          </div>

          <div class="mafw-usage-config-title">平台插件</div>
          <Show when={pluginState().length > 0}>
            <For each={pluginState()}>
              {(p: any) => (
                <div class="mafw-usage-config-row">
                  <span class="mafw-usage-config-name">
                    {p.status === 'ok' ? '\u2705' : '\u274c'} {p.file}
                    {p.name && <span class="mafw-usage-config-hint"> ({p.name})</span>}
                    {p.overridden && <span class="mafw-usage-config-hint"> [\u8986\u76d6\u5185\u7f6e]</span>}
                  </span>
                  <Show when={p.error}>
                    <span class="mafw-usage-config-error">{p.error}</span>
                  </Show>
                </div>
              )}
            </For>
          </Show>
          <Show when={pluginState().length === 0}>
            <div class="mafw-usage-config-hint">{"\u65e0\u63d2\u4ef6"}</div>
          </Show>
          <div class="mafw-usage-config-row">
            <ButtonV2 variant="ghost" size="small" onClick={() => window.api.mafw.sessions.openUsagePluginsDir()}>
              {"\ud83d\udcc2 \u6253\u5f00\u63d2\u4ef6\u76ee\u5f55"}
            </ButtonV2>
            <ButtonV2 variant="ghost" size="small" onClick={reloadPlugins} disabled={reloading()}>
              {reloading() ? '\u91cd\u8f7d\u4e2d...' : '\ud83d\udd04 \u91cd\u65b0\u52a0\u8f7d'}
            </ButtonV2>
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
    memory: { totalTokens: TokenSummary['totalTokens']; totalCost: number; turnCount: number; sessionCount: number; byRole: Record<string, { totalTokens: TokenSummary['totalTokens']; totalCost: number; turnCount: number; sessionCount: number }> } | null
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
    if (d.memory?.turnCount) return true
    return d.summary?.session?.turnCount || d.summary?.project?.turnCount || d.summary?.global?.turnCount
  }

  const [showConfig, setShowConfig] = createSignal(false)
  const [expandedStat, setExpandedStat] = createSignal<'session' | 'project' | 'memory' | null>(null)
  const toggleStat = (key: 'session' | 'project' | 'memory') =>
    setExpandedStat(prev => (prev === key ? null : key))

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
            <TooltipV2
              value={contextInfo()!.contextWindow > 0
                ? `${fmt(contextInfo()!.lastInput || 0)} / ${fmt(contextInfo()!.contextWindow)} tokens`
                : `${fmt(contextInfo()!.lastInput || 0)} tokens（窗口大小未知）`}
              openDelay={300}
            >
              <div class="mafw-usage-ctx-row">
                <span class="mafw-usage-section-title">上下文</span>
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
                <span class="mafw-usage-ctx-pct-inline">
                  {contextInfo()!.contextWindow > 0 ? `${contextInfo()!.pct}%` : fmt(contextInfo()!.lastInput || 0)}
                </span>
              </div>
            </TooltipV2>
          </div>
        </Show>

        <Show when={
          apiData()?.summary?.session?.turnCount ||
          apiData()?.summary?.project?.turnCount ||
          apiData()?.memory?.turnCount
        }>
          <div class="mafw-usage-section">
            <div class="mafw-usage-section-title">Token 统计</div>
            <Show when={apiData()?.summary?.session?.turnCount}>
              <TokenStatRow
                label="当前会话"
                color={tokenColors.input}
                data={apiData()!.summary!.session!}
                expanded={expandedStat() === 'session'}
                onToggle={() => toggleStat('session')}
              />
            </Show>
            <Show when={apiData()?.summary?.project?.turnCount}>
              <TokenStatRow
                label="当前项目"
                color={tokenColors.output}
                data={apiData()!.summary!.project!}
                showSessions
                expanded={expandedStat() === 'project'}
                onToggle={() => toggleStat('project')}
              />
            </Show>
            <Show when={apiData()?.memory?.turnCount}>
              <TokenStatRow
                label="记忆系统"
                color={tokenColors.reasoning}
                data={apiData()!.memory!}
                showSessions
                expanded={expandedStat() === 'memory'}
                onToggle={() => toggleStat('memory')}
              />
              <Show when={expandedStat() === 'memory' && apiData()!.memory!.byRole && Object.keys(apiData()!.memory!.byRole).length > 0}>
                <div class="mafw-usage-memory-roles">
                  <For each={Object.entries(apiData()!.memory!.byRole)}>
                    {([role, data]: [string, any]) => {
                      const memTotal = () => {
                        const t = apiData()!.memory!.totalTokens
                        return t.input + t.output + t.reasoning + t.cache.read + t.cache.write
                      }
                      const roleTotal = () => {
                        const t = data.totalTokens
                        return t.input + t.output + t.reasoning + t.cache.read + t.cache.write
                      }
                      const share = () => memTotal() > 0 ? (roleTotal() / memTotal()) * 100 : 0
                      const color = () => roleColors[role] || 'var(--text-4)'
                      return (
                        <div class="mafw-usage-memory-role">
                          <div class="mafw-usage-memory-role-info">
                            <span class="mafw-usage-memory-role-name">{roleLabel(role)}</span>
                            <div class="mafw-usage-memory-role-nums">
                              <span class="mafw-usage-memory-role-tokens">{fmtRoleTokens(data.totalTokens)}</span>
                              <Show when={data.totalCost > 0}>
                                <span class="mafw-usage-memory-role-cost">{fmtCost(data.totalCost)}</span>
                              </Show>
                              <span class="mafw-usage-memory-role-turns">{data.turnCount} 回合</span>
                            </div>
                          </div>
                          <div class="mafw-usage-memory-role-bar">
                            <div class="mafw-usage-memory-role-fill" style={{ width: `${share()}%`, background: color() }} />
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
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
      </Show>
    </div>
  )
}
