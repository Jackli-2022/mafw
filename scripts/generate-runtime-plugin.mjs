#!/usr/bin/env node
/**
 * generate-runtime-plugin.mjs — one-api（OpenAI 兼容）runtime 插件生成器
 *
 * 生成 raw-event-first 骨架（spec 2026-10-31-runtime-plugin-ergonomics-design）：
 *   - 声明面：preset / eventTranslation / eventSource / eventMappings / transformEvent / sampleEvents
 *   - 翻译由 gateway 执行器完成（插件推原生 chunk/done/error 事件）
 *   - 按 preset 生成契约 TODO（缺失面显式列出，不静默漏掉）
 *   - --check <file> 委托 gateway 离线检查器（plugin-check）
 *
 * 用法：
 *   node scripts/generate-runtime-plugin.mjs --name my-runtime [--preset conversation] \
 *        [--baseUrl http://localhost:9000] [--model my-model] [--out ~/.mafw/runtime-plugins] [--mock] [--self-test]
 *   node scripts/generate-runtime-plugin.mjs --check path/to/plugin.js [--preset core] [--strict]
 */
import { parseArgs } from "node:util"
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { homedir, tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

// ─────────────────────────────────────────────────────────────
// 插件模板（占位符：__NAME__ / __BASEURL__ / __MODEL__ / __ENVKEY__）
// ─────────────────────────────────────────────────────────────
const PLUGIN_TEMPLATE = String.raw`// __NAME__.js — MAFW runtime 插件（one-api / OpenAI 兼容翻译层）
// 由 scripts/generate-runtime-plugin.mjs 生成。修改后：
//   POST /api/runtime/reload 重扫 → POST /api/runtime/switch {"plugin":"__NAME__"} 热切换
//
// 配置（config.yaml）：
//   runtime:
//     plugin: __NAME__
//     pluginConfig:
//       __NAME__:
//         baseUrl: "__BASEURL__"
//         apiKey: "sk-xxx"        # 或环境变量 __ENVKEY__
//         model: "__MODEL__"
//         stream: true            # 默认 true；false 走非流式

'use strict'
const fs = require('node:fs')
const path = require('node:path')

const PLUGIN_NAME = '__NAME__'

// ═════════════════════════════════════════════════════════════
// 翻译层 1/3 — toWire：MAFW prompt opts → OpenAI chat/completions 请求体
// （one-api 及一切 OpenAI 兼容网关通用格式；字段差异在这里集中改）
// ═════════════════════════════════════════════════════════════
function toWire(opts, state, cfg, extras) {
  const userText = opts.message || (opts.parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n')
  if (userText) state.messages.push({ role: 'user', content: userText })
  const body = {
    model: opts.model || cfg.model || '__MODEL__',
    messages: state.messages.slice(),
    stream: cfg.stream !== false,
  }
  if (extras && extras.system) body.messages = [{ role: 'system', content: extras.system }, ...body.messages]
  if (cfg.temperature != null) body.temperature = cfg.temperature
  if (cfg.maxTokens != null) body.max_tokens = cfg.maxTokens
  return body
}

// ═════════════════════════════════════════════════════════════
// 翻译层 2/3 — fromWire：非流式响应 → PromptResultEnvelope
// ═════════════════════════════════════════════════════════════
function fromWire(data) {
  const choice = (data.choices || [])[0] || {}
  const text = choice.message?.content ?? choice.text ?? ''
  const u = data.usage || {}
  return {
    parts: [{ type: 'text', text }],
    finish: mapFinish(choice.finish_reason),
    usage: { input: u.prompt_tokens, output: u.completion_tokens, cached: u.prompt_tokens_details?.cached_tokens },
  }
}

function mapFinish(reason) {
  switch (reason) {
    case 'stop': return 'stop'
    case 'length': return 'length'
    case 'tool_calls': case 'function_call': return 'tool'
    case 'content_filter': return 'content-filter'
    default: return undefined
  }
}

// ═════════════════════════════════════════════════════════════
// 翻译层 3/3 — fromSSE：SSE chunk → { delta, finish, usage }
// （chunk 形状：choices[0].delta.content / finish_reason / usage — one-api 通用）
// ═════════════════════════════════════════════════════════════
function fromSSE(json) {
  const choice = (json.choices || [])[0] || {}
  return {
    delta: choice.delta?.content ?? '',
    finish: choice.finish_reason ? mapFinish(choice.finish_reason) : undefined,
    usage: json.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : undefined,
  }
}

// ── SSE 字节流解析（data: 行 → JSON；[DONE] 终止）──
async function* parseSSE(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return
        try { yield JSON.parse(payload) } catch { /* 跳过坏行（fail-open） */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ═════════════════════════════════════════════════════════════
// 记忆接入钩子（宿主侧；详见 .opencode/skills/runtime-plugin-authoring 第四步）
// ═════════════════════════════════════════════════════════════
function makeMemoryHooks(ctx, gatewayPort) {
  const base = 'http://127.0.0.1:' + (gatewayPort || process.env.MAFW_SERVER_API_PORT || 3000)
  const capture = (sessionID, source, content, failure) => {
    // fail-open：错误不阻塞 agent；gateway 负责去重/脱敏/截断
    ctx.fetch(base + '/api/obs/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionID, source, content, failure: !!failure }),
    }).catch(() => {})
  }
  const recall = async (sessionID, query) => {
    try {
      const res = await ctx.fetch(base + '/api/recall/context?sessionID=' + encodeURIComponent(sessionID)
        + '&query=' + encodeURIComponent((query || '').slice(0, 500)), { signal: AbortSignal.timeout(100) })
      const data = await res.json()
      return data.pointers || null   // null 是合法返回 → 不注入
    } catch { return null }
  }
  const pinned = async () => {
    try {
      const res = await ctx.fetch(base + '/api/recall/pinned', { signal: AbortSignal.timeout(150) })
      const data = await res.json()
      return data.profile || null
    } catch { return null }
  }
  return { capture, recall, pinned }
}

const MEMORY_GUIDE = [
  '<memory-guide>',
  '## 记忆',
  '你的长期记忆由 MAFW 谐波记忆系统管理，跨会话、压缩与模型更替存续。',
  '不主动记录，你将无法记得过去的决定、偏好与教训。',
  '学到新知识/偏好/教训 → mafw_add_memory；需要旧记忆 → mafw_search_hybrid；指针取全文 → mafw_get_memory。',
  '</memory-guide>',
].join('\n')

// ═════════════════════════════════════════════════════════════
// 插件主体
// ═════════════════════════════════════════════════════════════
module.exports = {
  name: PLUGIN_NAME,
  external: true,
  preset: '__PRESET__',
  eventTranslation: 'declared',
  capabilities: {
    eventStream: true,          // raw-event-first：gateway 执行器翻译声明表
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
    sessionStorageApi: false,
    agentConfigApi: false,
  },

  // ── 事件声明面（declared 是唯一推荐路径；执行器在 gateway） ──
  eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
  eventMappings: [
    { from: 'session_meta', to: 'session.created',
      when: [{ path: '$.info.id', exists: true }],
      fields: { info: { path: '$.info' } } },
    { from: 'chunk', to: 'part.delta',
      when: [{ path: '$.choices[0].delta.content', exists: true }],
      fields: {
        messageID: { path: '$.messageID' },
        partID: { path: '$.partID' },
        field: { const: 'text' },
        delta: { path: '$.choices[0].delta.content' },
      } },
    { from: 'text_final', to: 'part.updated',
      fields: {
        'part.id': { path: '$.partID' },
        'part.type': { const: 'text' },
        'part.text': { path: '$.text' },
        'part.messageID': { path: '$.messageID' },
        'part.sessionID': { path: '$.sessionID' },
      } },
    { from: 'done', to: 'turn.completed',
      fields: { sessionID: { path: '$.sessionID' }, usage: { path: '$.usage' }, cost: { path: '$.cost' } } },
    { from: 'error', to: 'turn.failed',
      fields: { sessionID: { path: '$.sessionID' }, error: { path: '$.error' } } },
    { from: 'aborted', to: 'turn.aborted',
      fields: { sessionID: { path: '$.sessionID' }, reason: { path: '$.reason' } } },
  ],
  // 逃逸口占位：无状态机/1→N fan-out 需求时返回 null（声明式压制）。
  transformEvent(raw) { return null },
  // 离线检查器样本（mafw plugin-check 用）
  sampleEvents: [
    { type: 'session_meta', sessionID: 'sample', info: { id: 'sample', title: 'sample', time: { updated: 0 } } },
    { type: 'chunk', sessionID: 'sample', messageID: 'm1', partID: 'm1-text', choices: [{ delta: { content: 'hi' } }] },
    { type: 'text_final', sessionID: 'sample', messageID: 'm1', partID: 'm1-text', text: 'hi' },
    { type: 'done', sessionID: 'sample', messageID: 'm1', usage: { input: 1, output: 1 } },
  ],

  // ── 契约 TODO（按 preset 从 runtime-contract.json 生成，未实现的面不会静默漏掉） ──
__CONTRACT_TODOS__

  async createRuntime(ctx) {
    const cfg = ctx.pluginConfig(PLUGIN_NAME) || {}
    const baseUrl = (cfg.baseUrl || '__BASEURL__').replace(/\/$/, '')
    const apiKey = cfg.apiKey || process.env['__ENVKEY__'] || null
    const gatewayPort = ctx.gatewayPort
    const mem = makeMemoryHooks(ctx, gatewayPort)
    const headers = { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}) }

    // ── 会话持久化（JSON 文件；gateway 重启后会话不丢）──
    const dataDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.mafw', 'runtime-plugin-data', PLUGIN_NAME)
    const dataFile = path.join(dataDir, 'sessions.json')
    let sessions = new Map()
    try {
      for (const s of JSON.parse(fs.readFileSync(dataFile, 'utf8'))) sessions.set(s.id, s)
    } catch { /* 首次启动无文件 */ }
    let saveTimer = null
    const save = () => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        try {
          fs.mkdirSync(dataDir, { recursive: true })
          fs.writeFileSync(dataFile, JSON.stringify([...sessions.values()]))
        } catch (e) { ctx.log.warn('[' + PLUGIN_NAME + '] persist failed: ' + e.message) }
      }, 300)
    }

    // ── 事件流（async queue 桥：无消费者时事件入队不丢，单消费者语义）──
    // raw-event-first：这里推「原生事件」，翻译由 gateway 执行器按本文件顶部的
    // eventSource/eventMappings 完成（不要在这里产出 canonical 事件名）。
    const eventQueue = []
    let pendingResolve = null
    const emitRaw = (event) => {
      if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(event) }
      else eventQueue.push(event)
    }
    const eventStream = async function* () {
      while (true) {
        if (eventQueue.length) yield eventQueue.shift()
        else yield await new Promise((r) => { pendingResolve = r })
      }
    }

    // ── 单轮执行：toWire → fetch（流式/非流式）→ 原生事件 ──
    let toolFactory = null
    async function runTurn(sessionID, opts, onDelta) {
      const sess = sessions.get(sessionID)
      if (!sess) throw new Error('session not found: ' + sessionID)
      const systemParts = [MEMORY_GUIDE]
      const profile = await mem.pinned()
      if (profile) systemParts.push(profile)
      const pointers = await mem.recall(sessionID, opts.message || (opts.parts || [])[0]?.text)
      if (pointers) systemParts.push(pointers)

      const body = toWire(opts, sess, cfg, { system: systemParts.join('\n') })
      const res = await ctx.fetch(baseUrl + '/v1/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(body),
        signal: opts.abortSignal,
      })
      if (!res.ok) throw new Error('upstream ' + res.status + ': ' + (await res.text()).slice(0, 300))

      let text = '', finish, usage
      const messageID = 'as_' + Date.now().toString(36)
      const partID = messageID + '-text'
      const base = { sessionID, messageID, partID }
      if (body.stream) {
        for await (const chunk of parseSSE(res)) {
          // 原生 chunk 原样推（附路由字段）；delta 提取只用于本地累积/返回值
          emitRaw({ type: 'chunk', ...base, choices: chunk.choices, usage: chunk.usage })
          const t = fromSSE(chunk)
          if (t.delta && onDelta) onDelta(t.delta)
          text += t.delta || ''
          if (t.finish) finish = t.finish
          if (t.usage) usage = t.usage
        }
      } else {
        const wire = fromWire(await res.json())
        text = wire.parts[0].text
        finish = wire.finish
        usage = wire.usage
        emitRaw({ type: 'chunk', ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })
        if (onDelta) onDelta(text)
      }

      sess.messages.push({ role: 'assistant', content: text })
      sess.time = { created: sess.time.created, updated: Date.now() }
      save()
      emitRaw({ type: 'text_final', ...base, text })
      emitRaw({ type: 'done', sessionID, messageID, usage: usage || {}, cost: sess.cost })
      return { parts: [{ type: 'text', text }], finish, usage: usage || {} }
    }

    return {
      name: PLUGIN_NAME,

      session: {
        async create(opts) {
          const id = 'ses_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
          sessions.set(id, {
            id, directory: opts.directory, messages: [],
            title: 'New session', time: { created: Date.now(), updated: Date.now() },
          })
          save()
          emitRaw({
            type: 'session_meta',
            sessionID: id,
            info: { id, title: 'New session', directory: opts.directory, time: { updated: Date.now() } },
          })
          return { id }
        },

        async prompt(opts) {
          mem.capture(opts.sessionID, 'user_input', opts.message || (opts.parts || [])[0]?.text || '')
          return runTurn(opts.sessionID, opts, null)
        },

        async promptAsync(opts) {
          const sessionID = opts.sessionID
          mem.capture(sessionID, 'user_input', opts.message || (opts.parts || [])[0]?.text || '')
          // 异步执行；原生 chunk/done 事件经总线推出（gateway 执行器翻译）
          runTurn(sessionID, opts, null).catch((err) => {
            ctx.log.error('[' + PLUGIN_NAME + '] prompt failed: ' + err.message)
            emitRaw({ type: 'error', sessionID, error: err.message })
          })
          return {}
        },

        async messages(opts) {
          const sess = sessions.get(opts.sessionID)
          if (!sess) return { data: [] }
          const all = sess.messages.map((m, i) => ({
            id: opts.sessionID + '_' + i, sessionID: opts.sessionID, role: m.role,
            parts: [{ type: 'text', text: m.content }], time: sess.time,
          }))
          const limit = opts.limit || 50
          return { data: all.slice(-limit) }
        },

        async get({ sessionID }) { return sessions.get(sessionID) || null },
        async delete({ sessionID }) { sessions.delete(sessionID); save() },
        async abort({ sessionID }) { emitRaw({ type: 'aborted', sessionID, reason: 'aborted' }) },
        async list() {
          return [...sessions.values()].map(s => ({
            id: s.id, title: s.title, directory: s.directory, time: s.time,
          }))
        },
        async todo() { return [] },
        async children() { return [] },
        async summarize() { return {} },
      },

      global: {
        async event() {
          // 单消费者语义：gateway 是唯一事件订阅方
          return { stream: eventStream() }
        },
      },

      provider: {
        async list() {
          return { all: [PLUGIN_NAME], connected: [PLUGIN_NAME], default: { chat: cfg.model || '__MODEL__' } }
        },
      },
      app: { async agents() { return [] } },
      config: { async get() { return cfg }, async update(c) { return c } },

      // Tier-0 必选：MAFW 基础工具通道。one-api 模板默认只 stash factory
      // （无原生 tool-calling 时不注入）；上游支持 function calling 时在这里
      // 把 factory(sessionId) 的结果翻译成 tools 参数并回传 tool_calls。
      tools: {
        async registerTools(factory) { toolFactory = factory },
        nativeTools() { return [] },
      },
      getBaseUrl() { return baseUrl },

      async healthCheck() {
        try {
          const res = await ctx.fetch(baseUrl + '/v1/models', { headers, signal: AbortSignal.timeout(3000) })
          return res.ok
        } catch { return false }
      },

      credentials: {
        getApiKey(provider) { return provider === PLUGIN_NAME ? apiKey : null },
      },
    }
  },
}
`

// ─────────────────────────────────────────────────────────────
// mock one-api 服务模板（联调用：/v1/chat/completions 非流式 + 流式）
// ─────────────────────────────────────────────────────────────
const MOCK_TEMPLATE = String.raw`// mock-oneapi-server.mjs — 本地 one-api 假服务（联调 __NAME__ 插件用）
// 用法：node mock-oneapi-server.mjs [port]
import http from 'node:http'

const port = Number(process.argv[2] || 9000)

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: '__MODEL__' }] }))
    return
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404); res.end('not found'); return
  }
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const body = JSON.parse(raw)
    const reply = 'echo: ' + (body.messages.filter(m => m.role === 'user').pop()?.content ?? '')
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-mock', object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      }))
      return
    }
    // 流式：按词切片逐 chunk 推
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const pieces = reply.match(/.{1,6}/gs) || []
    let i = 0
    const timer = setInterval(() => {
      if (i < pieces.length) {
        res.write('data: ' + JSON.stringify({
          id: 'chatcmpl-mock', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content: pieces[i] }, finish_reason: null }],
        }) + '\n\n')
        i++
      } else {
        res.write('data: ' + JSON.stringify({
          id: 'chatcmpl-mock', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: pieces.length, total_tokens: 12 + pieces.length },
        }) + '\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
        clearInterval(timer)
      }
    }, 60)
    // 注意：req 的 'close' 在 body 读完（end 之前）即触发（node ≥16 语义），
    // 会把 setInterval 清掉导致流式零输出——必须监听 res 的 'close'（连接断开）
    res.on('close', () => clearInterval(timer))
  })
}).listen(port, () => console.log('mock one-api listening on http://127.0.0.1:' + port))
`

// ─────────────────────────────────────────────────────────────
// 契约清单（preset → 未实现面 TODO；manifest 是唯一事实源）
// ─────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(__dirname, '..', 'packages', 'gateway-sdk', 'contract', 'runtime-contract.json')

/** 本模板已实现（或声明）的面——其余要求的面会生成 TODO 注释。 */
const TEMPLATE_IMPLEMENTED = new Set([
  'plugin.name', 'plugin.createRuntime', 'plugin.capabilities',
  'plugin.eventSource', 'plugin.eventMappings', 'plugin.transformEvent',
  'session.create', 'session.promptAsync', 'session.prompt', 'session.messages',
  'session.get', 'session.delete', 'session.abort', 'session.list',
  'session.todo', 'session.children', 'session.summarize',
  'prompt.parts.text',
  'tools.registerTools', 'tools.nativeTools',
  'events.global',
  'provider.list', 'provider.app.agents', 'provider.config', 'provider.config.update',
  'process.getBaseUrl', 'process.healthCheck',
])

function loadManifest() {
  try { return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) } catch { return null }
}

function contractTodos(preset) {
  const manifest = loadManifest()
  if (!manifest) {
    return `  // TODO: runtime-contract.json missing at ${MANIFEST_PATH} — build @mafw/sdk first`
  }
  const def = manifest.presets.find((p) => p.id === preset)
  if (!def) {
    return `  // TODO: unknown preset '${preset}' (choose core|conversation|autonomous|desktop)`
  }
  const missing = def.requiredSurfaces.filter((id) => !TEMPLATE_IMPLEMENTED.has(id))
  if (missing.length === 0) {
    return `  // preset '${preset}': all required surfaces are implemented by this template`
  }
  return missing.map((id) => {
    const s = manifest.surfaces.find((x) => x.id === id)
    return `  // TODO(contract:${id}): ${s?.title ?? id} — ${s?.impact ?? ''}`
  }).join('\n')
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────
function fill(template, values) {
  let out = template
  for (const [k, v] of Object.entries(values)) out = out.replaceAll(k, v)
  return out
}

function generate({ name, baseUrl, model, outDir, mock, preset = 'conversation' }) {
  const envKey = name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'
  const values = {
    '__NAME__': name,
    '__BASEURL__': baseUrl,
    '__MODEL__': model,
    '__ENVKEY__': envKey,
    '__PRESET__': preset,
    '__CONTRACT_TODOS__': contractTodos(preset),
  }
  const pluginCode = fill(PLUGIN_TEMPLATE, values)
  const written = []

  mkdirSync(outDir, { recursive: true })
  const pluginPath = join(outDir, `${name}.js`)
  writeFileSync(pluginPath, pluginCode, 'utf8')
  written.push(pluginPath)

  if (mock) {
    const mockPath = join(outDir, `mock-oneapi-server.mjs`)
    writeFileSync(mockPath, fill(MOCK_TEMPLATE, values), 'utf8')
    written.push(mockPath)
  }

  return { written, envKey }
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'mafw-plugin-gen-'))
  try {
    const { written } = generate({ name: 'selftest-runtime', baseUrl: 'http://127.0.0.1:9100', model: 'selftest-model', outDir: dir, mock: true })
    // 1) 插件可 require，形状合法
    const mod = require(written[0])
    if (!mod.name || mod.name !== 'selftest-runtime') throw new Error('exports.name invalid')
    if (typeof mod.createRuntime !== 'function') throw new Error('createRuntime missing')
    if (!mod.capabilities || mod.capabilities.eventStream !== true) throw new Error('capabilities.eventStream missing')
    if (mod.eventTranslation !== 'declared') throw new Error('eventTranslation must be declared')
    if (!Array.isArray(mod.eventMappings) || mod.eventMappings.length === 0) throw new Error('eventMappings missing')
    if (!Array.isArray(mod.sampleEvents) || mod.sampleEvents.length === 0) throw new Error('sampleEvents missing')
    // 2) mock server 语法可解析（import 检查交给 node --check 等价：动态 import 会在启动时才监听端口，这里仅 require 插件 + 语法检查 mock）
    // 3) 翻译层单元行为（从生成文件里拿不到内部函数——用轻量 re-eval 抽取验证）
    const code = require('node:fs').readFileSync(written[0], 'utf8')
    const sandboxRequire = (id) => { if (id === 'node:fs') return fsStub(); if (id === 'node:path') return require('node:path'); throw new Error('unexpected require ' + id) }
    const fnSrc = code.slice(code.indexOf('function toWire'), code.indexOf('// ═══', code.indexOf('function fromSSE')))
    const factory = new Function('require', 'module', 'exports', fnSrc + '; module.exports = { toWire, fromWire, fromSSE, mapFinish }')
    const fakeModule = { exports: {} }
    factory(sandboxRequire, fakeModule, fakeModule.exports)
    const { toWire, fromWire, fromSSE } = fakeModule.exports

    // toWire
    const state = { messages: [{ role: 'system', content: 'sys' }] }
    const wire = toWire({ message: 'hello', sessionID: 's1' }, state, { model: 'm1', stream: false }, { system: 'SYSTEM' })
    if (wire.model !== 'm1' || wire.stream !== false) throw new Error('toWire body invalid')
    if (wire.messages[0].content !== 'SYSTEM') throw new Error('system not injected')
    if (wire.messages[1].content !== 'sys') throw new Error('history lost')
    if (wire.messages[2].role !== 'user' || wire.messages[2].content !== 'hello') throw new Error('user message invalid')

    // fromWire
    const env = fromWire({ choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5 } })
    if (env.parts[0].text !== 'hi' || env.finish !== 'stop' || env.usage.input !== 3 || env.usage.output !== 5) throw new Error('fromWire invalid')

    // fromSSE
    const s1 = fromSSE({ choices: [{ delta: { content: 'he' }, finish_reason: null }] })
    const s2 = fromSSE({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } })
    if (s1.delta !== 'he' || s2.finish !== 'stop' || s2.usage.output !== 2) throw new Error('fromSSE invalid')

    console.log('self-test OK:', written.join(', '))
    return true
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// self-test 里插件的 require('node:fs') 桩（createRuntime 未执行，不会触发文件 IO）
function fsStub() {
  const fs = require('node:fs')
  return new Proxy(fs, { get: (t, k) => (k === 'readFileSync' ? () => '[]' : t[k]) })
}

const args = parseArgs({
  options: {
    name: { type: 'string' },
    baseUrl: { type: 'string', default: 'http://127.0.0.1:9000' },
    model: { type: 'string', default: 'gpt-4o-mini' },
    out: { type: 'string', default: join(homedir(), '.mafw', 'runtime-plugins') },
    preset: { type: 'string' },
    template: { type: 'string', default: 'openai' },
    mock: { type: 'boolean', default: false },
    'self-test': { type: 'boolean', default: false },
    check: { type: 'string' },
    strict: { type: 'boolean', default: false },
  },
})

if (args.values['self-test']) {
  selfTest()
  process.exit(0)
}

if (args.values.check) {
  const dist = join(__dirname, '..', 'gateway', 'dist', 'runtime', 'plugin-check.js')
  let mod
  try {
    mod = require(dist)
  } catch {
    console.error(`plugin-check needs a built gateway (missing ${dist}). Run: cd gateway && npm run build`)
    process.exit(2)
  }
  const report = await mod.runPluginCheck({
    file: resolve(args.values.check),
    preset: args.values.preset,
    strict: args.values.strict,
  })
  console.log(`Plugin: ${report.name ?? '(unnamed)'} — ${report.status}`)
  console.log(`Translation: ${report.translation.mode}`)
  for (const i of report.translation.issues) console.log(`  issue: ${i}`)
  for (const h of report.hard) console.log(`  HARD: ${h}`)
  for (const d of report.downgraded) console.log(`  DOWNGRADED: ${d}`)
  if (report.presetEvaluated) {
    console.log(`Preset ${report.preset}: ${report.presetMissing.length === 0 ? 'complete' : `${report.presetMissing.length} missing`}`)
    if (report.presetMissing.length > 0) console.log(`  missing: ${report.presetMissing.join(', ')}`)
  } else {
    console.log(`Preset ${report.preset}: not evaluated${report.error ? ` (${report.error})` : ''}`)
  }
  process.exit(mod.pluginCheckExitCode(report, args.values.strict))
}

if (args.values.template !== 'openai') {
  console.error(`unknown template '${args.values.template}' (only 'openai' is available)`)
  process.exit(1)
}

if (!args.values.name) {
  console.error('用法: node scripts/generate-runtime-plugin.mjs --name <plugin-name> [--preset core|conversation|autonomous|desktop] [--baseUrl URL] [--model M] [--out DIR] [--mock] [--self-test]')
  console.error('      node scripts/generate-runtime-plugin.mjs --check <plugin.js> [--preset <id>] [--strict]')
  process.exit(1)
}

const { written, envKey } = generate({
  name: args.values.name,
  baseUrl: args.values.baseUrl,
  model: args.values.model,
  outDir: resolve(args.values.out),
  mock: args.values.mock,
  preset: args.values.preset,
})

console.log('已生成:')
for (const f of written) console.log('  ' + f)
console.log(`
激活步骤:
  1. ~/.mafw/config.yaml:
       runtime:
         plugin: ${args.values.name}
         pluginConfig:
           ${args.values.name}:
             baseUrl: "${args.values.baseUrl}"
             apiKey: "sk-xxx"      # 或环境变量 ${envKey}
             model: "${args.values.model}"
             stream: true
  2. curl -X POST http://127.0.0.1:3000/api/runtime/reload
  3. curl -X POST http://127.0.0.1:3000/api/runtime/switch -H 'Content-Type: application/json' -d '{"plugin":"${args.values.name}"}'
  4. curl http://127.0.0.1:3000/api/runtime   # 确认 active 与 plugins[].status=ok
${args.values.mock ? '\n联调: node ' + written[1] + ' 9000   # mock one-api（回显 + 流式）\n' : ''}`)
