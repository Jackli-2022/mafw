import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryTab } from '../src/ui/memory-tab.ts'
import { MemoryStore } from '../src/store/memory-store.ts'

const UNIT = { id: 'mem_1', type: 'semantic', primary_abstraction: 'abstract text', cue_anchors: [], memory_value: 'v', energy: 0.8 }
const BUDGET = { max: 10, maxChars: 800, used: 0 }

function fakeTui() {
  return {
    requestRender() {},
    setFocus() {},
    showOverlay() { return { hide() {} } },
    addInputListener() { return () => {} },
  } as any
}

function makeTab(retriever?: 'bm25' | 'hybrid') {
  const store = new MemoryStore({
    memory: {
      async search() { return [UNIT] },
      async listSticky() { return { entries: [], budget: BUDGET } },
      async setSticky() {},
    } as any,
    onChange: () => {},
  }, retriever)
  return new MemoryTab({ tui: fakeTui(), store, client: {} as any, setStatus: () => {}, setEditing: () => {} })
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

test('memory tab renders retriever badge (bm25 default)', () => {
  const lines = makeTab().render(100).map(strip).join('\n')
  assert.ok(lines.includes('bm25'), `expected bm25 badge in:\n${lines}`)
})

test('memory tab shows hybrid badge when --hybrid configured', () => {
  const lines = makeTab('hybrid').render(100).map(strip).join('\n')
  assert.ok(lines.includes('hybrid'), `expected hybrid badge in:\n${lines}`)
  assert.ok(!lines.includes('bm25'))
})
