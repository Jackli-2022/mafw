import { describe, expect, test } from 'bun:test'
import { canonicalMessageError, isAbortError } from './errors'
import { canonicalFileDiffList } from './files'
import { canonicalToolPart } from './parts'
import { canonicalMessage, ingestHistoryPage, ingestLiveMessage, ingestLivePart } from './messages'
import { normalizeSessionDiffs } from './diffs'

describe('error ingestion', () => {
  test('maps opencode wire {name,data.message} to canonical {kind,message}', () => {
    expect(canonicalMessageError({ name: 'ApiError', data: { message: 'invalid api key' } })).toEqual({
      kind: 'provider',
      message: 'invalid api key',
    })
    expect(canonicalMessageError({ name: 'MessageAbortedError' })).toEqual({
      kind: 'abort',
      message: 'MessageAbortedError',
    })
  })

  test('maps {type,message} and plain strings', () => {
    expect(canonicalMessageError({ type: 'RateLimitError', message: '429 too many requests' })).toEqual({
      kind: 'rate-limit',
      message: '429 too many requests',
    })
    expect(canonicalMessageError('interrupted by user')).toEqual({ kind: 'abort', message: 'interrupted by user' })
  })

  test('keeps canonical errors and never returns an empty message', () => {
    expect(canonicalMessageError({ kind: 'abort', message: 'stopped' })).toEqual({ kind: 'abort', message: 'stopped' })
    expect(canonicalMessageError({ kind: 'provider' })).toEqual({ kind: 'provider', message: 'provider' })
  })

  test('provider cancel/interrupt wording is not misclassified as user abort', () => {
    expect(canonicalMessageError({ name: 'ProviderError', message: 'request cancelled by provider' })).toEqual({
      kind: 'provider',
      message: 'request cancelled by provider',
    })
    expect(canonicalMessageError('Provider cancelled request after 403')).toEqual({
      kind: 'provider',
      message: 'Provider cancelled request after 403',
    })
    // 明确 interrupt/abort 仍优先（即便带 provider 字样）。
    expect(canonicalMessageError('interrupted by provider timeout')).toEqual({
      kind: 'abort',
      message: 'interrupted by provider timeout',
    })
    expect(canonicalMessageError('Operation cancelled')).toEqual({ kind: 'abort', message: 'Operation cancelled' })
  })

  test('ignores empty/malformed payloads so no empty error card renders', () => {
    expect(canonicalMessageError(undefined)).toBeUndefined()
    expect(canonicalMessageError(null)).toBeUndefined()
    expect(canonicalMessageError({})).toBeUndefined()
    expect(canonicalMessageError({ data: { message: '   ' } })).toBeUndefined()
    expect(isAbortError({ name: 'MessageAbortedError' })).toBe(true)
    expect(isAbortError({ name: 'ApiError', data: { message: 'x' } })).toBe(false)
  })
})

describe('message ingestion', () => {
  const flatMessage = () => ({
    id: 'm1',
    sessionID: 's1',
    role: 'assistant',
    time: { created: 1 },
    content: [{ id: 'part_1', type: 'text', text: 'hello' }],
  })

  test('accepts flat messages and never leaks the wire envelope', () => {
    const { messages, parts } = ingestHistoryPage([flatMessage()], { sessionID: 's1' })
    expect(messages[0].content[0].id).toBe('part_1')
    expect((messages[0] as any).info).toBeUndefined()
    expect((messages[0] as any).parts).toBeUndefined()
    expect(parts.m1[0].id).toBe('part_1')
  })

  test('ignores legacy wire envelopes (no info/parts expansion after Task 15)', () => {
    const { messages } = ingestHistoryPage(
      [{ info: { id: 'm2', sessionID: 's1', role: 'assistant', time: { created: 2 } }, parts: [{ id: 'p2', type: 'text', text: 'x' }] }],
      { sessionID: 's1' },
    )
    expect(messages).toEqual([])
  })

  test('uses only the canonical model field (native modelID/providerID are not read)', () => {
    const { messages } = ingestHistoryPage(
      [{ ...flatMessage(), model: { providerID: 'zhipu', modelID: 'glm-5.3' } }],
      { sessionID: 's1' },
    )
    expect(messages[0].model).toEqual({ providerID: 'zhipu', modelID: 'glm-5.3' })
    const nativeOnly = ingestHistoryPage(
      [{ ...flatMessage(), modelID: 'glm-5.3', providerID: 'zhipu' }],
      { sessionID: 's1' },
    )
    expect(nativeOnly.messages[0].model).toBeUndefined()
    const already = canonicalMessage({ ...flatMessage(), model: { providerID: 'p', modelID: 'm', variant: 'v' } }, { sessionID: 's1' })
    expect(already?.message.model).toEqual({ providerID: 'p', modelID: 'm', variant: 'v' })
  })

  test('drops the retired synthetic terminal messages (background comes from the jobs façade)', () => {
    const { messages } = ingestHistoryPage(
      [{ id: 'syn1', type: 'synthetic', metadata: { source: 'shell', shellID: 'sh1' }, time: { created: 1 }, content: [] }],
      { sessionID: 's1' },
    )
    expect(messages).toEqual([])
  })

  test('maps wire errors to canonical before session-ui and derives abort stopReason', () => {
    const { messages } = ingestHistoryPage(
      [{ ...flatMessage(), error: { name: 'MessageAbortedError' } }],
      { sessionID: 's1' },
    )
    expect(messages[0].error).toEqual({ kind: 'abort', message: 'MessageAbortedError' })
    expect(messages[0].stopReason).toBe('cancelled')
  })

  test('falls back to the last step-finish reason when stopReason is missing', () => {
    const { messages } = ingestHistoryPage(
      [{
        ...flatMessage(),
        content: [
          { id: 'p1', type: 'text', text: 'hi' },
          { id: 'p2', type: 'step-finish', reason: 'length' },
        ],
      }],
      { sessionID: 's1' },
    )
    expect(messages[0].stopReason).toBe('length')
  })

  test('keeps the canonical stopReason when present', () => {
    const ingested = canonicalMessage({ ...flatMessage(), stopReason: 'end_turn' }, { sessionID: 's1' })
    expect(ingested?.message.stopReason).toBe('end_turn')
  })

  test('live message.updated uses the same canonicalizer', () => {
    const live = ingestLiveMessage({ id: 'm3', role: 'assistant', error: { name: 'ApiError', data: { message: 'boom' } } }, { sessionID: 's1' })
    expect(live?.message.error).toEqual({ kind: 'unknown', message: 'boom' })
    expect(live?.parts).toEqual([])
  })

  test('live message.updated without id is dropped (pi user/assistant cannot collapse)', () => {
    // pi message_end 形状：flat role 直接由 $.message.role 映射，无 id。
    const piUser = ingestLiveMessage({ role: 'user', content: 'hi' }, { sessionID: 's1' })
    const piAssistant = ingestLiveMessage({ role: 'assistant', content: [{ type: 'text', text: 'hello' }] }, { sessionID: 's1' })
    expect(piUser).toBeNull()
    expect(piAssistant).toBeNull()

    // 模拟壳 store：用户乐观回合仍在，assistant 不会覆盖它。
    const store = { message: { s1: [{ id: 'user-local', role: 'user', sessionID: 's1' }] } }
    for (const ingested of [piUser, piAssistant]) {
      if (ingested) store.message.s1 = [{ id: ingested.message.id, role: ingested.message.role, sessionID: 's1' }]
    }
    expect(store.message.s1).toHaveLength(1)
    expect(store.message.s1[0].role).toBe('user')
  })

  test('history pagination may synthesize deterministic ids per page index', () => {
    const { messages } = ingestHistoryPage(
      [{ role: 'user', content: [] }, { role: 'assistant', content: [] }],
      { sessionID: 's1' },
    )
    expect(messages.map((m) => m.id)).toEqual(['msg-s1-0', 'msg-s1-1'])
  })
})

describe('tool part ingestion', () => {
  test('fills tool from v2.1 name and output from history content[]', () => {
    const part = canonicalToolPart({
      id: 'p',
      type: 'tool',
      name: 'shell',
      state: {
        status: 'completed',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    })
    expect(part.tool).toBe('shell')
    expect(part.state.output).toBe('first\nsecond')
  })

  test('keeps an existing live state.output', () => {
    const part = canonicalToolPart({ id: 'p', type: 'tool', tool: 'bash', state: { status: 'completed', output: 'ok' } })
    expect(part.state.output).toBe('ok')
  })

  test('normalizes apply_patch metadata.files into canonical diffs', () => {
    const parts = canonicalToolPart({
      id: 'p',
      type: 'tool',
      tool: 'apply_patch',
      state: {
        status: 'completed',
        metadata: {
          files: [
            { filePath: '/tmp/a.ts', relativePath: 'a.ts', type: 'add', patch: '@@ -0,0 +1 @@\n+x', additions: 1, deletions: 0 },
            { filePath: '/tmp/b.ts', relativePath: 'b.ts', type: 'move', movePath: 'c.ts' },
          ],
        },
      },
    })
    expect(parts.state.metadata.files).toEqual([
      { file: 'a.ts', patch: '@@ -0,0 +1 @@\n+x', additions: 1, deletions: 0, status: 'added' },
      { file: 'b.ts', movePath: 'c.ts', additions: 0, deletions: 0, status: 'renamed' },
    ])
  })

  test('normalizes legacy filediff/diff into metadata.files', () => {
    const filediff = canonicalToolPart({
      id: 'p',
      type: 'tool',
      tool: 'edit',
      state: { status: 'completed', input: { filePath: 'a.ts' }, metadata: { filediff: { file: 'b.ts', patch: 'P' } } },
    })
    expect(filediff.state.metadata.files).toEqual([
      { file: 'b.ts', patch: 'P', additions: 0, deletions: 0, status: 'modified' },
    ])
    const diffString = canonicalToolPart({
      id: 'p2',
      type: 'tool',
      tool: 'edit',
      state: { status: 'completed', input: { filePath: 'c.ts' }, metadata: { diff: 'P2' } },
    })
    expect(diffString.state.metadata.files[0].file).toBe('c.ts')
  })

  test('canonical file list is stable and dedupes by file', () => {
    const files = canonicalFileDiffList({ files: [{ file: 'a', patch: '1' }, { file: 'a', patch: '2' }] })
    expect(files).toHaveLength(1)
    expect(files[0].patch).toBe('2')
  })

  test('normalizes task child session id and agent aliases', () => {
    const part = canonicalToolPart({
      id: 'p',
      type: 'tool',
      name: 'subagent',
      state: {
        status: 'completed',
        input: { subagent_type: 'general', description: 'x' },
        metadata: { sessionId: 'child_1' },
      },
    })
    expect(part.tool).toBe('subagent')
    expect(part.state.metadata.sessionID).toBe('child_1')
    expect((part.state.metadata as any).sessionId).toBeUndefined()
    expect(part.state.input.agent).toBe('general')
    expect((part.state.input as any).subagent_type).toBeUndefined()
  })

  test('ingestLivePart normalizes a live v2.1 part', () => {
    const part = ingestLivePart({ id: 'p', name: 'subagent', messageID: 'm1', type: 'tool', state: { status: 'running', metadata: { childSessionID: 'c1' } } }, 's1')
    expect(part.tool).toBe('subagent')
    expect(part.sessionID).toBe('s1')
    expect(part.messageID).toBe('m1')
    expect(part.state.metadata.sessionID).toBe('c1')
  })
})

describe('session diff ingestion', () => {
  test('accepts arrays, {files} envelopes and file-keyed maps', () => {
    expect(normalizeSessionDiffs([{ file: 'a', patch: 'P', status: 'add' }])).toEqual([
      { file: 'a', patch: 'P', additions: 0, deletions: 0, status: 'added' },
    ])
    expect(normalizeSessionDiffs({ files: [{ file: 'b', additions: 2, deletions: 1, status: 'modified' }] })).toEqual([
      { file: 'b', additions: 2, deletions: 1, status: 'modified' },
    ])
    expect(normalizeSessionDiffs({ 'c.ts': { patch: 'P', status: 'delete' } })).toEqual([
      { file: 'c.ts', patch: 'P', additions: 0, deletions: 0, status: 'deleted' },
    ])
  })

  test('drops malformed entries instead of rendering placeholder rows', () => {
    expect(normalizeSessionDiffs([null, 'x', { patch: 'P' }, { file: 'ok', patch: 'P' }])).toEqual([
      { file: 'ok', patch: 'P', additions: 0, deletions: 0 },
    ])
    expect(normalizeSessionDiffs(undefined)).toEqual([])
  })
})
