import { describe, test, expect } from 'bun:test'
import {
  draftFromConfig,
  validateFokThresholds,
  toSearchOverrides,
  mergeSearchSection,
} from './search-behavior'

describe('validateFokThresholds', () => {
  test('valid pair → null', () => {
    expect(validateFokThresholds('0.2', '0.6')).toBeNull()
    expect(validateFokThresholds(' 0.1 ', '0.95')).toBeNull()
  })
  test('non-numeric / empty → error', () => {
    expect(validateFokThresholds('', '0.6')).toBeTruthy()
    expect(validateFokThresholds('abc', '0.6')).toBeTruthy()
    expect(validateFokThresholds('0.2', '')).toBeTruthy()
  })
  test('out of (0,1) → error', () => {
    expect(validateFokThresholds('0', '0.6')).toBeTruthy()
    expect(validateFokThresholds('1.2', '0.6')).toBeTruthy()
    expect(validateFokThresholds('0.2', '1')).toBeTruthy()
  })
  test('low >= high → error', () => {
    expect(validateFokThresholds('0.6', '0.6')).toBeTruthy()
    expect(validateFokThresholds('0.7', '0.3')).toBeTruthy()
  })
})

describe('draftFromConfig', () => {
  test('full config → draft mirrors it', () => {
    const d = draftFromConfig({
      search: {
        fok: { enabled: true, probLow: 0.3, probHigh: 0.7 },
        snapshot: { enabled: true },
        temporalNeighbors: { presentation: true },
        reranker: 'llamacpp',
        rerankerBatchSize: 256,
      },
    })
    expect(d).toEqual({
      fokEnabled: true,
      probLow: '0.3',
      probHigh: '0.7',
      snapshotEnabled: true,
      neighborsPresentation: true,
      reranker: 'llamacpp',
      rerankerBatchSize: '256',
    })
  })
  test('empty config → safe defaults (gates off, thresholds shown as defaults)', () => {
    const d = draftFromConfig({})
    expect(d.fokEnabled).toBe(false)
    expect(d.snapshotEnabled).toBe(false)
    expect(d.neighborsPresentation).toBe(false)
    expect(d.probLow).toBe('0.2')
    expect(d.probHigh).toBe('0.6')
    expect(d.reranker).toBe('llamacpp')
    expect(d.rerankerBatchSize).toBe('512')
  })
})

describe('toSearchOverrides', () => {
  test('emits the four knobs with numeric thresholds', () => {
    const o = toSearchOverrides({
      fokEnabled: true,
      probLow: '0.25',
      probHigh: '0.65',
      snapshotEnabled: true,
      neighborsPresentation: false,
      reranker: 'heuristic',
      rerankerBatchSize: '128',
    })
    expect(o.search.fok).toEqual({ enabled: true, probLow: 0.25, probHigh: 0.65 })
    expect(o.search.snapshot).toEqual({ enabled: true })
    expect(o.search.temporalNeighbors).toEqual({ enabled: false, presentation: false })
    expect(o.search.reranker).toBe('heuristic')
    expect(o.search.rerankerBatchSize).toBe(128)
  })

  test('reranker batch size is clamped to the gateway range', () => {
    const build = (raw: string) => toSearchOverrides({
      fokEnabled: false, probLow: '0.2', probHigh: '0.6',
      snapshotEnabled: false, neighborsPresentation: false,
      reranker: 'llamacpp', rerankerBatchSize: raw,
    }).search.rerankerBatchSize
    expect(build('8')).toBe(32)
    expect(build('99999')).toBe(32768)
    expect(build('abc')).toBe(512)
  })
})

describe('mergeSearchSection', () => {
  test('card keys override, foreign keys survive (PUT is whole-file)', () => {
    const current = { expansionMaxSearches: 4, boundaryDense: false, fok: { enabled: false, probLow: 0.9, probHigh: 0.95 } }
    const merged = mergeSearchSection(current, toSearchOverrides({
      fokEnabled: true, probLow: '0.2', probHigh: '0.6',
      snapshotEnabled: false, neighborsPresentation: true, reranker: 'llamacpp',
    }).search)
    expect(merged.expansionMaxSearches).toBe(4)
    expect(merged.boundaryDense).toBe(false)
    expect(merged.fok).toEqual({ enabled: true, probLow: 0.2, probHigh: 0.6 })
    expect(merged.snapshot).toEqual({ enabled: false })
  })
})
