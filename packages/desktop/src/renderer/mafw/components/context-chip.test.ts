import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import {
  formatContextChip,
  formatContextStamp,
  languageLabel,
  saveContextPrefs,
  type ContextPrefs,
} from '../chat/context-reminder'

const NOW = new Date('2026-11-18T06:32:00.000Z')

const prefs = (over: Partial<ContextPrefs> = {}): ContextPrefs => ({
  city: '上海',
  sendCity: true,
  locale: 'zh-CN',
  timeZone: 'Asia/Shanghai',
  ...over,
})

describe('formatContextChip', () => {
  test('shows time and the city when city sending is on', () => {
    expect(formatContextChip(prefs(), NOW)).toBe('今天 14:32 · 上海')
  })

  test('hides the city when disabled or empty', () => {
    expect(formatContextChip(prefs({ sendCity: false }), NOW)).toBe('今天 14:32')
    expect(formatContextChip(prefs({ city: '  ' }), NOW)).toBe('今天 14:32')
  })

  test('zero-pads minutes so the ghost row width stays stable', () => {
    expect(formatContextChip(prefs({ city: '' }), new Date('2026-11-18T06:05:00.000Z')))
      .toBe('今天 14:05')
  })
})

describe('formatContextStamp', () => {
  test('renders the read-only popover stamp with timezone', () => {
    expect(formatContextStamp(prefs(), NOW)).toBe('2026-11-18 周三 14:32 · Asia/Shanghai')
  })
})

describe('languageLabel', () => {
  test('maps known locales and falls back to the tag', () => {
    expect(languageLabel('zh-CN')).toBe('中文')
    expect(languageLabel('en-US')).toBe('English')
    expect(languageLabel('fr-FR')).toBe('fr-FR')
  })
})

describe('saveContextPrefs', () => {
  test('writes the prefs under the shared localStorage key', () => {
    const writes: Array<[string, string]> = []
    ;(globalThis as any).localStorage = {
      getItem: () => null,
      setItem: (key: string, value: string) => writes.push([key, value]),
    }
    try {
      saveContextPrefs(prefs({ sendCity: false }))
      expect(writes).toHaveLength(1)
      expect(writes[0][0]).toBe('mafw-context-prefs')
      expect(JSON.parse(writes[0][1]).sendCity).toBe(false)
    } finally {
      delete (globalThis as any).localStorage
    }
  })

  test('a blocked storage is not an error', () => {
    ;(globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
    }
    try {
      expect(() => saveContextPrefs(prefs())).not.toThrow()
    } finally {
      delete (globalThis as any).localStorage
    }
  })
})

describe('ContextChip wiring', () => {
  const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf-8')

  test('is a ghost row with a 300px popover and no capsule copy', () => {
    const src = read('./ContextChip.tsx')
    expect(src).toContain('PopoverShell')
    expect(src).toContain('mafw-context-chip')
    expect(src).toContain('TextInputV2')
    expect(src).toContain('Switch')
    expect(src).toContain('formatContextChip')
    expect(src).not.toContain('随消息发送')
    expect(src).not.toContain('定位')
  })

  test('ChatPane mounts it above the composer with persisted prefs', () => {
    const pane = read('./ChatPane.tsx')
    expect(pane).toContain('<ContextChip')
    expect(pane).toContain('loadContextPrefs')
    expect(pane).toContain('saveContextPrefs')
    const css = read('../mafw.css')
    expect(css).toContain('.mafw-context-chip')
    expect(css).toContain('font-size: 10.5px')
  })
})
