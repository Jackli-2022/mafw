import { describe, expect, test } from 'bun:test'
import { messageModel, mergeAssistantMessage } from './message-model'

describe('messageModel (canonical view only)', () => {
  test('reads model.providerID/modelID', () => {
    expect(messageModel({ model: { providerID: 'p', modelID: 'm' } })).toEqual({ providerID: 'p', modelID: 'm' })
  })

  test('ignores native top-level fields (ingestion folds them into model)', () => {
    expect(messageModel({ providerID: 'p', modelID: 'm' })).toBeNull()
    expect(messageModel({})).toBeNull()
    expect(messageModel(null)).toBeNull()
  })
})

describe('mergeAssistantMessage', () => {
  test('merges time updates in place and keeps identity', () => {
    const first = mergeAssistantMessage([], { id: 'a1', role: 'assistant', time: { created: 1 } }, { sid: 's1', parentFallback: 'u1' })
    expect(first[0]).toMatchObject({ id: 'a1', parentID: 'u1', sessionID: 's1' })
    const next = mergeAssistantMessage(first, { id: 'a1', role: 'assistant', time: { completed: 2 } }, { sid: 's1', parentFallback: 'u1' })
    expect(next[0].time).toEqual({ created: 1, completed: 2 })
  })

  test('returns the original array when nothing changed', () => {
    const msgs = [{ id: 'a1', role: 'assistant', sessionID: 's1', time: { created: 1 } }]
    expect(mergeAssistantMessage(msgs, { id: 'a1', role: 'assistant', time: { created: 1 } }, { sid: 's1', parentFallback: null })).toBe(msgs)
  })
})
