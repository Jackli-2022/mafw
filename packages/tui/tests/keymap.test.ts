import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchKey, type KeyDispatchContext, type KeyActions } from '../src/ui/keymap.ts'
import { AppModel } from '../src/ui/app-model.ts'
import { InteractionStateMachine } from '../src/ui/interaction-state.ts'
import type { TabId } from '../src/ui/tab-strip.ts'

function makeCtx(over: Partial<{ active: TabId; editing: boolean; overlayOpen: boolean; streaming: boolean; memoryInputFocused: boolean }> = {}) {
  const model = new AppModel()
  model.active = over.active ?? 'chat'
  model.editing = over.editing ?? false
  const interaction = new InteractionStateMachine()
  const calls: string[] = []
  const actions: KeyActions = {
    quit: () => calls.push('quit'),
    switchTab: (id) => calls.push(`tab:${id}`),
    toggleHelp: () => calls.push('help'),
    abortTurn: () => calls.push('abort'),
    openExternalEditor: () => calls.push('editor'),
    blurMemorySearch: () => calls.push('memory-blur'),
    openTranscriptSearch: () => calls.push('transcript-search'),
  }
  const ctx: KeyDispatchContext = {
    model,
    interaction,
    actions,
    queries: {
      activeTab: () => model.active,
      editing: () => model.editing,
      overlayOpen: () => over.overlayOpen ?? false,
      streaming: () => over.streaming ?? false,
      memoryInputFocused: () => over.memoryInputFocused ?? false,
    },
  }
  return { ctx, calls, model }
}

test('ctrl+c always quits (editing or not)', () => {
  for (const editing of [false, true]) {
    const { ctx, calls } = makeCtx({ editing })
    assert.equal(dispatchKey('\x03', ctx), true)
    assert.deepEqual(calls, ['quit'])
  }
})

test('q quits only when not editing', () => {
  const idle = makeCtx({ editing: false })
  assert.equal(dispatchKey('q', idle.ctx), true)
  assert.deepEqual(idle.calls, ['quit'])
  const busy = makeCtx({ editing: true })
  assert.equal(dispatchKey('q', busy.ctx), false, '编辑态 q 归编辑器')
  assert.deepEqual(busy.calls, [])
})

test('digits switch tabs when not editing; ignored while editing', () => {
  const { ctx, calls } = makeCtx({ editing: false })
  assert.equal(dispatchKey('3', ctx), true)
  assert.deepEqual(calls, ['tab:memory'])
  const editing = makeCtx({ editing: true })
  assert.equal(dispatchKey('3', editing.ctx), false)
})

test('alt+digit switches tabs even while editing', () => {
  const { ctx, calls } = makeCtx({ editing: true, active: 'chat' })
  assert.equal(dispatchKey('\x1b2', ctx), true)
  assert.deepEqual(calls, ['tab:goals'])
})

test('? toggles help when not editing', () => {
  const { ctx, calls } = makeCtx({ editing: false })
  assert.equal(dispatchKey('?', ctx), true)
  assert.deepEqual(calls, ['help'])
  const editing = makeCtx({ editing: true })
  assert.equal(dispatchKey('?', editing.ctx), false)
})

test('escape aborts when busy (any tab, no overlay); not consumed when idle', () => {
  const busy = makeCtx({ streaming: true, active: 'memory' })
  assert.equal(dispatchKey('\x1b', busy.ctx), true)
  assert.deepEqual(busy.calls, ['abort'])
  const idle = makeCtx({ streaming: false })
  assert.equal(dispatchKey('\x1b', idle.ctx), false)
})

test('escape does NOT abort when an overlay is open (modal wins)', () => {
  const { ctx, calls } = makeCtx({ streaming: true, overlayOpen: true })
  assert.equal(dispatchKey('\x1b', ctx), false, 'overlay 态 Esc 归 overlay 组件')
  assert.deepEqual(calls, [])
})

test('ctrl+g opens external editor only in chat tab while editing and no overlay', () => {
  const ok = makeCtx({ active: 'chat', editing: true })
  assert.equal(dispatchKey('\x07', ok.ctx), true)
  assert.deepEqual(ok.calls, ['editor'])
  const otherTab = makeCtx({ active: 'goals', editing: false })
  assert.equal(dispatchKey('\x07', otherTab.ctx), false)
  const overlay = makeCtx({ active: 'chat', editing: true, overlayOpen: true })
  assert.equal(dispatchKey('\x07', overlay.ctx), false)
})

test('escape blurs memory search when focused and not busy', () => {
  const { ctx, calls } = makeCtx({ active: 'memory', memoryInputFocused: true })
  assert.equal(dispatchKey('\x1b', ctx), true)
  assert.deepEqual(calls, ['memory-blur'])
})

test('unmatched keys fall through (false)', () => {
  const { ctx } = makeCtx({ editing: true })
  assert.equal(dispatchKey('x', ctx), false)
  assert.equal(dispatchKey('\x1b[A', ctx), false)
})

test('ctrl+o opens transcript search in chat tab without overlay', () => {
  const ok = makeCtx({ active: 'chat' })
  assert.equal(dispatchKey('\x0f', ok.ctx), true)
  assert.deepEqual(ok.calls, ['transcript-search'])
  const otherTab = makeCtx({ active: 'goals' })
  assert.equal(dispatchKey('\x0f', otherTab.ctx), false, '非 chat tab 不触发')
  const overlay = makeCtx({ active: 'chat', overlayOpen: true })
  assert.equal(dispatchKey('\x0f', overlay.ctx), false, 'overlay 打开时不触发')
})

test('dispatch refreshes interaction state from live queries', () => {
  const { ctx } = makeCtx({ streaming: true })
  assert.equal(ctx.interaction.mode, 'prompt', '派发前尚未更新')
  dispatchKey('\x1b', ctx)
  assert.equal(ctx.interaction.mode, 'busy', '派发时从 queries 派生')
})
