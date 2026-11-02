// fork/compact/undo/redo/model/agent/permission 全部由 Experience action 门控：
// 不支持/暂不可用时不得发请求，错误文案中性（不暴露 runtime 名）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXPERIENCE_VERSION, type ActionDescriptor } from '@mafw/sdk'
import { TuiExperienceStore } from '../src/store/experience-store.ts'
import { COMMAND_EXPERIENCE_ACTIONS, createSlashHandler } from '../src/ui/slash-commands.ts'
import { ChatStore } from '../src/store/chat-store.ts'

function descriptor(supported: boolean, enabled: boolean, reason?: string): ActionDescriptor {
  return { supported, enabled, ...(reason ? { reason: reason as any } : {}) }
}

function experienceClient(actions: Record<string, ActionDescriptor>) {
  return {
    experience: {
      actions: async () => ({ experienceVersion: EXPERIENCE_VERSION, actions }),
    },
  }
}

function makeStore(actions: Record<string, ActionDescriptor>) {
  return new TuiExperienceStore(experienceClient(actions) as any, { ttlMs: 0 })
}

function harness(store: TuiExperienceStore) {
  const calls: string[] = []
  const deps = {
    loadOlder: async () => {},
    toggleHelp: () => {},
    rotateTopic: async () => null,
    btw: async () => null,
    showSessionPicker: async () => {},
    showQueueManager: async () => {},
    showModelPicker: async () => { calls.push('model') },
    setPlanMode: () => { calls.push('plan'); return 'plan' },
    setBuildMode: () => { calls.push('build'); return 'build' },
    showAgentPicker: async () => { calls.push('agent'); return null },
    compact: async () => { calls.push('compact'); return null },
    undo: async () => { calls.push('undo'); return null },
    redo: async () => { calls.push('redo'); return null },
    openExternalEditor: async () => {},
    cycleVerbosity: () => 'off' as const,
    toggleFocus: () => false,
    showDiff: async () => null,
    rename: async () => null,
    fork: async () => { calls.push('fork'); return null },
    showStatusRecap: () => {},
    togglePermissionMode: async () => { calls.push('permissions'); return 'ok' },
    waitwhat: async () => null,
    runGatewayCommand: async () => null,
    gatewayCommands: () => [],
    exportChat: async () => null,
    copyReply: () => 'ok',
    quitApp: () => {},
    showUsage: async () => null,
    gate: (id: Parameters<TuiExperienceStore['gate']>[0]) => store.gate(id),
  }
  return { calls, handler: createSlashHandler(deps as any) }
}

test('命令面到 Experience action 的映射覆盖全部受控命令', () => {
  assert.deepEqual(COMMAND_EXPERIENCE_ACTIONS, {
    fork: 'branch.fork',
    compact: 'session.summarize',
    undo: 'branch.revert',
    redo: 'branch.unrevert',
    model: 'session.switch-model',
    agent: 'session.switch-agent',
    plan: 'session.switch-agent',
    build: 'session.switch-agent',
    permissions: 'approval.permission',
  })
})

test('/fork 不支持时不发 fork 请求，返回中性文案', async () => {
  const store = makeStore({ 'branch.fork': descriptor(false, false, 'unsupported') })
  const h = harness(store)
  const msg = await h.handler('fork', '')
  assert.match(msg ?? '', /不支持|不可用/)
  assert.deepEqual(h.calls, [])
})

test('/compact 不支持时不发 summarize 请求', async () => {
  const store = makeStore({ 'session.summarize': descriptor(false, false, 'unsupported') })
  const h = harness(store)
  assert.match((await h.handler('compact', '')) ?? '', /不支持|不可用/)
  assert.deepEqual(h.calls, [])
})

test('/undo 与 /redo 分别由 branch.revert / branch.unrevert 门控', async () => {
  const store = makeStore({
    'branch.revert': descriptor(false, false, 'unsupported'),
    'branch.unrevert': descriptor(true, false, 'busy'),
  })
  const h = harness(store)
  assert.match((await h.handler('undo', '')) ?? '', /不支持|不可用/)
  assert.match((await h.handler('redo', '')) ?? '', /忙|不可用/)
  assert.deepEqual(h.calls, [])
})

test('/model /agent /plan /build /permissions 不可用时都不进入 picker/切换', async () => {
  const store = makeStore({
    'session.switch-model': descriptor(false, false, 'unsupported'),
    'session.switch-agent': descriptor(false, false, 'unsupported'),
    'approval.permission': descriptor(false, false, 'unsupported'),
  })
  const h = harness(store)
  for (const cmd of ['model', 'agent', 'plan', 'build', 'permissions']) {
    assert.match((await h.handler(cmd, '')) ?? '', /不支持|不可用/, `${cmd} 被门控`)
  }
  assert.deepEqual(h.calls, [])
})

test('支持的 action 正常派发（门控不误伤）', async () => {
  const store = makeStore({
    'branch.fork': descriptor(true, true),
    'session.summarize': descriptor(true, true),
    'branch.revert': descriptor(true, true),
    'branch.unrevert': descriptor(true, true),
    'session.switch-model': descriptor(true, true),
    'session.switch-agent': descriptor(true, true),
    'approval.permission': descriptor(true, true),
  })
  const h = harness(store)
  for (const cmd of ['fork', 'compact', 'undo', 'redo', 'model', 'agent']) {
    assert.equal(await h.handler(cmd, ''), null, `${cmd} 放行`)
  }
  // /plan /build /permissions 返回提示文本（非 null），但必须已进入对应实现
  assert.match((await h.handler('plan', '')) ?? '', /plan/)
  assert.match((await h.handler('build', '')) ?? '', /build/)
  assert.match((await h.handler('permissions', '')) ?? '', /ok/)
  assert.deepEqual(h.calls, ['fork', 'compact', 'undo', 'redo', 'model', 'agent', 'plan', 'build', 'permissions'])
})

test('busy 的 fork 不发请求（先门控后执行）', async () => {
  const store = makeStore({ 'branch.fork': descriptor(true, false, 'busy') })
  const h = harness(store)
  assert.match((await h.handler('fork', '')) ?? '', /不可用/)
  assert.deepEqual(h.calls, [])
})

test('ChatStore.undo/redo 也走 Experience 门（不靠方法存在性）', async () => {
  const calls: string[] = []
  const session = {
    async history() {
      return {
        data: [
          { id: 'm1', sessionID: 's', role: 'user', content: [{ id: 'p1', type: 'text', text: '你好' }] },
        ],
        nextCursor: null,
      }
    },
    async promptAsync() {},
    async abort() {},
    async revert() { calls.push('revert') },
    async unrevert() { calls.push('unrevert') },
  }
  const gate = async (id: string) => (id === 'branch.revert' ? '回退会话不支持' : null)
  const store = new ChatStore({ session: session as any, sessionID: 's', onChange: () => {}, gate: gate as any })
  await store.loadHistory()
  assert.equal(await store.undo(), '回退会话不支持')
  assert.deepEqual(calls, [], 'undo 被门控：不发 revert')
  assert.equal(await store.redo(), null)
  assert.deepEqual(calls, ['unrevert'])
})
