import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../src/store/memory-store.ts'

const UNIT = { id: 'mem_1', type: 'semantic', primary_abstraction: 'test abstract', cue_anchors: [], memory_value: 'value text', energy: 0.8 }
const NOTE = { id: 'mem_2', type: 'semantic', primary_abstraction: 'note abstract', memory_value: '', energy: 0.9 }
const BUDGET = { max: 10, maxChars: 800, used: 1 }

function fakeMem(calls: any[]) {
  return {
    async search(o: any) { calls.push(['search', o]); return [UNIT] },
    async listSticky() { calls.push(['listSticky']); return { entries: [NOTE], budget: BUDGET } },
    async setSticky(id: string, sticky: boolean) { calls.push(['setSticky', id, sticky]) },
  }
}

test('search stores results and records query', async () => {
  const calls: any[] = []
  const s = new MemoryStore({ memory: fakeMem(calls) as any, onChange: () => {} })
  await s.search('偏好')
  assert.equal(s.results.length, 1)
  assert.deepEqual(calls[0], ['search', { query: '偏好', topK: 20, retriever: 'bm25' }])
})

test('search passes the configured retriever through', async () => {
  const calls: any[] = []
  const s = new MemoryStore({ memory: fakeMem(calls) as any, onChange: () => {} }, 'hybrid')
  await s.search('语义改写')
  assert.deepEqual(calls[0], ['search', { query: '语义改写', topK: 20, retriever: 'hybrid' }])
})

test('search failure clears nothing and reports error', async () => {
  const errors: string[] = []
  const s = new MemoryStore({
    memory: { async search() { throw new Error('boom') }, async listSticky() { return { entries: [], budget: BUDGET } }, async setSticky() {} } as any,
    onChange: () => {},
    onError: (e) => errors.push(e),
  })
  await s.search('x')
  assert.equal(errors.length, 1)
})

test('refreshSticky populates notes + budget; unstick removes', async () => {
  const calls: any[] = []
  const s = new MemoryStore({ memory: fakeMem(calls) as any, onChange: () => {} })
  await s.refreshSticky()
  assert.equal(s.sticky.length, 1)
  assert.equal(s.budget?.max, 10)
  await s.unstick('mem_2')
  assert.ok(calls.some(c => c[0] === 'setSticky' && c[1] === 'mem_2' && c[2] === false))
  assert.ok(calls.filter(c => c[0] === 'listSticky').length >= 2, 'unstick 后重拉便签板')
})
