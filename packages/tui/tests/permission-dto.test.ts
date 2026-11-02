// 中性 DTO 归一（Task 12）：permission / provider / agent 不再让 TUI 读 runtime 原生形状。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permissionSummary, shouldShowOverlay } from '../src/ui/overlays.ts'
import {
  normalizePermissionRequest,
  normalizeProviders,
  normalizeAgents,
  providerDefaultModelLabel,
  providerModelOptions,
} from '../src/store/dto.ts'

// ── permission ────────────────────────────────────────────────

test('pi 形状（requestId/toolName/args）不崩溃，summary 含工具名', () => {
  const summary = permissionSummary({ requestId: 'r', toolName: 'shell', args: {}, risk: 'low' })
  assert.match(summary, /shell/)
})

test('opencode 形状（permission/patterns）归一为 kind/targets', () => {
  const dto = normalizePermissionRequest({
    id: 'p1', sessionID: 's1', permission: 'bash', patterns: ['npm test'],
    always: ['npm test'],
  })
  assert.ok(dto)
  assert.equal(dto!.id, 'p1')
  assert.equal(dto!.kind, 'bash')
  assert.deepEqual(dto!.targets, ['npm test'])
  assert.deepEqual(dto!.suggestedRule, { scope: 'prefix', value: 'npm test' })
  assert.equal(permissionSummary(dto!), 'bash: npm test')
})

test('pi 形状归一：id=requestId，kind=toolName，目标取自 args', () => {
  const dto = normalizePermissionRequest({
    requestId: 'r1', sessionID: 's1', toolName: 'shell', args: { command: 'rm -rf build' }, risk: 'low',
  })
  assert.ok(dto)
  assert.equal(dto!.id, 'r1')
  assert.equal(dto!.kind, 'shell')
  assert.deepEqual(dto!.targets, ['rm -rf build'])
  assert.deepEqual(dto!.suggestedRule, { scope: 'tool', value: 'shell' })
})

test('已经是 MAFW DTO 时原样保留（不再读原生字段）', () => {
  const dto = normalizePermissionRequest({ id: 'x', sessionID: 's', kind: 'edit', targets: ['a.ts'] })
  assert.ok(dto)
  assert.equal(dto!.id, 'x')
  assert.equal(dto!.kind, 'edit')
  assert.deepEqual(dto!.targets, ['a.ts'])
})

test('不可识别的载荷返回 null（不伪造请求）', () => {
  assert.equal(normalizePermissionRequest(null), null)
  assert.equal(normalizePermissionRequest({ foo: 1 }), null)
})

test('shouldShowOverlay：gateway mafwPolicy 经 extensions 读取', () => {
  assert.equal(shouldShowOverlay({ id: 'x', sessionID: 's', kind: 'bash', targets: [], extensions: { mafwPolicy: { action: 'human' } } }), true)
  assert.equal(shouldShowOverlay({ id: 'x', sessionID: 's', kind: 'bash', targets: [], extensions: { mafwPolicy: { action: 'auto-approve' } } }), false)
  assert.equal(shouldShowOverlay({ id: 'x', sessionID: 's', kind: 'bash', targets: [], extensions: { mafwPolicy: { action: 'auto-deny' } } }), false)
  // 旧 gateway 无富化：保守弹
  assert.equal(shouldShowOverlay({ id: 'x', sessionID: 's', kind: 'bash', targets: [] }), true)
  assert.equal(shouldShowOverlay({}), true)
})

// ── provider ──────────────────────────────────────────────────

const opencodeProviders = {
  all: [
    {
      id: 'xiaomi', name: 'Xiaomi',
      models: { 'mimo-v2.6-pro': { id: 'mimo-v2.6-pro', name: 'MiMo 2.6 Pro', limit: { context: 262144, output: 32768 } } },
    },
    { id: 'local', name: 'Local', models: {} },
  ],
  connected: ['xiaomi'],
  default: { providerID: 'xiaomi', modelID: 'mimo-v2.6-pro' },
}

test('provider models 归一为数组（opencode 对象映射）', () => {
  const providers = normalizeProviders(opencodeProviders)
  assert.equal(providers.length, 2)
  const xiaomi = providers.find((p) => p.id === 'xiaomi')!
  assert.ok(Array.isArray(xiaomi.models))
  assert.deepEqual(xiaomi.models.map((m) => m.id), ['mimo-v2.6-pro'])
  assert.equal(xiaomi.models[0].contextLimit, 262144)
  assert.equal(xiaomi.connected, true)
  assert.equal(providers.find((p) => p.id === 'local')!.connected, false)
})

test('provider models 归一为数组（pi 已是数组）', () => {
  const providers = normalizeProviders({
    all: [{ id: 'pi', name: 'Pi', models: [{ id: 'm1', name: 'M1' }] }],
    connected: [],
    default: {},
  })
  assert.deepEqual(providers[0].models, [{ id: 'm1', name: 'M1', providerID: 'pi' }])
  assert.equal(providers[0].connected, undefined, 'connected 为空 = 未知，不伪造 false')
})

test('providerModelOptions 过滤未连接 provider 并给稳定 value', () => {
  const options = providerModelOptions(opencodeProviders)
  assert.deepEqual(options, [{ value: 'xiaomi/mimo-v2.6-pro', label: 'MiMo 2.6 Pro', description: 'xiaomi' }])
})

test('providerDefaultModelLabel 读中性 default 引用', () => {
  assert.equal(providerDefaultModelLabel(opencodeProviders), 'mimo-v2.6-pro')
  assert.equal(providerDefaultModelLabel({ all: [], connected: [], default: {} }), '')
  assert.equal(providerDefaultModelLabel(null), '')
})

// ── agent ─────────────────────────────────────────────────────

test('agent 归一：runtime 原生 {id,name,mode,hidden} → MafwAgent', () => {
  const agents = normalizeAgents([
    { id: 'build', name: 'Build', mode: 'primary', description: '默认执行' },
    { id: 'compaction', name: 'Compaction', mode: 'subagent', hidden: true },
  ])
  assert.equal(agents[0].id, 'build')
  assert.equal(agents[0].label, 'Build')
  assert.equal(agents[0].source, 'runtime')
  assert.equal(agents[0].selectable, true)
  assert.equal(agents[1].selectable, false)
})

test('agent 归一：MAFW 注册表身份 {name,scope,materialized} → source=mafw', () => {
  const agents = normalizeAgents([
    { name: 'manager', description: 'manager', scope: 'global', materialized: true },
    { name: 'mafw-plan', description: 'plan', scope: 'global', materialized: false },
  ])
  assert.equal(agents[0].source, 'mafw')
  assert.equal(agents[0].id, 'manager')
  assert.equal(agents[0].label, 'manager')
  assert.equal(agents[0].selectable, true)
  assert.equal(agents[1].selectable, false, '未物化身份不可选（不撒谎）')
})

test('agent 归一：已是 MafwAgent 时透传 selectable/source', () => {
  const agents = normalizeAgents([
    { id: 'plan', label: 'Plan', source: 'runtime', selectable: false, description: '只读' },
  ])
  assert.deepEqual(agents[0], { id: 'plan', label: 'Plan', source: 'runtime', selectable: false, description: '只读' })
})
