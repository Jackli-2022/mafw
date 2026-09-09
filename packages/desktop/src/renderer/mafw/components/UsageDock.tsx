// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, Show, For, onCleanup } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"

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

type ModelWindow = 'today' | '7d' | '30d' | 'all'
type ModelStatRow = {
  provider: string | null
  model: string
  turns: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  estimatedCost: number | null
}

const modelTotal = (r: ModelStatRow): number =>
  r.tokens.input + r.tokens.output + r.tokens.reasoning + r.tokens.cache.read + r.tokens.cache.write

const modelCacheHit = (r: ModelStatRow): number => {
  const denom = r.tokens.input + r.tokens.cache.read
  return denom > 0 ? Math.round((r.tokens.cache.read / denom) * 100) : 0
}

function ModelStatsSection(props: { windows: Record<ModelWindow, ModelStatRow[]> | undefined }) {
  const [win, setWin] = createSignal<ModelWindow>('7d')
  const rows = createMemo<ModelStatRow[]>(() => props.windows?.[win()] || [])

  const kpi = createMemo(() => {
    let tokens = 0, cost = 0, cacheRead = 0, inputAll = 0
    for (const r of rows()) {
      tokens += modelTotal(r)
      cost += r.estimatedCost ?? 0
      cacheRead += r.tokens.cache.read
      inputAll += r.tokens.input + r.tokens.cache.read
    }
    return { tokens, cost, cacheHit: inputAll > 0 ? Math.round((cacheRead / inputAll) * 100) : 0 }
  })

  const items = createMemo(() => {
    const rs = rows()
    const grand = rs.reduce((s, r) => s + modelTotal(r), 0)
    const toItem = (name: string, tooltip: string, tokens: number, cost: number | null) => ({
      name, tooltip, tokens, cost,
      pct: grand > 0 ? (tokens / grand) * 100 : 0,
    })
    const top = rs.slice(0, 3).map((r) =>
      toItem(
        r.model,
        [
          r.provider ? `${r.provider}/${r.model}` : r.model,
          `输入 ${fmt(r.tokens.input)} · 输出 ${fmt(r.tokens.output)}` + (r.tokens.reasoning > 0 ? ` · 推理 ${fmt(r.tokens.reasoning)}` : ''),
          `缓存读 ${fmt(r.tokens.cache.read)} · 缓存写 ${fmt(r.tokens.cache.write)} · 命中率 ${modelCacheHit(r)}%`,
          `${r.turns} 回合`,
        ].join('\n'),
        modelTotal(r),
        r.estimatedCost,
      ),
    )
    const rest = rs.slice(3)
    if (rest.length === 0) return top
    const restTokens = rest.reduce((s, r) => s + modelTotal(r), 0)
    const restCost = rest.reduce((s, r) => s + (r.estimatedCost ?? 0), 0)
    const restCostKnown = rest.some((r) => r.estimatedCost !== null)
    top.push(toItem(`其他 ${rest.length} 个模型`, rest.map((r) => r.model).join('\n'), restTokens, restCostKnown ? restCost : null))
    return top
  })

  return (
    <Show when={rows().length > 0}>
      <div class="mafw-usage-models">
        <div class="mafw-usage-models-head">
          <span class="mafw-usage-models-title">按模型</span>
          <TabsV2 value={win()} onChange={(v: string) => setWin(v as ModelWindow)} variant="pill">
            <TabsV2.List class="mafw-usage-models-tabs">
              <TabsV2.Trigger value="today">今日</TabsV2.Trigger>
              <TabsV2.Trigger value="7d">7天</TabsV2.Trigger>
              <TabsV2.Trigger value="30d">30天</TabsV2.Trigger>
              <TabsV2.Trigger value="all">全部</TabsV2.Trigger>
            </TabsV2.List>
          </TabsV2>
        </div>
        <div class="mafw-usage-kpis">
          <div class="mafw-usage-kpi">
            <div class="mafw-usage-kpi-value">{fmt(kpi().tokens)}</div>
            <div class="mafw-usage-kpi-label">tokens</div>
          </div>
          <div class="mafw-usage-kpi">
            <div class="mafw-usage-kpi-value">{fmtCost(kpi().cost)}</div>
            <div class="mafw-usage-kpi-label">估算成本</div>
          </div>
          <div class="mafw-usage-kpi">
            <div class="mafw-usage-kpi-value">{kpi().cacheHit}%</div>
            <div class="mafw-usage-kpi-label">缓存命中</div>
          </div>
        </div>
        <For each={items()}>
          {(item) => (
            <TooltipV2 value={item.tooltip} openDelay={300}>
              <div class="mafw-usage-model">
                <div class="mafw-usage-model-head">
                  <span class="mafw-usage-model-name">{item.name}</span>
                  <span class="mafw-usage-model-tokens">{fmt(item.tokens)}</span>
                  <span class="mafw-usage-model-cost">{item.cost !== null ? fmtCost(item.cost) : '—'}</span>
                </div>
                <div class="mafw-usage-model-bar">
                  <div class="mafw-usage-model-bar-fill" style={{ width: `${item.pct}%` }} />
                </div>
                <span class="mafw-usage-model-pct">{Math.round(item.pct)}%</span>
              </div>
            </TooltipV2>
          )}
        </For>
      </div>
    </Show>
  )
}

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

// UsageConfigEditor removed — moved to Config page (left-nav > Usage)
// ProviderSection removed — moved to QuotaDock.tsx (RightDock "quota" tab)

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
    modelStats?: { windows: Record<'today' | '7d' | '30d' | 'all', ModelStatRow[]> }
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

  // Refresh immediately when usage config is saved from Config page.
  onMount(() => {
    const handler = () => fetchSummary()
    window.addEventListener('mafw:usage-config-saved', handler)
    onCleanup(() => window.removeEventListener('mafw:usage-config-saved', handler))
  })

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
    if (d.memory?.turnCount) return true
    return d.summary?.session?.turnCount || d.summary?.project?.turnCount || d.summary?.global?.turnCount
  }

  const [expandedStat, setExpandedStat] = createSignal<'session' | 'project' | 'memory' | null>(null)
  const toggleStat = (key: 'session' | 'project' | 'memory') =>
    setExpandedStat(prev => (prev === key ? null : key))

  return (
    <div class="mafw-usage-dock">
      <div class="mafw-usage-dock-toolbar">
        <span class="mafw-usage-dock-title">用量</span>
        <ButtonV2
          variant="ghost"
          size="small"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('mafw:open-config', { detail: 'usage' }))
          }}
        >
          <Icon name="settings-gear" size="small" />
          配置
        </ButtonV2>
      </div>

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
            <ModelStatsSection windows={apiData()?.modelStats?.windows} />
          </div>
        </Show>
      </Show>
    </div>
  )
}
