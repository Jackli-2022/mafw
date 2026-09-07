// @ts-nocheck
import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

const fmt = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
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

function ProviderSection(props: { provider: any; displayName?: string }) {
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
        <span class="mafw-usage-provider-name">{props.displayName || p().name}</span>
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
                if (w.tokens) parts.push(`${fmt(w.tokens)} tokens`)
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

export function QuotaDock(props: {
  modelGroups: () => { provider: string; providerID: string; models: { id: string; contextK?: number }[] }[]
}) {
  const [providers, setProviders] = createSignal<any[]>([])

  const fetchUsage = async () => {
    try {
      const r = await window.api.mafw.sessions.usage()
      setProviders(r?.providers || [])
    } catch (e: any) {
      console.warn("[QuotaDock] fetch failed:", e?.message)
    }
  }
  createEffect(() => { fetchUsage() })
  const timer = setInterval(fetchUsage, 15000)
  onCleanup(() => clearInterval(timer))
  onMount(() => {
    const handler = () => fetchUsage()
    window.addEventListener('mafw:usage-config-saved', handler)
    onCleanup(() => window.removeEventListener('mafw:usage-config-saved', handler))
  })

  const providerNames = createMemo(() => {
    const m = new Map<string, string>()
    for (const g of props.modelGroups()) {
      if (g.provider && g.provider !== g.providerID) m.set(g.providerID, g.provider)
    }
    return m
  })

  return (
    <div class="mafw-usage-dock">
      <div class="mafw-usage-dock-toolbar">
        <span class="mafw-usage-dock-title">配额</span>
        <ButtonV2 variant="ghost" size="small" onClick={() => {
          window.dispatchEvent(new CustomEvent('mafw:open-config', { detail: 'usage' }))
        }}>
          <Icon name="settings-gear" size="small" />
          配置
        </ButtonV2>
      </div>
      <Show when={providers().length > 0} fallback={
        <div class="mafw-usage-empty">
          <div class="mafw-usage-empty-icon">⏳</div>
          <div class="mafw-usage-empty-text">暂无配额数据</div>
          <div class="mafw-usage-empty-hint">在配置页启用用量插件后此处显示配额窗口</div>
        </div>
      }>
        <div class="mafw-usage-section">
          <For each={providers()}>
            {(provider: any) => <ProviderSection provider={provider} displayName={providerNames().get(provider.name)} />}
          </For>
        </div>
      </Show>
    </div>
  )
}
