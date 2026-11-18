// Per-turn user context: date / weekday / timezone / optional city / language.
// The desktop chip edits these prefs; every send carries a hidden synthetic
// part. Nothing here is written to memory.

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
