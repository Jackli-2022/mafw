// Per-turn user context: date / weekday / timezone / optional city / language.
// The desktop chip edits these prefs; every send carries a hidden synthetic
// part. Nothing here is written to memory.

import { composeTurnMarkerPart } from './turn-marker'

export interface ContextPrefs {
  city?: string
  sendCity: boolean
  locale: string
  timeZone: string
  /** Where this client sends from; desktop defaults to `desktop`. */
  channel?: ContextChannel
  enabled?: boolean
}

export type ContextChannel = 'desktop' | 'mobile' | 'tui' | 'web' | 'api'

const CHANNEL_LABELS: Record<ContextChannel, string> = {
  desktop: '桌面端',
  mobile: '手机端',
  tui: '终端',
  web: '网页',
  api: 'API',
}

export function channelLabel(channel: ContextChannel | undefined): string {
  return CHANNEL_LABELS[channel ?? 'desktop'] ?? '桌面端'
}

export interface LatestReminderPart {
  type: 'text'
  id: string
  text: string
  synthetic: true
}

const LANGUAGE_LABELS: Record<string, string> = {
  'zh-CN': '中文',
  'zh-TW': '繁體中文',
  'en-US': 'English',
  'en-GB': 'English',
}

export function languageLabel(locale: string): string {
  const tag = (locale || '').trim()
  if (!tag) return '中文'
  return LANGUAGE_LABELS[tag] ?? (tag.startsWith('zh') ? '中文' : tag)
}

interface ClockParts {
  date: string
  weekday: string
  time: string
  timeZone: string
}

function clockParts(prefs: ContextPrefs, now: Date): ClockParts | null {
  const timeZone = prefs.timeZone || 'UTC'
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
  } catch {
    return null
  }
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const date = `${value('year')}-${value('month')}-${value('day')}`
  const time = `${value('hour')}:${value('minute')}`
  if (!date || !time) return null
  return { date, weekday: value('weekday'), time, timeZone }
}

function cityOf(prefs: ContextPrefs): string {
  return prefs.sendCity && prefs.city?.trim() ? prefs.city.trim() : ''
}

export function formatLatestReminder(prefs: ContextPrefs, now: Date): string {
  if (prefs?.enabled === false) return ''
  const clock = clockParts(prefs, now)
  if (!clock) return ''
  const language = languageLabel(prefs.locale)
  const segments = [
    `${clock.date} ${clock.weekday} ${clock.time}`.trim(),
    clock.timeZone,
    cityOf(prefs),
    language,
    `渠道：${channelLabel(prefs.channel)}`,
  ].filter(Boolean)
  return segments.join(' · ')
}

/** Ghost-row label below the composer: `今天 14:32 · 上海`. */
export function formatContextChip(prefs: ContextPrefs, now: Date): string {
  const clock = clockParts(prefs, now)
  if (!clock) return ''
  return [`今天 ${clock.time}`.trim(), cityOf(prefs)].filter(Boolean).join(' · ')
}

/** Read-only popover stamp: `2026-11-18 周三 14:32 · Asia/Shanghai`. */
export function formatContextStamp(prefs: ContextPrefs, now: Date): string {
  const clock = clockParts(prefs, now)
  if (!clock) return ''
  return `${clock.date} ${clock.weekday} ${clock.time} · ${clock.timeZone}`.trim()
}

export function composeLatestReminderPart(prefs: ContextPrefs, ts: number): LatestReminderPart | null {
  const reminder = formatLatestReminder(prefs, new Date(ts))
  if (!reminder) return null
  return {
    type: 'text',
    id: `prt_ctx_${ts}`,
    text: `<latest-reminder>${reminder}</latest-reminder>`,
    synthetic: true,
  }
}

export function stripLatestReminder(text: string): string {
  return text.replace(/<latest-reminder>[\s\S]*?<\/latest-reminder>\s*/gi, '')
}

/** Gateway-stamped channel block (mobile / TUI / API clients). */
export function stripClientChannel(text: string): string {
  return text.replace(/<client-channel>[\s\S]*?<\/client-channel>\s*/gi, '')
}

function randomId(): string {
  try {
    const id = globalThis.crypto?.randomUUID?.()
    if (id) return id.replace(/-/g, '').slice(0, 12)
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export const DEFAULT_CONTEXT_PREFS: ContextPrefs = {
  sendCity: false,
  locale: 'zh-CN',
  timeZone: 'UTC',
  channel: 'desktop',
}

export function loadContextPrefs(): ContextPrefs {
  const timeZone = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
  })()
  const locale = (() => {
    try { return globalThis.navigator?.language || 'zh-CN' } catch { return 'zh-CN' }
  })()
  const fallback: ContextPrefs = { ...DEFAULT_CONTEXT_PREFS, timeZone, locale }
  try {
    const reminderOff = globalThis.localStorage?.getItem('mafw-latest-reminder') === '0'
    const raw = globalThis.localStorage?.getItem('mafw-context-prefs')
    if (!raw) return reminderOff ? { ...fallback, enabled: false } : fallback
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return reminderOff ? { ...fallback, enabled: false } : fallback
    return {
      ...fallback,
      ...(typeof parsed.city === 'string' ? { city: parsed.city } : {}),
      ...(typeof parsed.sendCity === 'boolean' ? { sendCity: parsed.sendCity } : {}),
      ...(typeof parsed.locale === 'string' && parsed.locale ? { locale: parsed.locale } : {}),
      ...(typeof parsed.timeZone === 'string' && parsed.timeZone ? { timeZone: parsed.timeZone } : {}),
      ...(typeof parsed.enabled === 'boolean' ? { enabled: parsed.enabled } : {}),
      ...(reminderOff ? { enabled: false } : {}),
    }
  } catch {
    return fallback
  }
}

export function saveContextPrefs(prefs: ContextPrefs): void {
  try {
    globalThis.localStorage?.setItem('mafw-context-prefs', JSON.stringify(prefs))
  } catch { /* storage blocked: prefs stay in-memory for this session */ }
}

export function buildContextParts(
  prefs: ContextPrefs,
  ts: number,
  uuid: string = randomId(),
): { turnKey: string; parts: Array<LatestReminderPart> } {
  const marker = composeTurnMarkerPart(ts, uuid)
  const reminder = composeLatestReminderPart(prefs, ts)
  return {
    turnKey: marker.id,
    parts: [marker, ...(reminder ? [reminder] : [])],
  }
}
