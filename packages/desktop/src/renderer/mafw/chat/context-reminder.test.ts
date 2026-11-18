import { describe, expect, test } from 'bun:test'
import {
  composeLatestReminderPart,
  formatLatestReminder,
  stripLatestReminder,
  type ContextPrefs,
} from './context-reminder'

const NOW = new Date('2026-11-18T06:32:00.000Z')

const prefs = (over: Partial<ContextPrefs> = {}): ContextPrefs => ({
  city: '上海',
  sendCity: true,
  locale: 'zh-CN',
  timeZone: 'Asia/Shanghai',
  ...over,
})

describe('formatLatestReminder', () => {
  test('formats date, weekday, time, timezone, city and language', () => {
    expect(formatLatestReminder(prefs(), NOW)).toBe(
      '2026-11-18 周三 14:32 · Asia/Shanghai · 上海 · 中文',
    )
  })

  test('omits the city when disabled or empty', () => {
    expect(formatLatestReminder(prefs({ sendCity: false }), NOW)).toBe(
      '2026-11-18 周三 14:32 · Asia/Shanghai · 中文',
    )
    expect(formatLatestReminder(prefs({ city: '' }), NOW)).toBe(
      '2026-11-18 周三 14:32 · Asia/Shanghai · 中文',
    )
  })

  test('can be disabled entirely', () => {
    expect(formatLatestReminder(prefs({ enabled: false }), NOW)).toBe('')
  })

  test('maps the locale to a human language label', () => {
    expect(formatLatestReminder(prefs({ locale: 'en-US' }), NOW)).toContain('English')
  })
})

describe('composeLatestReminderPart', () => {
  test('wraps the reminder in a synthetic text part', () => {
    const part = composeLatestReminderPart(prefs(), 1000)
    expect(part).toMatchObject({ type: 'text', synthetic: true })
    expect(part!.text).toContain('<latest-reminder>')
    expect(part!.text).toContain('上海')
    expect(stripLatestReminder(part!.text)).toBe('')
  })

  test('returns null when disabled', () => {
    expect(composeLatestReminderPart(prefs({ enabled: false }), 1000)).toBeNull()
  })
})

describe('stripLatestReminder', () => {
  test('removes the hidden block and keeps surrounding text', () => {
    expect(stripLatestReminder('hello\n<latest-reminder>x</latest-reminder>\nworld')).toBe('hello\nworld')
  })
})
