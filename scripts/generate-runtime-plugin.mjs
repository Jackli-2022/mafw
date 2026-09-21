#!/usr/bin/env node
/**
 * generate-runtime-plugin.mjs — one-api（OpenAI 兼容）runtime 插件翻译层生成器
 *
 * 生成完整可激活的 MAFW runtime 插件骨架（CJS 单文件），翻译层覆盖：
 *   toWire     — MAFW prompt opts → OpenAI chat/completions 请求体
 *   fromWire   — 非流式响应 → PromptResultEnvelope
 *   fromSSE    — SSE chunk → delta/finish/usage → opencode 兼容事件
 * 附带：记忆接入钩子（obs/capture + recall/pinned）、文件持久化、--mock 联调假服务、--self-test 自检。
 *
 * 用法：
 *   node scripts/generate-runtime-plugin.mjs --name my-runtime [--baseUrl http://localhost:9000] \
 *        [--model my-model] [--out ~/.mafw/runtime-plugins] [--mock] [--self-test]
 */
import { parseArgs } from "node:util"
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir, tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
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
  capabilities: {
    eventStream: true,          // 流式翻译层产出 opencode 兼容事件
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
    sessionStorageApi: false,
    agentConfigApi: false,
  },

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

    // ── 事件流（EventEmitter → AsyncIterable 桥）──
    const listeners = new Set()
    const emitEvent = (type, properties) => {
      const ev = { type, properties, sessionID: properties.sessionID }
      for (const l of listeners) l(ev)
    }

    // ── 单轮执行：toWire → fetch（流式/非流式）→ 事件/信封 ──
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
      if (body.stream) {
        for await (const chunk of parseSSE(res)) {
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
        if (onDelta) onDelta(text)
      }

      sess.messages.push({ role: 'assistant', content: text })
      sess.time = { created: sess.time.created, updated: Date.now() }
      save()
      // 事件契约（3.1）：assistant 正文必须以 text part 进 message.part.updated（trajectory/curator 依赖）
      emitEvent('message.part.updated', {
        sessionID,
        part: { id: 'as_' + Date.now(), sessionID, type: 'text', text, time: { end: Date.now() } },
        delta: text,
      })
      emitEvent('message.updated', {
        sessionID,
        info: { id: 'as_' + Date.now(), sessionID, role: 'assistant', text, time: { completed: Date.now() } },
      })
      emitEvent('session.idle', { sessionID })
      return { parts: [{ type: 'text', text }], finish, usage: usage || {} }
    }

    return {
      name: PLUGIN_NAME,
      capabilities: { eventStream: true },

      session: {
        async create(opts) {
          const id = 'ses_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
          sessions.set(id, {
            id, directory: opts.directory, messages: [],
            title: 'New session', time: { created: Date.now(), updated: Date.now() },
          })
          save()
          emitEvent('session.created', { info: { id, title: 'New session', directory: opts.directory, time: { updated: Date.now() } }, sessionID: id })
          return { id }
        },

        async prompt(opts) {
          mem.capture(opts.sessionID, 'user_input', opts.message || (opts.parts || [])[0]?.text || '')
          return runTurn(opts.sessionID, opts, null)
        },

        async promptAsync(opts) {
          const sessionID = opts.sessionID
          mem.capture(sessionID, 'user_input', opts.message || (opts.parts || [])[0]?.text || '')
          // 异步执行；delta 经事件流推出（stream=true 时逐 chunk，false 时整段）
          runTurn(sessionID, opts, (delta) => {
            emitEvent('message.part.updated', { sessionID, delta, part: { sessionID, type: 'text', text: delta } })
          }).catch((err) => {
            ctx.log.error('[' + PLUGIN_NAME + '] prompt failed: ' + err.message)
            emitEvent('session.error', { sessionID, error: err.message })
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
        async abort({ sessionID }) { emitEvent('session.idle', { sessionID }) },
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
          return {
            stream: (async function* () {
              while (true) {
                const ev = await new Promise((resolveListener) => {
                  const l = (e) => { listeners.delete(l); resolveListener(e) }
                  listeners.add(l)
                })
                yield ev
              }
            })(),
          }
        },
      },

      provider: {
        async list() {
          return { all: [PLUGIN_NAME], connected: [PLUGIN_NAME], default: { chat: cfg.model || '__MODEL__' } }
        },
      },
      app: { async agents() { return [] } },
      config: { async get() { return cfg }, async update(c) { return c } },
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
    req.on('close', () => clearInterval(timer))
  })
}).listen(port, () => console.log('mock one-api listening on http://127.0.0.1:' + port))
`

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────
function fill(template, values) {
  let out = template
  for (const [k, v] of Object.entries(values)) out = out.replaceAll(k, v)
  return out
}

function generate({ name, baseUrl, model, outDir, mock }) {
  const envKey = name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'
  const values = {
    '__NAME__': name,
    '__BASEURL__': baseUrl,
    '__MODEL__': model,
    '__ENVKEY__': envKey,
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
    mock: { type: 'boolean', default: false },
    'self-test': { type: 'boolean', default: false },
  },
})

if (args.values['self-test']) {
  selfTest()
  process.exit(0)
}

if (!args.values.name) {
  console.error('用法: node scripts/generate-runtime-plugin.mjs --name <plugin-name> [--baseUrl URL] [--model M] [--out DIR] [--mock] [--self-test]')
  process.exit(1)
}

const { written, envKey } = generate({
  name: args.values.name,
  baseUrl: args.values.baseUrl,
  model: args.values.model,
  outDir: resolve(args.values.out),
  mock: args.values.mock,
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
