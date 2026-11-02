// TuiExperienceStore：框架无关的 Experience 动作面状态机（Task 12）。
// 语义：supported=功能面存在；enabled=此刻可执行；loading/error/unavailable/incompatible
// 是客户端状态，不得伪造 ActionDescriptor；旧响应不得覆盖新 runtime/会话。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXPERIENCE_VERSION } from '@mafw/sdk'
import { TuiExperienceStore, compareExperienceVersions } from '../src/store/experience-store.ts'

function descriptor(supported: boolean, enabled: boolean, reason?: string) {
  return { supported, enabled, ...(reason ? { reason } : {}) }
}

function response(actions: Record<string, any>, over: Record<string, any> = {}) {
  return { experienceVersion: EXPERIENCE_VERSION, actions, ...over }
}

function fakeClient(impl: (sessionID?: string) => Promise<any>) {
  const calls: (string | undefined)[] = []
  return {
    calls,
    experience: {
      actions: async (sessionID?: string) => {
        calls.push(sessionID)
        return impl(sessionID)
      },
    },
  }
}

test('load 后 ready：action/supported/enabled 读的是同一份 descriptor', async () => {
  const client = fakeClient(async () => response({
    'branch.fork': descriptor(true, true),
    'branch.revert': descriptor(true, false, 'busy'),
  }))
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  await store.load('ses_1')
  assert.equal(store.status, 'ready')
  assert.deepEqual(client.calls, ['ses_1'])
  assert.equal(store.supported('branch.fork'), true)
  assert.equal(store.enabled('branch.fork'), true)
  assert.equal(store.supported('branch.revert'), true)
  assert.equal(store.enabled('branch.revert'), false)
  assert.equal(store.action('branch.revert')?.reason, 'busy')
  assert.equal(store.action('branch.unrevert'), null)
})

test('supported=false 的动作 enabled 也为 false（不变量在不同来源下仍成立）', async () => {
  const client = fakeClient(async () => response({
    'branch.fork': { supported: false, enabled: true },
  }))
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  await store.load('ses_1')
  assert.equal(store.supported('branch.fork'), false)
  assert.equal(store.enabled('branch.fork'), false)
})

test('gate：不支持的动作返回中性文案（不含 runtime 名）', async () => {
  const client = fakeClient(async () => response({
    'branch.fork': descriptor(false, false, 'unsupported'),
  }))
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  const blocked = await store.gate('branch.fork')
  assert.match(blocked ?? '', /不支持|不可用/)
  assert.doesNotMatch(blocked ?? '', /opencode|pi\b|claude/i)
})

test('gate：busy 的动作是「暂不可用」而不是「不支持」', async () => {
  const client = fakeClient(async () => response({
    'branch.fork': descriptor(true, false, 'busy'),
  }))
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  const blocked = await store.gate('branch.fork')
  assert.match(blocked ?? '', /不可用/)
  assert.match(blocked ?? '', /忙/)
  assert.doesNotMatch(blocked ?? '', /不支持/)
})

test('gate：idle 状态会先加载，加载成功后放行（null）', async () => {
  const client = fakeClient(async () => response({ 'session.summarize': descriptor(true, true) }))
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  assert.equal(store.status, 'idle')
  assert.equal(await store.gate('session.summarize'), null)
  assert.equal(client.calls.length, 1)
  assert.equal(store.status, 'ready')
})

test('gate：loading 期间并发调用共享同一次请求', async () => {
  let resolveLoad: (value: any) => void = () => {}
  const pending = new Promise((resolve) => { resolveLoad = resolve })
  const client = fakeClient(() => pending)
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  const a = store.gate('branch.fork')
  const b = store.gate('branch.fork')
  resolveLoad(response({ 'branch.fork': descriptor(true, true) }))
  assert.equal(await a, null)
  assert.equal(await b, null)
  assert.equal(client.calls.length, 1, '并发 gate 不重复打 API')
})

test('invalidate：状态回到 idle 且旧 in-flight 响应不覆盖（作用域失效）', async () => {
  let resolveFirst: (value: any) => void = () => {}
  const first = new Promise((resolve) => { resolveFirst = resolve })
  let call = 0
  const client = fakeClient(async () => {
    call++
    if (call === 1) return first
    return response({ 'branch.fork': descriptor(true, false, 'busy') })
  })
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  const loading = store.load('ses_old')
  store.invalidate()
  assert.equal(store.status, 'idle')
  resolveFirst(response({ 'branch.fork': descriptor(true, true) }))
  await loading
  assert.equal(store.status, 'idle', '旧响应被代际丢弃')
  assert.equal(store.supported('branch.fork'), false)
  // 新会话重新加载生效
  await store.load('ses_new')
  assert.equal(store.enabled('branch.fork'), false)
})

test('incompatible：网关要求更高客户端版本时明确降级，不伪造动作', async () => {
  const client = fakeClient(async () => response(
    { 'branch.fork': descriptor(true, true) },
    { minClientVersion: '2099.1.0' },
  ))
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  await store.load('ses_1')
  assert.equal(store.status, 'incompatible')
  assert.equal(store.supported('branch.fork'), false)
  assert.match((await store.gate('branch.fork')) ?? '', /不支持|不可用/)
})

test('unavailable：404/HTML 旧网关 → unavailable（不是 error）', async () => {
  const client = fakeClient(async () => { throw new Error('HTTP 404: Not Found') })
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  await store.load('ses_1')
  assert.equal(store.status, 'unavailable')
  assert.match((await store.gate('branch.fork')) ?? '', /不支持|不可用/)
})

test('error：网络/解析失败保留 error 状态，仍给中性门禁文案', async () => {
  const client = fakeClient(async () => { throw new Error('ECONNREFUSED') })
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  await store.load('ses_1')
  assert.equal(store.status, 'error')
  assert.ok(await store.gate('branch.fork'))
})

test('无会话时按全局 action 面加载（sessionID=undefined）', async () => {
  const client = fakeClient(async () => response({ 'background.jobs': descriptor(true, true) }))
  const store = new TuiExperienceStore(client, { ttlMs: 0 })
  await store.load(null)
  assert.deepEqual(client.calls, [undefined])
  assert.equal(store.enabled('background.jobs'), true)
})

test('gate 在 TTL 过期后重新拉取（busy 状态不长期缓存）', async () => {
  let current = descriptor(true, true)
  const client = fakeClient(async () => response({ 'branch.fork': current }))
  let now = 1000
  const store = new TuiExperienceStore(client, { ttlMs: 5000, now: () => now })
  assert.equal(await store.gate('branch.fork'), null)
  current = descriptor(true, false, 'busy')
  now += 6000
  assert.match((await store.gate('branch.fork')) ?? '', /不可用/)
  assert.equal(client.calls.length, 2)
})

test('compareExperienceVersions 逐段数值比较', () => {
  assert.equal(compareExperienceVersions('2026.11.1', '2026.11.0'), 1)
  assert.equal(compareExperienceVersions('2026.11.0', '2026.11.0'), 0)
  assert.equal(compareExperienceVersions('2026.9.9', '2026.11.0'), -1)
  assert.equal(compareExperienceVersions('2026.11', '2026.11.0'), 0)
})
