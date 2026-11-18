import { describe, expect, test } from 'bun:test'
import {
  composeLatestReminderPart,
  formatLatestReminder,
  stripLatestReminder,
  buildContextParts,
  type ContextPrefs,
} from './context-reminder'

const NOW = new Date('2026-11-18T06:32:00.000Z')

const prefs = (over: Partial<ContextPrefs> = {}): ContextPrefs => ({
  city: '上海',
  sendCity: true,
  locale: 'zh-CN',
  timeZone: 'Asia/Shanghai',
  channel: 'desktop',
  ...over,
})

describe('formatLatestReminder', () => {
  test('formats date, weekday, time, timezone, city, language and channel', () => {
    expect(formatLatestReminder(prefs(), NOW)).toBe(
      '2026-11-18 周三 14:32 · Asia/Shanghai · 上海 · 中文 · 渠道：桌面端',
    )
  })

  test('omits the city when disabled or empty', () => {
    expect(formatLatestReminder(prefs({ sendCity: false }), NOW)).toBe(
      '2026-11-18 周三 14:32 · Asia/Shanghai · 中文 · 渠道：桌面端',
    )
    expect(formatLatestReminder(prefs({ city: '' }), NOW)).toBe(
      '2026-11-18 周三 14:32 · Asia/Shanghai · 中文 · 渠道：桌面端',
    )
  })

  test('labels the channel', () => {
    expect(formatLatestReminder(prefs({ channel: 'mobile' }), NOW)).toContain('渠道：手机端')
    expect(formatLatestReminder(prefs({ channel: 'tui' }), NOW)).toContain('渠道：终端')
    expect(formatLatestReminder(prefs({ channel: 'web' }), NOW)).toContain('渠道：网页')
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

describe('buildContextParts', () => {
  test('returns the turn marker and the reminder with the same key', () => {
    const built = buildContextParts(prefs(), 1000, 'abc')
    expect(built.turnKey).toBe('turn_abc')
    expect(built.parts).toHaveLength(2)
    expect(built.parts[0]).toMatchObject({ id: 'turn_abc', synthetic: true })
    expect(built.parts[0].text).toBe('[[turn:turn_abc]]')
    expect(built.parts[1].text).toContain('<latest-reminder>')
  })

  test('keeps the marker when the reminder is disabled', () => {
    const built = buildContextParts(prefs({ enabled: false }), 1000, 'abc')
    expect(built.parts).toHaveLength(1)
    expect(built.parts[0].id).toBe('turn_abc')
  })
})
