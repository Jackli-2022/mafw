// Per-turn user context: date / weekday / timezone / optional city / language.
// The desktop chip edits these prefs; every send carries a hidden synthetic
// part. Nothing here is written to memory.

import { composeTurnMarkerPart } from './turn-marker'

export interface ContextPrefs {
  city?: string
  sendCity: boolean
  locale: string
  timeZone: string
  enabled?: boolean
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

export function formatLatestReminder(prefs: ContextPrefs, now: Date): string {
  if (prefs?.enabled === false) return ''
  const timeZone = prefs.timeZone || 'UTC'
  const locale = prefs.locale || 'zh-CN'
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
    return ''
  }
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  const date = `${value('year')}-${value('month')}-${value('day')}`
  const time = `${value('hour')}:${value('minute')}`
  const weekday = value('weekday')
  if (!date || !time) return ''

  const language = LANGUAGE_LABELS[locale] ?? (locale.startsWith('zh') ? '中文' : locale)
  const city = prefs.sendCity && prefs.city?.trim() ? prefs.city.trim() : ''
  const segments = [`${date} ${weekday} ${time}`.trim(), timeZone, city, language].filter(Boolean)
  return segments.join(' · ')
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
    const raw = globalThis.localStorage?.getItem('mafw-context-prefs')
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fallback
    return {
      ...fallback,
      ...(typeof parsed.city === 'string' ? { city: parsed.city } : {}),
      ...(typeof parsed.sendCity === 'boolean' ? { sendCity: parsed.sendCity } : {}),
      ...(typeof parsed.locale === 'string' && parsed.locale ? { locale: parsed.locale } : {}),
      ...(typeof parsed.timeZone === 'string' && parsed.timeZone ? { timeZone: parsed.timeZone } : {}),
      ...(typeof parsed.enabled === 'boolean' ? { enabled: parsed.enabled } : {}),
    }
  } catch {
    return fallback
  }
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
