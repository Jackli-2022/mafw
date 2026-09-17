# 语音管道重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将桌面语音链路重构为 UI 无关的 VoiceSession 核心（VadAnalyzer/TurnStopStrategy/AudioWorkletPlayer 三层可换），gateway TTS 改造为可插拔引擎注册表（mimo + kokoro 双内置 + 插件目录），并打通 barge-in → gateway 取消在途合成的打断传播。

**Architecture:** 设计文档 `docs/superpowers/specs/2026-09-17-voice-pipeline-refactor-design.md`。Gateway 侧：`TtsEngineRegistry`（包 > legacy > 内置优先级）+ 句切分伪流式适配层 + `POST /api/tts/interrupt`。Desktop 侧：`renderer/mafw/voice/` 纯 TS 模块，ChatPane 只留绑定层。

**Tech Stack:** gateway: TypeScript CJS + jest；desktop: SolidJS + bun test；kokoro-js（ESM，经 `new Function('spec','return import(spec)')` 桥，同 pi-adapter）；AudioWorklet（Electron Chromium）。

## Global Constraints

- gateway HTTP 路由正则必须带 `(?:\?|$)` 锚定，query string 才能匹配（AGENTS.md §6.5 教训）
- 新增路由必须登记 `gateway/src/routes/route-catalog.ts` 并跑 `npm run emit:openapi`（gateway 目录内）同步契约 + SDK
- 所有 spawn 子进程必须显式 `windowsHide: true`（detached 环境黑窗事故教训）
- 插件/引擎加载一律 fail-open：坏插件记 error 状态，不影响内置引擎
- gateway 测试：`cd gateway && npx jest <file> --runInBand`；desktop 测试：`cd packages/desktop && bun test <file>`
- TDD：每个任务先写失败测试 → 验证失败 → 实现 → 验证通过 → commit
- AudioWorklet 播放器不做 BufferSource 回退（spec 决策：显式报错）
- 行为等价：重构后用户可感知行为与现状一致（分段录音/流式播报/barge-in/自动播放去重）

---

### Task 1: Gateway TTS 引擎类型 + 注册表

**Files:**
- Create: `gateway/src/tts/types.ts`
- Create: `gateway/src/tts/registry.ts`
- Test: `gateway/tests/unit/tts-registry.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `TtsCapabilities { streaming: 'native'|'none'; voiceCloning: boolean; styleControl: boolean; languages: string[]; sampleRate: number }`
  - `TtsOpts { voice?: string; style?: string; speed?: number; lang?: string; refAudio?: { path: string; text?: string } }`
  - `PcmChunk { pcm: Buffer; sampleRate: number }`
  - `TtsEngine { name: string; capabilities: TtsCapabilities; voices(): TtsVoice[]; synthesizeStream(text, opts, signal): AsyncIterable<PcmChunk>; synthesize(text, opts): Promise<Buffer> }`
  - `TtsVoice { id: string; label: string; lang: string }`
  - `class TtsEngineRegistry { registerBuiltin(e); setLegacyEngines(es); setPackageEngines(es); resolve(name?): TtsEngine; list(): {name, capabilities, source}[] }`

- [ ] **Step 1: 写类型文件**

`gateway/src/tts/types.ts`：

```typescript
/** TTS 引擎能力声明 —— 缺省字段视为不支持（fail-open 哲学）。 */
export interface TtsCapabilities {
  /** native=边生成边出块；none=只支持整段，走句切分适配层 */
  streaming: 'native' | 'none';
  voiceCloning: boolean;
  styleControl: boolean;
  languages: string[];
  /** 引擎原生采样率（22.05k/24k/32-48k 并存，不强写 24k） */
  sampleRate: number;
}

export interface TtsOpts {
  voice?: string;
  style?: string;
  speed?: number;
  lang?: string;
  /** 声音克隆参考音频（预留；不支持的引擎忽略） */
  refAudio?: { path: string; text?: string };
}

export interface TtsVoice {
  id: string;
  label: string;
  lang: string;
}

export interface PcmChunk {
  pcm: Buffer;
  sampleRate: number;
}

export interface TtsEngine {
  name: string;
  capabilities: TtsCapabilities;
  voices(): TtsVoice[];
  synthesizeStream(text: string, opts: TtsOpts, signal: AbortSignal): AsyncIterable<PcmChunk>;
  /** 整段 wav（兜底路径） */
  synthesize(text: string, opts: TtsOpts): Promise<Buffer>;
}
```

- [ ] **Step 2: 写失败测试**

`gateway/tests/unit/tts-registry.test.ts`：

```typescript
import { TtsEngineRegistry } from '../../src/tts/registry';
import type { TtsCapabilities, TtsEngine, PcmChunk } from '../../src/tts/types';

const caps = (over: Partial<TtsCapabilities> = {}): TtsCapabilities => ({
  streaming: 'native', voiceCloning: false, styleControl: false,
  languages: ['zh'], sampleRate: 24000, ...over,
});

function fakeEngine(name: string): TtsEngine {
  return {
    name,
    capabilities: caps(),
    voices: () => [{ id: 'v1', label: 'V1', lang: 'zh' }],
    async *synthesizeStream(): AsyncIterable<PcmChunk> { /* empty */ },
    async synthesize(): Promise<Buffer> { return Buffer.from('wav'); },
  };
}

describe('TtsEngineRegistry', () => {
  test('resolve returns builtin by name', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('mimo'));
    expect(reg.resolve('mimo').name).toBe('mimo');
  });

  test('resolve with no name returns default engine (mimo)', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('mimo'));
    expect(reg.resolve().name).toBe('mimo');
  });

  test('unknown engine falls back to default with warn flag', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('mimo'));
    const e = reg.resolve('nonexistent');
    expect(e.name).toBe('mimo');
  });

  test('resolve throws when no engine registered at all', () => {
    const reg = new TtsEngineRegistry();
    expect(() => reg.resolve()).toThrow(/no tts engine/i);
  });

  test('priority: package > legacy > builtin on same name', () => {
    const reg = new TtsEngineRegistry();
    const b = fakeEngine('x'); b.voices = () => [{ id: 'b', label: 'builtin', lang: 'zh' }];
    const l = fakeEngine('x'); l.voices = () => [{ id: 'l', label: 'legacy', lang: 'zh' }];
    const p = fakeEngine('x'); p.voices = () => [{ id: 'p', label: 'pkg', lang: 'zh' }];
    reg.registerBuiltin(b);
    reg.setLegacyEngines([l]);
    expect(reg.resolve('x').voices()[0].label).toBe('legacy');
    reg.setPackageEngines([p]);
    expect(reg.resolve('x').voices()[0].label).toBe('pkg');
  });

  test('list reports source for each engine', () => {
    const reg = new TtsEngineRegistry();
    reg.registerBuiltin(fakeEngine('mimo'));
    reg.setLegacyEngines([fakeEngine('custom')]);
    const list = reg.list();
    expect(list.find(e => e.name === 'mimo')?.source).toBe('builtin');
    expect(list.find(e => e.name === 'custom')?.source).toBe('legacy');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/tts-registry.test.ts --runInBand`
Expected: FAIL（`../../src/tts/registry` 不存在）

- [ ] **Step 4: 实现注册表**

`gateway/src/tts/registry.ts`：

```typescript
import { log } from '../core/utils/logger';
import type { TtsCapabilities, TtsEngine } from './types';

export const DEFAULT_ENGINE = 'mimo';

export class TtsEngineRegistry {
  private builtin = new Map<string, TtsEngine>();
  private legacy = new Map<string, TtsEngine>();
  private pkg = new Map<string, TtsEngine>();

  registerBuiltin(engine: TtsEngine): void {
    this.builtin.set(engine.name, engine);
  }

  setLegacyEngines(engines: TtsEngine[]): void {
    this.legacy = new Map(engines.map(e => [e.name, e]));
  }

  setPackageEngines(engines: TtsEngine[]): void {
    this.pkg = new Map(engines.map(e => [e.name, e]));
  }

  /** 优先级：包 > legacy > 内置。未知名回退默认引擎 + warn。 */
  resolve(name?: string): TtsEngine {
    const want = name || DEFAULT_ENGINE;
    const found = this.pkg.get(want) ?? this.legacy.get(want) ?? this.builtin.get(want);
    if (found) return found;
    const fallback = this.pkg.get(DEFAULT_ENGINE) ?? this.legacy.get(DEFAULT_ENGINE) ?? this.builtin.get(DEFAULT_ENGINE);
    if (!fallback) throw new Error(`no tts engine registered (want: ${want})`);
    log.warn(`[TTS] unknown engine "${want}", falling back to ${DEFAULT_ENGINE}`);
    return fallback;
  }

  list(): { name: string; capabilities: TtsCapabilities; source: 'builtin' | 'legacy' | 'package' }[] {
    const merged = new Map<string, { engine: TtsEngine; source: 'builtin' | 'legacy' | 'package' }>();
    for (const [n, e] of this.builtin) merged.set(n, { engine: e, source: 'builtin' });
    for (const [n, e] of this.legacy) merged.set(n, { engine: e, source: 'legacy' });
    for (const [n, e] of this.pkg) merged.set(n, { engine: e, source: 'package' });
    return [...merged.values()].map(({ engine, source }) => ({
      name: engine.name, capabilities: engine.capabilities, source,
    }));
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/tts-registry.test.ts --runInBand`
Expected: PASS（6 tests）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/tts/types.ts gateway/src/tts/registry.ts gateway/tests/unit/tts-registry.test.ts
git commit -m "feat(gateway): TTS engine types + registry with package>legacy>builtin priority"
```

---

### Task 2: 句切分伪流式适配层

**Files:**
- Create: `gateway/src/tts/sentence-adapter.ts`
- Test: `gateway/tests/unit/tts-sentence-adapter.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `TtsEngine/TtsOpts/PcmChunk`
- Produces:
  - `splitSentences(text: string, maxLen?: number): string[]`
  - `adaptToStream(engine: TtsEngine, text: string, opts: TtsOpts, signal: AbortSignal): AsyncIterable<PcmChunk>` — 从整段 wav 提取 PCM（剥 44 字节 RIFF 头）按句 yield

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/tts-sentence-adapter.test.ts`：

```typescript
import { splitSentences, adaptToStream } from '../../src/tts/sentence-adapter';
import type { TtsEngine, TtsCapabilities } from '../../src/tts/types';

describe('splitSentences', () => {
  test('splits on Chinese and English sentence punctuation', () => {
    expect(splitSentences('你好。世界！再见？ok.')).toEqual(['你好。', '世界！', '再见？', 'ok.']);
  });

  test('keeps text without punctuation as one sentence', () => {
    expect(splitSentences('没有标点的一段话')).toEqual(['没有标点的一段话']);
  });

  test('splits overly long sentence at maxLen boundary', () => {
    const long = '啊'.repeat(250);
    const parts = splitSentences(long, 100);
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(100);
  });

  test('trims whitespace and drops empty segments', () => {
    expect(splitSentences('  你好。  \n 世界。  ')).toEqual(['你好。', '世界。']);
  });
});

function wavBuffer(pcmBytes: number): Buffer {
  const buf = Buffer.alloc(44 + pcmBytes);
  buf.write('RIFF', 0); buf.write('WAVE', 8); // 其余字段本测试不关心
  return buf;
}

const capsNone: TtsCapabilities = {
  streaming: 'none', voiceCloning: false, styleControl: false, languages: ['zh'], sampleRate: 22050,
};

describe('adaptToStream', () => {
  test('yields one PCM chunk per sentence with engine sampleRate', async () => {
    const calls: string[] = [];
    const engine: TtsEngine = {
      name: 'fake', capabilities: capsNone,
      voices: () => [],
      async synthesize(text: string) { calls.push(text); return wavBuffer(100); },
      async *synthesizeStream() { throw new Error('not streaming'); },
    };
    const chunks: { pcm: Buffer; sampleRate: number }[] = [];
    for await (const c of adaptToStream(engine, '第一句。第二句！', {}, new AbortController().signal)) {
      chunks.push(c);
    }
    expect(calls).toEqual(['第一句。', '第二句！']);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].sampleRate).toBe(22050);
    expect(chunks[0].pcm.length).toBe(100);
  });

  test('stops early when signal aborted', async () => {
    const ctrl = new AbortController();
    const engine: TtsEngine = {
      name: 'fake', capabilities: capsNone,
      voices: () => [],
      async synthesize() { ctrl.abort(); return wavBuffer(10); },
      async *synthesizeStream() { throw new Error('x'); },
    };
    const chunks: unknown[] = [];
    for await (const c of adaptToStream(engine, '一。二。三。', {}, ctrl.signal)) chunks.push(c);
    expect(chunks.length).toBeLessThan(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/tts-sentence-adapter.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`gateway/src/tts/sentence-adapter.ts`：

```typescript
import type { PcmChunk, TtsEngine, TtsOpts } from './types';

const SENTENCE_RE = /[^。！？!?\.…\n]+[。！？!?\.…]*\s*/g;
const DEFAULT_MAX_LEN = 100;

/** 中英文句切分：按标点切，超长句按 maxLen 硬切。 */
export function splitSentences(text: string, maxLen = DEFAULT_MAX_LEN): string[] {
  const out: string[] = [];
  const matches = text.match(SENTENCE_RE) ?? [];
  for (const raw of matches) {
    let s = raw.trim();
    while (s.length > maxLen) {
      out.push(s.slice(0, maxLen));
      s = s.slice(maxLen);
    }
    if (s) out.push(s);
  }
  return out;
}

/** 剥 RIFF 头取 PCM 体（wav 标准 44 字节头；data chunk 偏移简单兜底）。 */
function wavToPcm(wav: Buffer): Buffer {
  if (wav.length > 44 && wav.toString('ascii', 0, 4) === 'RIFF') {
    return wav.subarray(44);
  }
  return wav;
}

/**
 * 伪流式适配：streaming='none' 的引擎按句 synthesize 后立即 yield，
 * 对外统一 AsyncIterable<PcmChunk> 流式语义。
 */
export async function* adaptToStream(
  engine: TtsEngine,
  text: string,
  opts: TtsOpts,
  signal: AbortSignal,
): AsyncIterable<PcmChunk> {
  const sentences = splitSentences(text);
  for (const s of sentences) {
    if (signal.aborted) return;
    const wav = await engine.synthesize(s, opts);
    if (signal.aborted) return;
    yield { pcm: wavToPcm(wav), sampleRate: engine.capabilities.sampleRate };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/tts-sentence-adapter.test.ts --runInBand`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/tts/sentence-adapter.ts gateway/tests/unit/tts-sentence-adapter.test.ts
git commit -m "feat(gateway): sentence-splitting adapter unifying non-streaming TTS engines to AsyncIterable<PcmChunk>"
```

---

### Task 3: mimo 内置引擎 + 路由改走注册表 + SSE 采样率头

**Files:**
- Create: `gateway/src/tts/mimo-engine.ts`
- Modify: `gateway/src/index.ts:2598-2622`（/api/tts）、`gateway/src/index.ts:2575-2596`（/api/tts/voices）、`gateway/src/index.ts:2843-2877`（/api/tts/stream）
- Test: `gateway/tests/unit/tts-mimo-engine.test.ts`

**Interfaces:**
- Consumes: Task 1 registry、Task 2 adapter、现有 `createTtsService`（`gateway/src/media/tts-service.ts`）
- Produces: `createMimoEngine(deps): TtsEngine`（deps 同 createTtsService）；index.ts 出现 `this.ttsRegistry: TtsEngineRegistry` 与 `this.ttsInflight: Map<string, Set<AbortController>>`（Task 4 消费）

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/tts-mimo-engine.test.ts`：

```typescript
import { createMimoEngine } from '../../src/tts/mimo-engine';

function sseBody(lines: string[]): Response {
  const text = lines.map(l => `data: ${l}\n\n`).join('');
  return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  }), { status: 200 });
}

describe('mimo engine', () => {
  test('capabilities declare native streaming at 24kHz with style control', () => {
    const engine = createMimoEngine({ config: () => ({}) , authPath: '/nonexistent' });
    expect(engine.name).toBe('mimo');
    expect(engine.capabilities.streaming).toBe('native');
    expect(engine.capabilities.sampleRate).toBe(24000);
    expect(engine.capabilities.styleControl).toBe(true);
  });

  test('synthesizeStream yields PcmChunk buffers decoded from base64 SSE deltas', async () => {
    process.env.XIAOMI_API_KEY = 'test-key'; // getProviderApiKey 环境变量优先链
    const pcm = Buffer.from([1, 0, 2, 0]); // 2 个 int16 sample
    const b64 = pcm.toString('base64');
    const fetchImpl = async () => sseBody([
      JSON.stringify({ choices: [{ delta: { audio: { data: b64 } } }] }),
      '[DONE]',
    ]) as any;
    const engine = createMimoEngine({ config: () => ({}), fetchImpl: fetchImpl as any });
    const chunks: { pcm: Buffer; sampleRate: number }[] = [];
    for await (const c of engine.synthesizeStream('你好', {}, new AbortController().signal)) chunks.push(c);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pcm.equals(pcm)).toBe(true);
    expect(chunks[0].sampleRate).toBe(24000);
    delete process.env.XIAOMI_API_KEY;
  });

  test('synthesize returns wav buffer from base64 data url payload', async () => {
    process.env.XIAOMI_API_KEY = 'test-key';
    const wav = Buffer.from('RIFF....WAVEfmt fake');
    const fetchImpl = async () => new Response(JSON.stringify({
      choices: [{ message: { audio: { data: wav.toString('base64') } } }],
    }), { status: 200 }) as any;
    const engine = createMimoEngine({ config: () => ({}), fetchImpl: fetchImpl as any });
    const out = await engine.synthesize('你好', {});
    expect(out.equals(wav)).toBe(true);
    delete process.env.XIAOMI_API_KEY;
  });
});
```

> 注：先确认 `getProviderApiKey`（`gateway/src/runtime/auth.ts`）是否支持 `process.env.XIAOMI_API_KEY` 之类的环境变量回退；若不支持，测试改用临时 authPath 写一个 `{"xiaomi":{"key":"test-key"}}` JSON 文件。以实际实现为准调整测试夹具。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/tts-mimo-engine.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 mimo 引擎（包装现有 tts-service，不改其行为）**

`gateway/src/tts/mimo-engine.ts`：

```typescript
import { createTtsService, TTS_VOICES } from '../media/tts-service';
import type { RuntimeCredentials } from '../runtime/contract';
import type { PcmChunk, TtsEngine, TtsOpts } from './types';

/**
 * mimo 内置引擎：MiMo-V2.5-TTS（云，小米 OpenAI 兼容端点）。
 * 行为与原 tts-service 完全一致，仅适配 TtsEngine 接口。
 */
export function createMimoEngine(deps: {
  authPath?: string;
  provider?: string;
  config: () => { media?: { tts?: { baseUrl?: string; model?: string; defaultVoice?: string }; provider?: string } };
  fetchImpl?: typeof fetch;
  credentials?: RuntimeCredentials;
}): TtsEngine {
  const svc = createTtsService(deps);
  return {
    name: 'mimo',
    capabilities: {
      streaming: 'native',
      voiceCloning: true,   // mimo-v2.5-tts-voiceclone 模型存在；refAudio 适配后续做
      styleControl: true,
      languages: ['zh', 'en'],
      sampleRate: 24000,
    },
    voices: () => TTS_VOICES,
    async *synthesizeStream(text: string, opts: TtsOpts, signal: AbortSignal): AsyncIterable<PcmChunk> {
      const gen = svc.synthesizeStream({ text, voice: opts.voice, style: opts.style }, { signal });
      for await (const chunk of gen) {
        if (signal.aborted) return;
        yield { pcm: Buffer.from(chunk.data, 'base64'), sampleRate: 24000 };
      }
    },
    async synthesize(text: string, opts: TtsOpts): Promise<Buffer> {
      const r = await svc.synthesize({ text, voice: opts.voice, style: opts.style });
      const b64 = r.audioDataUrl.split(',')[1] || '';
      return Buffer.from(b64, 'base64');
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/tts-mimo-engine.test.ts --runInBand`
Expected: PASS（3 tests）

- [ ] **Step 5: index.ts 接线注册表并改写三条路由**

在 `gateway/src/index.ts`：

1. import 区加：

```typescript
import { TtsEngineRegistry } from './tts/registry';
import { createMimoEngine } from './tts/mimo-engine';
import { adaptToStream } from './tts/sentence-adapter';
```

2. 类成员加（放在 `private ttsService` 声明旁）：

```typescript
private ttsRegistry = new TtsEngineRegistry();
private ttsInflight = new Map<string, Set<AbortController>>(); // sessionId → 在途合成
```

3. 在 `initServices()` 里 `createTtsService` 调用之后加：

```typescript
this.ttsRegistry.registerBuiltin(createMimoEngine({
  config: () => config.raw as any,
  credentials: this.runtime?.credentials?.(),
}));
```

> 以 initServices 中 ttsService 实际的 deps 为准（authPath/fetchImpl 原样照搬）。

4. `/api/tts/voices` 整段替换为（保持响应字段向后兼容，新增 engine/capabilities）：

```typescript
        // GET /api/tts/voices — 当前引擎音色 + 能力（desktop picker）
        if (req.url === "/api/tts/voices" && req.method === "GET") {
          try {
            const ttsCfg = (config.raw as any)?.media?.tts ?? {};
            const engine = this.ttsRegistry.resolve(ttsCfg.engine);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              voices: engine.voices(),
              engine: engine.name,
              capabilities: engine.capabilities,
              engines: this.ttsRegistry.list().map(e => ({ name: e.name, source: e.source })),
              models: [
                { id: 'mimo-v2.5-tts', description: '预置音色语音合成（支持唱歌模式）' },
                { id: 'mimo-v2.5-tts-voicedesign', description: '文本描述定制音色' },
                { id: 'mimo-v2.5-tts-voiceclone', description: '音频样本复刻音色' },
              ],
              defaultVoice: ttsCfg.defaultVoice || '茉莉',
              defaultModel: ttsCfg.model || 'mimo-v2.5-tts',
            }));
          } catch (err: any) {
            res.writeHead(502);
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
          return;
        }
```

5. `/api/tts` 的 `this.ttsService.synthesize(...)` 一行改为走注册表（响应形状不变）：

```typescript
            const ttsCfg = (config.raw as any)?.media?.tts ?? {};
            const engine = this.ttsRegistry.resolve(ttsCfg.engine);
            const wav = await engine.synthesize(text, { voice, style });
            const artifactId = this.mediaAgent.putArtifact(`data:audio/wav;base64,${wav.toString('base64')}`);
```

（其后 res.end 的 `voice` 字段改用 `voice || ttsCfg.defaultVoice || '茉莉'`，`mime: 'audio/wav'`。）

6. `/api/tts/stream` 整段替换（加 sampleRate 响应头 + sessionId 登记 + 非流式引擎走适配层）：

```typescript
        // POST /api/tts/stream — 流式 TTS（SSE，PCM16 mono 分块）。
        // 响应头 x-tts-sample-rate 声明引擎采样率；
        // 每块：data: {"data":"<base64 pcm16>","voice":"<voice>"}\n\n；结束：data: {"done":true}
        // body.sessionId 可选：登记在途合成，供 /api/tts/interrupt 取消。
        if (req.url === "/api/tts/stream" && req.method === "POST") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          const body = JSON.parse(await readBody(req));
          const text = typeof body?.text === 'string' ? body.text : '';
          if (!text.trim()) { res.writeHead(400); res.end(JSON.stringify({ error: 'text is required' })); return; }
          const voice = typeof body?.voice === 'string' ? body.voice : undefined;
          const style = typeof body?.style === 'string' ? body.style : undefined;
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
          try {
            const ttsCfg = (config.raw as any)?.media?.tts ?? {};
            const engine = this.ttsRegistry.resolve(ttsCfg.engine);
            const abort = new AbortController();
            req.on('close', () => abort.abort());
            if (sessionId) {
              let set = this.ttsInflight.get(sessionId);
              if (!set) { set = new Set(); this.ttsInflight.set(sessionId, set); }
              set.add(abort);
              res.on('close', () => { set.delete(abort); if (set.size === 0) this.ttsInflight.delete(sessionId); });
            }
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'x-tts-sample-rate': String(engine.capabilities.sampleRate),
            });
            const gen = engine.capabilities.streaming === 'native'
              ? engine.synthesizeStream(text, { voice, style }, abort.signal)
              : adaptToStream(engine, text, { voice, style }, abort.signal);
            for await (const chunk of gen) {
              if (abort.signal.aborted) break;
              res.write(`data: ${JSON.stringify({ data: chunk.pcm.toString('base64'), voice: voice || ttsCfg.defaultVoice || '茉莉' })}\n\n`);
            }
            if (!abort.signal.aborted) res.write('data: {"done":true}\n\n');
            res.end();
          } catch (err: any) {
            if (!res.headersSent) {
              res.writeHead(502);
              res.end(JSON.stringify({ error: err?.message || String(err) }));
            } else {
              res.write(`data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`);
              res.end();
            }
          }
          return;
        }
```

- [ ] **Step 6: 验证编译 + 全量 gateway 测试无回归**

Run: `cd gateway && npx tsc --noEmit && npx jest --runInBand`
Expected: 编译过；既有测试全绿（tts 相关无单测依赖旧路由内联逻辑）

- [ ] **Step 7: Commit**

```bash
git add gateway/src/tts/mimo-engine.ts gateway/src/index.ts gateway/tests/unit/tts-mimo-engine.test.ts
git commit -m "feat(gateway): mimo as builtin TtsEngine; tts routes resolve via registry; SSE x-tts-sample-rate header"
```

---

### Task 4: `POST /api/tts/interrupt` 打断端点 + 契约 + SDK

**Files:**
- Create: `gateway/src/routes/tts-interrupt.ts`
- Modify: `gateway/src/index.ts`（内联路由，紧跟 /api/tts/stream 之后）
- Modify: `gateway/src/routes/route-catalog.ts:104-106`（tts 段加一行）
- Modify: `packages/gateway-sdk/src/client.ts:864-890`（tts namespace 加 interrupt）
- Test: `gateway/tests/unit/tts-interrupt.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `this.ttsInflight`
- Produces: HTTP `POST /api/tts/interrupt { sessionId } → { ok: true, cancelled: number }`；SDK `client.tts.interrupt(sessionId: string): Promise<{ ok: boolean; cancelled: number }>`

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/tts-interrupt.test.ts`：

```typescript
import { handleTtsInterrupt } from '../../src/routes/tts-interrupt';
import { Readable } from 'stream';

function fakeReq(body: unknown): any {
  const r = new Readable({ read() { this.push(JSON.stringify(body)); this.push(null); } });
  (r as any).headers = {};
  return r;
}

function fakeRes(): any {
  const out: any = { status: 0, body: '', headers: {} as Record<string, string> };
  out.setHeader = (k: string, v: string) => { out.headers[k] = v; };
  out.writeHead = (s: number) => { out.status = s; return out; };
  out.end = (b?: string) => { out.body = b ?? ''; };
  return out;
}

describe('POST /api/tts/interrupt', () => {
  test('aborts all inflight syntheses for the session and reports count', async () => {
    const inflight = new Map<string, Set<AbortController>>();
    const c1 = new AbortController(); const c2 = new AbortController();
    inflight.set('s1', new Set([c1, c2]));
    const res = fakeRes();
    await handleTtsInterrupt(fakeReq({ sessionId: 's1' }), res, { inflight });
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(inflight.has('s1')).toBe(false);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, cancelled: 2 });
  });

  test('unknown sessionId returns cancelled: 0', async () => {
    const res = fakeRes();
    await handleTtsInterrupt(fakeReq({ sessionId: 'nope' }), res, { inflight: new Map() });
    expect(JSON.parse(res.body)).toEqual({ ok: true, cancelled: 0 });
  });

  test('missing sessionId → 400', async () => {
    const res = fakeRes();
    await handleTtsInterrupt(fakeReq({}), res, { inflight: new Map() });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/tts-interrupt.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现路由模块（deps 注入，与其他 routes/ 同款）**

`gateway/src/routes/tts-interrupt.ts`：

```typescript
import type { IncomingMessage, ServerResponse } from 'http';

export interface TtsInterruptDeps {
  inflight: Map<string, Set<AbortController>>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/** POST /api/tts/interrupt — barge-in：取消该 session 全部在途 TTS 合成。 */
export async function handleTtsInterrupt(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TtsInterruptDeps,
): Promise<void> {
  let sessionId = '';
  try {
    const body = JSON.parse(await readBody(req));
    sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  } catch { /* fallthrough → 400 */ }
  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'sessionId is required' }));
    return;
  }
  const set = deps.inflight.get(sessionId);
  const cancelled = set?.size ?? 0;
  if (set) {
    for (const c of set) { try { c.abort(); } catch { /* ignore */ } }
    deps.inflight.delete(sessionId);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, cancelled }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/tts-interrupt.test.ts --runInBand`
Expected: PASS（3 tests）

- [ ] **Step 5: index.ts 内联接线（紧跟 /api/tts/stream 路由之后）**

```typescript
        // POST /api/tts/interrupt — barge-in 打断：取消 session 在途 TTS 合成
        if (req.url === "/api/tts/interrupt" && req.method === "POST") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          await handleTtsInterrupt(req, res, { inflight: this.ttsInflight });
          return;
        }
```

（import 区加 `import { handleTtsInterrupt } from './routes/tts-interrupt';`）

- [ ] **Step 6: route-catalog + OpenAPI + SDK**

`gateway/src/routes/route-catalog.ts` 在 tts 段加：

```typescript
  { method: 'POST', path: '/api/tts/interrupt', operationId: 'tts.interrupt', tags: ['tts'] },
```

然后重新生成契约：`cd gateway && npm run emit:openapi`，再 `cd packages/gateway-sdk && npm run codegen`（若该包有 codegen 脚本；否则按其 api-schema.gen.ts 的生成说明执行——先 `node -e "console.log(require('./packages/gateway-sdk/package.json').scripts)"` 确认）。

SDK `packages/gateway-sdk/src/client.ts` tts namespace 内加：

```typescript
    interrupt: async (sessionId: string): Promise<{ ok: boolean; cancelled: number }> => {
      const res = await this.fetchPath(`/api/tts/interrupt`, {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      return res as { ok: boolean; cancelled: number };
    },
```

> 以 tts namespace 现有方法的 fetchPath 调用风格为准对齐（看 client.ts:866-890 现状微调）。

- [ ] **Step 7: 验证**

Run: `cd gateway && npx tsc --noEmit && npx jest --runInBand`；`cd packages/gateway-sdk && npm test`（或该包测试命令）
Expected: 全绿；若有 contract drift 测试，确认 /api/tts/interrupt 双向一致

- [ ] **Step 8: Commit**

```bash
git add gateway/src/routes/tts-interrupt.ts gateway/src/index.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/tts-interrupt.test.ts packages/gateway-sdk contract
git commit -m "feat(gateway): POST /api/tts/interrupt cancels inflight synthesis per session (barge-in propagation)"
```

> `contract` 路径以 emit:openapi 实际输出位置为准（git status 查看再 add）。

---

### Task 5: tts-plugins legacy 目录加载器 + 统一插件包 tts 贡献类型

**Files:**
- Create: `gateway/src/tts/tts-plugin-loader.ts`
- Modify: `gateway/src/plugins/package-types.ts:41-48`（PluginContributions 加 tts）
- Modify: `gateway/src/plugins/package-host.ts`（激活 tts 贡献 → `TtsEngineRegistry.setPackageEngines`）
- Modify: `gateway/src/index.ts`（initServices 实例化 loader + PluginHost 接线）
- Test: `gateway/tests/unit/tts-plugin-loader.test.ts`

**Interfaces:**
- Consumes: Task 1 registry/types
- Produces:
  - `class TtsPluginLoader { init(); reload(); stop(); getEngines(): TtsEngine[]; getState(): TtsPluginState[] }`（扫描 `~/.mafw/tts-plugins/*.js`，fs.watch 热载，fail-open）
  - 插件模块形状：`module.exports = { name, capabilities?, voices(), async synthesize(text, opts, ctx) → Buffer(wav), async *synthesizeStream?(text, opts, ctx, signal) → PcmChunk }`
  - `TtsContributionSpec`（package-types）：`{ name?, capabilities: TtsCapabilities, voices(): TtsVoice[], synthesize(ctx, text, opts): Promise<Buffer>, synthesizeStream?(ctx, text, opts, signal): AsyncIterable<PcmChunk> }`

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/tts-plugin-loader.test.ts`：

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TtsPluginLoader } from '../../src/tts/tts-plugin-loader';

function writePlugin(dir: string, file: string, content: string): void {
  fs.writeFileSync(path.join(dir, file), content);
}

const VALID_PLUGIN = `
module.exports = {
  name: 'fake-tts',
  capabilities: { streaming: 'none', voiceCloning: false, styleControl: false, languages: ['zh'], sampleRate: 22050 },
  voices() { return [{ id: 'a', label: 'A', lang: 'zh' }]; },
  async synthesize() { return Buffer.from('RIFF-fake'); },
};
`;

describe('TtsPluginLoader', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttsplug-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('loads valid plugin as TtsEngine', async () => {
    writePlugin(dir, 'fake.js', VALID_PLUGIN);
    const loader = new TtsPluginLoader(dir);
    await loader.init();
    loader.stop();
    const engines = loader.getEngines();
    expect(engines).toHaveLength(1);
    expect(engines[0].name).toBe('fake-tts');
    expect(engines[0].capabilities.sampleRate).toBe(22050);
    expect(engines[0].voices()[0].id).toBe('a');
  });

  test('invalid plugin (missing synthesize) → error state, no throw', async () => {
    writePlugin(dir, 'bad.js', `module.exports = { name: 'bad' };`);
    const loader = new TtsPluginLoader(dir);
    await loader.init();
    loader.stop();
    expect(loader.getEngines()).toHaveLength(0);
    expect(loader.getState()[0].status).toBe('error');
  });

  test('plugin throwing on require → error state, loader survives', async () => {
    writePlugin(dir, 'boom.js', `throw new Error('boom');`);
    const loader = new TtsPluginLoader(dir);
    await loader.init();
    loader.stop();
    expect(loader.getState()[0].status).toBe('error');
    expect(loader.getState()[0].error).toMatch(/boom/);
  });

  test('plugin ctx provides fetch/log/pluginConfig/apiKey', async () => {
    writePlugin(dir, 'ctx.js', `
      module.exports = {
        name: 'ctx-probe',
        capabilities: { streaming: 'none', voiceCloning: false, styleControl: false, languages: [], sampleRate: 24000 },
        voices() { return []; },
        async synthesize(text, opts, ctx) {
          if (typeof ctx.fetch !== 'function') throw new Error('no fetch');
          if (typeof ctx.pluginConfig !== 'function') throw new Error('no pluginConfig');
          return Buffer.from('ok');
        },
      };
    `);
    const loader = new TtsPluginLoader(dir);
    await loader.init();
    loader.stop();
    const e = loader.getEngines()[0];
    const out = await e.synthesize('hi', {});
    expect(out.toString()).toBe('ok');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/tts-plugin-loader.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现加载器（镜像 MediaPluginLoader 模式）**

`gateway/src/tts/tts-plugin-loader.ts`：

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import type { TtsCapabilities, TtsEngine, TtsOpts, TtsVoice, PcmChunk } from './types';

export interface TtsPluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
}

interface TtsPluginCtx {
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  log: typeof log;
  pluginConfig: () => Record<string, any>;
  apiKey: (provider: string) => string | null;
}

const DEFAULT_CAPS: TtsCapabilities = {
  streaming: 'none', voiceCloning: false, styleControl: false, languages: ['zh'], sampleRate: 24000,
};

/**
 * ~/.mafw/tts-plugins/*.js 加载器（CJS 模块，fail-open）。
 * 模块形状：{ name, capabilities?, voices(), synthesize(text,opts,ctx)→Buffer, synthesizeStream?(text,opts,ctx,signal)→AsyncIterable<PcmChunk> }
 */
export class TtsPluginLoader {
  private state = new Map<string, TtsPluginState>();
  private engines = new Map<string, TtsEngine>();
  private watcher?: fs.FSWatcher;
  private debounceTimer?: NodeJS.Timeout;

  constructor(
    private pluginsDir: string,
    private makeCtx?: (name: string) => TtsPluginCtx,
  ) {}

  async init(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(this.pluginsDir, 'README.md'), README_CONTENT);
    }
    await this.scan();
    this.startWatch();
  }

  private defaultCtx(name: string): TtsPluginCtx {
    return {
      fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(60_000) }),
      log,
      pluginConfig: () => ({}),
      apiKey: () => null,
    };
  }

  private async scan(): Promise<void> {
    const files = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js'));
    const seen = new Set<string>();
    const loaded = new Set<string>();
    for (const file of files.sort()) {
      await this.loadFile(file, loaded);
      seen.add(file);
    }
    for (const [file, st] of this.state) {
      if (!seen.has(file)) {
        if (st.name) this.engines.delete(st.name);
        this.state.delete(file);
      }
    }
  }

  private async loadFile(file: string, loaded: Set<string>): Promise<void> {
    const fullPath = path.join(this.pluginsDir, file);
    try { delete require.cache[require.resolve(fullPath)]; } catch { /* first load */ }
    try {
      const mod = require(fullPath);
      const name = mod?.name;
      if (!name || typeof name !== 'string') { this.state.set(file, { file, status: 'error', error: 'missing name' }); return; }
      if (typeof mod.synthesize !== 'function') { this.state.set(file, { file, name, status: 'error', error: 'missing synthesize()' }); return; }
      if (loaded.has(name)) { this.state.set(file, { file, name, status: 'error', error: 'duplicate name' }); return; }
      const ctx = this.makeCtx?.(name) ?? this.defaultCtx(name);
      const caps: TtsCapabilities = { ...DEFAULT_CAPS, ...(mod.capabilities ?? {}) };
      const engine: TtsEngine = {
        name,
        capabilities: caps,
        voices: (): TtsVoice[] => (typeof mod.voices === 'function' ? mod.voices() : []),
        synthesize: (text: string, opts: TtsOpts) => mod.synthesize(text, opts, ctx),
        synthesizeStream: typeof mod.synthesizeStream === 'function'
          ? (text: string, opts: TtsOpts, signal: AbortSignal): AsyncIterable<PcmChunk> => mod.synthesizeStream(text, opts, ctx, signal)
          : (async function* (): AsyncIterable<PcmChunk> { throw new Error(`engine "${name}" does not support native streaming`); })(),
      };
      loaded.add(name);
      this.engines.set(name, engine);
      this.state.set(file, { file, name, status: 'ok' });
      log.info(`[TtsPluginLoader] Loaded ${file} (${name})`);
    } catch (err: any) {
      this.state.set(file, { file, status: 'error', error: err.message });
      log.warn(`[TtsPluginLoader] ${file} load error: ${err.message}`);
    }
  }

  getEngines(): TtsEngine[] { return [...this.engines.values()]; }
  getState(): TtsPluginState[] { return [...this.state.values()]; }
  async reload(): Promise<void> { await this.scan(); }

  private startWatch(): void {
    try {
      this.watcher = fs.watch(this.pluginsDir, () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => { void this.scan(); }, 300);
      });
    } catch (err: any) {
      log.warn(`[TtsPluginLoader] watch failed: ${err.message}`);
    }
  }

  stop(): void {
    this.watcher?.close();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

const README_CONTENT = `# TTS Engine Plugins

Place \`.js\` files here to add custom TTS engines (CJS module):

\`\`\`js
module.exports = {
  name: "my-tts",
  capabilities: { streaming: "none", voiceCloning: false, styleControl: false, languages: ["zh"], sampleRate: 24000 },
  voices() { return [{ id: "default", label: "Default", lang: "zh" }]; },
  async synthesize(text, opts, ctx) {
    // return Buffer of wav audio
  },
  // optional native streaming:
  // async *synthesizeStream(text, opts, ctx, signal) { yield { pcm: Buffer, sampleRate: 24000 }; },
};
\`\`\`

Select engine via config: \`media.tts.engine: my-tts\`.
`;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/tts-plugin-loader.test.ts --runInBand`
Expected: PASS（4 tests）

- [ ] **Step 5: package-types + PluginHost 接线**

`gateway/src/plugins/package-types.ts` 的 `PluginContributions` 加：

```typescript
export interface TtsContributionSpec {
  name?: string;  // 缺省 = 包名
  capabilities: import('../tts/types').TtsCapabilities;
  voices(): import('../tts/types').TtsVoice[];
  synthesize(ctx: PluginPackageContext, text: string, opts: import('../tts/types').TtsOpts): Promise<Buffer>;
  synthesizeStream?(ctx: PluginPackageContext, text: string, opts: import('../tts/types').TtsOpts, signal: AbortSignal): AsyncIterable<import('../tts/types').PcmChunk>;
}

export interface PluginContributions {
  usage?: Record<string, any>;
  media?: MediaContributionSpec;
  runtime?: RuntimeContributionSpec;
  tts?: TtsContributionSpec;   // 新增
  uiTools?: Record<string, unknown>;
}
```

`gateway/src/plugins/package-host.ts`：在激活处收集 tts 贡献（镜像 media 贡献的处理方式），包 tts 贡献包装为 `TtsEngine`（`name = spec.name ?? pkg.name`，synthesize 调用时注入包 ctx），经 setter 推给 `TtsEngineRegistry.setPackageEngines()`。具体落点：找到 host 里 `MediaContributionSpec` 被消费的位置（搜 `media` 关键词），在同层加 tts 分支；host 构造函数/配置需新增 `onTtsEntries?: (engines: TtsEngine[]) => void` 回调（与现有 media 回调同形），index.ts 传入 `(engines) => this.ttsRegistry.setPackageEngines(engines)`。

- [ ] **Step 6: index.ts 实例化 legacy loader**

`initServices()` 中（mimo 注册之后）：

```typescript
this.ttsPluginLoader = new TtsPluginLoader(path.join(config.paths.mafwDir, 'tts-plugins'));
await this.ttsPluginLoader.init();
this.ttsRegistry.setLegacyEngines(this.ttsPluginLoader.getEngines());
```

类成员加 `private ttsPluginLoader?: TtsPluginLoader;`；`stop()` 里加 `this.ttsPluginLoader?.stop();`。

> legacy loader 热载后需重新 setLegacyEngines：给 TtsPluginLoader 构造加可选 `onChanged?: () => void`，scan 完成后调用；index.ts 传 `() => this.ttsRegistry.setLegacyEngines(this.ttsPluginLoader!.getEngines())`。在 Step 3 代码的 `scan()` 末尾加 `this.onChanged?.()` 并在 constructor 参数中加 `private onChanged?: () => void`。

- [ ] **Step 7: 验证编译 + 测试**

Run: `cd gateway && npx tsc --noEmit && npx jest --runInBand`
Expected: 全绿

- [ ] **Step 8: Commit**

```bash
git add gateway/src/tts/tts-plugin-loader.ts gateway/src/plugins/package-types.ts gateway/src/plugins/package-host.ts gateway/src/index.ts gateway/tests/unit/tts-plugin-loader.test.ts
git commit -m "feat(gateway): tts-plugins legacy dir loader + unified package tts contribution type"
```

---

### Task 6: kokoro 内置引擎（kokoro-js 进程内 ONNX，模型按需下载）

**Files:**
- Create: `gateway/src/tts/kokoro-engine.ts`
- Modify: `gateway/src/index.ts`（initServices 注册）
- Modify: `gateway/package.json`（optionalDependencies 加 kokoro-js）
- Test: `gateway/tests/unit/tts-kokoro-engine.test.ts`

**Interfaces:**
- Consumes: Task 1/2
- Produces: `createKokoroEngine(deps { modelsDir: string; log }): TtsEngine`——name `kokoro`，`capabilities: { streaming: 'none', voiceCloning: false, styleControl: false, languages: ['zh','en','ja',...], sampleRate: 24000 }`（走句切分适配层）

- [ ] **Step 1: 写失败测试（kokoro-js 缺席时的降级行为，不依赖真实模型）**

`gateway/tests/unit/tts-kokoro-engine.test.ts`：

```typescript
import { createKokoroEngine } from '../../src/tts/kokoro-engine';

describe('kokoro engine', () => {
  test('declares non-streaming capabilities at 24kHz', () => {
    const e = createKokoroEngine({ modelsDir: '/tmp/kokoro-test' });
    expect(e.name).toBe('kokoro');
    expect(e.capabilities.streaming).toBe('none');
    expect(e.capabilities.sampleRate).toBe(24000);
    expect(e.voices().length).toBeGreaterThan(0);
  });

  test('synthesize throws actionable error when kokoro-js is not installed', async () => {
    const e = createKokoroEngine({ modelsDir: '/tmp/kokoro-test' });
    await expect(e.synthesize('你好', {})).rejects.toThrow(/kokoro-js/);
  });
});
```

> 第二个测试在 kokoro-js 已安装的环境会失败——实现时让 `createKokoroEngine` 接受可选 `loadModule?: () => Promise<any>` 注入点，测试传 `loadModule: () => Promise.reject(new Error('not installed'))` 断言错误被包装成可操作的提示（含 `npm i kokoro-js` 指引）。模型真实合成不做单测（90MB 下载，手测覆盖）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/tts-kokoro-engine.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（ESM 桥 + 懒加载 + 按需下载）**

`gateway/src/tts/kokoro-engine.ts`：

```typescript
import * as path from 'path';
import { log } from '../core/utils/logger';
import type { PcmChunk, TtsEngine, TtsOpts, TtsVoice } from './types';

/**
 * kokoro 内置引擎：Kokoro-82M（Apache 2.0 含权重），kokoro-js + transformers.js
 * 进程内 ONNX Runtime。定位：离线兜底（CPU 可跑，中文音色一般）。
 *
 * - kokoro-js 是 ESM-only，gateway 是 CJS → 用 pi-adapter 同款 ESM 桥
 *   （new Function('spec','return import(spec)')），直接 import() 会被 tsc 降级
 *   为 require 而抛错。
 * - 模型 ~90MB（onnx-community/Kokoro-82M-v1.0-ONNX，q8）首次使用时下载到
 *   modelsDir（~/.mafw/models/kokoro），HF_ENDPOINT 环境变量可切镜像。
 * - streaming='none'：整段合成后由句切分适配层统一流式语义。
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/** 音色子集（kokoro 全量见模型卡；zh 用 zf_ 前缀，en 用 af_/am_ 前缀）。 */
const KOKORO_VOICES: TtsVoice[] = [
  { id: 'zf_xiaobei', label: '小北（中文女声）', lang: 'zh' },
  { id: 'zf_xiaoxiao', label: '小小（中文女声）', lang: 'zh' },
  { id: 'af_heart', label: 'Heart (EN female)', lang: 'en' },
  { id: 'am_michael', label: 'Michael (EN male)', lang: 'en' },
];

export function createKokoroEngine(deps: {
  modelsDir: string;
  loadModule?: () => Promise<any>;
}): TtsEngine {
  let ttsPromise: Promise<any> | null = null;

  const importEsm = (spec: string): Promise<any> => {
    const fn = new Function('spec', 'return import(spec)') as (s: string) => Promise<any>;
    return fn(spec);
  };

  async function ensureTts(): Promise<any> {
    if (!ttsPromise) {
      ttsPromise = (async () => {
        let mod: any;
        try {
          mod = await (deps.loadModule ? deps.loadModule() : importEsm('kokoro-js'));
        } catch (err: any) {
          throw new Error(
            `kokoro-js 未安装或加载失败：${err.message}。` +
            `离线兜底引擎需要 optional dependency：cd gateway && npm i kokoro-js`,
          );
        }
        const tts = await mod.KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          cache_dir: path.join(deps.modelsDir, 'kokoro'),
        });
        log.info('[TTS] kokoro model ready');
        return tts;
      })();
      ttsPromise.catch(() => { ttsPromise = null; }); // 失败可重试
    }
    return ttsPromise;
  }

  return {
    name: 'kokoro',
    capabilities: {
      streaming: 'none',
      voiceCloning: false,
      styleControl: false,
      languages: ['zh', 'en', 'ja'],
      sampleRate: 24000,
    },
    voices: () => KOKORO_VOICES,
    async synthesize(text: string, opts: TtsOpts): Promise<Buffer> {
      const tts = await ensureTts();
      const voice = opts.voice && KOKORO_VOICES.some(v => v.id === opts.voice) ? opts.voice : 'zf_xiaobei';
      const audio = await tts.generate(text, { voice });
      // kokoro-js generate 返回 RawAudio（{ audio: Float32Array, sampling_rate }）或带 toWav()
      if (typeof audio.toWav === 'function') return Buffer.from(audio.toWav());
      // RawAudio 兜底：手动拼 RIFF 头
      return rawToWav(Buffer.from(audio.audio.buffer), audio.sampling_rate ?? 24000);
    },
    async *synthesizeStream(): AsyncIterable<PcmChunk> {
      throw new Error('kokoro engine does not support native streaming (use sentence adapter)');
    },
  };
}

function rawToWav(pcm16: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm16.length, 4);
  header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm16.length, 40);
  return Buffer.concat([header, pcm16]);
}
```

`gateway/package.json` 加 optionalDependencies：`"kokoro-js": "^1.2.1"`（版本以 `npm view kokoro-js version` 实际值为准）。

index.ts initServices 注册（mimo 之后）：

```typescript
this.ttsRegistry.registerBuiltin(createKokoroEngine({ modelsDir: path.join(config.paths.mafwDir, 'models') }));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/tts-kokoro-engine.test.ts --runInBand`
Expected: PASS（2 tests）

- [ ] **Step 5: 手测（文档化，非 CI）**

```bash
cd gateway && npm i kokoro-js   # 装 optional dep
# 起 gateway，Config 置 media.tts.engine: kokoro
# POST /api/tts {"text":"你好，这是离线合成"} → 返回 artifact；首次触发模型下载
# POST /api/tts/stream 同上 → SSE 块按句到达（适配层）
```

验证点：首次调用下载模型到 `~/.mafw/models/kokoro`；断网 + 有缓存时可合成；未装 kokoro-js 时错误信息含安装指引。

- [ ] **Step 6: Commit**

```bash
git add gateway/src/tts/kokoro-engine.ts gateway/src/index.ts gateway/package.json gateway/tests/unit/tts-kokoro-engine.test.ts
git commit -m "feat(gateway): kokoro builtin TTS engine (in-process ONNX, on-demand model download, offline fallback)"
```

---

### Task 7: Desktop voice/ 骨架 —— 类型 + SilenceTimeoutStrategy + VAD 配置读取

**Files:**
- Create: `packages/desktop/src/renderer/mafw/voice/types.ts`
- Create: `packages/desktop/src/renderer/mafw/voice/turn.ts`
- Test: `packages/desktop/src/renderer/mafw/voice/turn.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `VadParams { confidence: number; negativeConfidence: number; stopSecs: number; minSpeechMs: number; preSpeechPadMs: number }`
  - `DEFAULT_VAD_PARAMS: VadParams`（0.5/0.35/1.2/500/800，与现 VoiceRecorder 常量一致）
  - `VadAnalyzer { start(): Promise<void>; stop(): void; on(evt: 'speech_started'|'speech_stopped'|'misfire', cb): void }`（speech_stopped 回调参数 `audio: Float32Array`）
  - `TurnStopStrategy { onSpeechStopped(audio: Float32Array): 'end_turn'|'continue'; onSpeechStarted(): void; reset(): void }`
  - `SilenceTimeoutStrategy`（构造参数 `{ stopSecs }`）

- [ ] **Step 1: 写类型 + 失败测试**

`packages/desktop/src/renderer/mafw/voice/types.ts`：

```typescript
export interface VadParams {
  confidence: number
  negativeConfidence: number
  /** 静音宽限（秒）：VAD 判停后多久仍无人声算轮次结束 */
  stopSecs: number
  minSpeechMs: number
  preSpeechPadMs: number
}

/** 与旧 VoiceRecorder.ts 常量完全一致（行为等价）。 */
export const DEFAULT_VAD_PARAMS: VadParams = {
  confidence: 0.5,
  negativeConfidence: 0.35,
  stopSecs: 1.2,
  minSpeechMs: 500,
  preSpeechPadMs: 800,
}

export type VadEvent = 'speech_started' | 'speech_stopped' | 'misfire'

/** VAD 只发原始信号，不决定轮次（Pipecat VADAnalyzer 分层）。 */
export interface VadAnalyzer {
  start(): Promise<void>
  stop(): void
  on(event: VadEvent, cb: (audio?: Float32Array) => void): void
}

export interface TurnStopStrategy {
  onSpeechStopped(audio: Float32Array): 'end_turn' | 'continue'
  onSpeechStarted(): void
  reset(): void
}

export type VoiceState = 'idle' | 'recording' | 'speaking' | 'interrupted'

export interface TtsPlayer {
  feed(pcm: Int16Array): void
  flush(): void
  readonly playCursorMs: number
  on(event: 'started' | 'drained' | 'flushed', cb: () => void): void
  dispose(): Promise<void>
}
```

`packages/desktop/src/renderer/mafw/voice/turn.test.ts`：

```typescript
import { test, expect } from "bun:test"
import { SilenceTimeoutStrategy } from "./turn"

test("speech_stopped ends turn when silence exceeds stopSecs", () => {
  let now = 1000
  const s = new SilenceTimeoutStrategy({ stopSecs: 1.2, now: () => now })
  s.onSpeechStarted()
  now += 2000 // 说了 2s
  expect(s.onSpeechStopped(new Float32Array(100))).toBe("end_turn")
})

test("continues when speech resumes within stopSecs (strategy-level no-op for silero, contract test)", () => {
  const s = new SilenceTimeoutStrategy({ stopSecs: 1.2, now: () => Date.now() })
  expect(s.onSpeechStopped(new Float32Array(10))).toBe("end_turn")
})

test("reset clears state", () => {
  const s = new SilenceTimeoutStrategy({ stopSecs: 1.2, now: () => 0 })
  s.onSpeechStarted()
  s.reset()
  expect(s.onSpeechStopped(new Float32Array(1))).toBe("end_turn")
})
```

> 注：Silero 的 redemptionMs 已在引擎内做静音宽限，SilenceTimeoutStrategy v1 是**直通语义**（VAD stop 即 end_turn）——策略层的价值在接缝（未来语义 turn detector 在这里返回 continue）。测试锁定这个契约。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/voice/turn.test.ts`
Expected: FAIL（`./turn` 不存在）

- [ ] **Step 3: 实现**

`packages/desktop/src/renderer/mafw/voice/turn.ts`：

```typescript
import type { TurnStopStrategy } from "./types"

/**
 * SilenceTimeoutStrategy — v1 直通语义：VAD speech_stopped 即轮次结束
 * （静音宽限已由 Silero redemptionMs 在引擎内完成）。
 * 未来语义 turn detector 作为新实现挂入本接口。
 */
export class SilenceTimeoutStrategy implements TurnStopStrategy {
  constructor(_opts: { stopSecs: number; now?: () => number }) {}
  onSpeechStarted(): void {}
  onSpeechStopped(_audio: Float32Array): 'end_turn' | 'continue' { return 'end_turn' }
  reset(): void {}
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/voice/turn.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/voice/types.ts packages/desktop/src/renderer/mafw/voice/turn.ts packages/desktop/src/renderer/mafw/voice/turn.test.ts
git commit -m "feat(desktop): voice core types (VadAnalyzer/TurnStopStrategy/TtsPlayer/VoiceState) + SilenceTimeoutStrategy"
```

---

### Task 8: SileroVadAnalyzer（迁移 VoiceRecorder 逻辑，recording/monitor 双消费者共享单实例）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/voice/silero.ts`
- Test: `packages/desktop/src/renderer/mafw/voice/silero.test.ts`（只测纯逻辑部分）
- Delete（在 Task 11）: `packages/desktop/src/renderer/mafw/components/VoiceRecorder.ts`

**Interfaces:**
- Consumes: Task 7 types
- Produces: `createSileroVadAnalyzer(params: VadParams): VadAnalyzer`——内部持有单 getUserMedia 流 + 单 MicVAD 实例；多个 `on()` 订阅者共存（替代旧 mode 切换）；`start()` 幂等

- [ ] **Step 1: 写失败测试（事件分发逻辑，mock MicVAD）**

`packages/desktop/src/renderer/mafw/voice/silero.test.ts`：

```typescript
import { test, expect } from "bun:test"
import { createVadEventHub } from "./silero"

test("event hub dispatches speech events to all subscribers", () => {
  const hub = createVadEventHub()
  const got: string[] = []
  hub.on("speech_started", () => got.push("a"))
  hub.on("speech_started", () => got.push("b"))
  hub.emit("speech_started")
  expect(got).toEqual(["a", "b"])
})

test("speech_stopped carries audio to subscribers", () => {
  const hub = createVadEventHub()
  let received: Float32Array | undefined
  hub.on("speech_stopped", (a) => { received = a })
  const audio = new Float32Array([0.1, 0.2])
  hub.emit("speech_stopped", audio)
  expect(received).toBe(audio)
})

test("subscriber throwing does not break other subscribers", () => {
  const hub = createVadEventHub()
  const got: string[] = []
  hub.on("speech_started", () => { throw new Error("boom") })
  hub.on("speech_started", () => got.push("ok"))
  hub.emit("speech_started")
  expect(got).toEqual(["ok"])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/voice/silero.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现（VoiceRecorder.ts 逻辑迁入 + 事件 hub）**

`packages/desktop/src/renderer/mafw/voice/silero.ts`：

```typescript
// @ts-nocheck
import { MicVAD } from "@ricky0123/vad-web"
import ortWasmMjs from "../../assets/vad/ort-wasm-simd-threaded.mjs?url"
import ortWasmBin from "../../assets/vad/ort-wasm-simd-threaded.wasm?url"
import type { VadAnalyzer, VadEvent, VadParams } from "./types"

const SAMPLE_RATE = 16000
const ORT_BASE = ortWasmMjs.slice(0, ortWasmMjs.lastIndexOf("/")) + "/"
const MODEL_BASE = "/vad/"

/** 事件 hub：VAD 信号多播（录音消费者 + barge-in 消费者共享单 VAD 实例）。 */
export function createVadEventHub() {
  const subs = new Map<VadEvent, Set<(audio?: Float32Array) => void>>()
  return {
    on(event: VadEvent, cb: (audio?: Float32Array) => void) {
      let set = subs.get(event)
      if (!set) { set = new Set(); subs.set(event, set) }
      set.add(cb)
    },
    emit(event: VadEvent, audio?: Float32Array) {
      for (const cb of subs.get(event) ?? []) {
        try { cb(audio) } catch (e) { console.error("[voice] vad subscriber error:", e) }
      }
    },
    clear() { subs.clear() },
  }
}

/**
 * Silero VAD v5（onnxruntime-web WASM，本地打包资产）。
 * 单一 getUserMedia 流（echoCancellation/noiseSuppression/autoGainControl），
 * start() 幂等；事件经 hub 多播，不再有 monitor/recording 模式切换。
 */
export function createSileroVadAnalyzer(params: VadParams): VadAnalyzer {
  const hub = createVadEventHub()
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let vad: InstanceType<typeof MicVAD> | null = null
  let starting: Promise<void> | null = null

  async function ensureStream(): Promise<void> {
    if (stream && ctx) return
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  }

  async function ensureVad(): Promise<void> {
    if (vad) return
    vad = await MicVAD.new({
      model: "v5",
      audioContext: ctx!,
      getStream: () => stream!,
      baseAssetPath: MODEL_BASE,
      onnxWASMBasePath: ORT_BASE,
      positiveSpeechThreshold: params.confidence,
      negativeSpeechThreshold: params.negativeConfidence,
      redemptionMs: params.stopSecs * 1000,
      minSpeechMs: params.minSpeechMs,
      preSpeechPadMs: params.preSpeechPadMs,
      onSpeechStart: () => hub.emit("speech_started"),
      onSpeechEnd: (audio: Float32Array) => hub.emit("speech_stopped", audio),
      onVADMisfire: () => hub.emit("misfire"),
    })
  }

  return {
    async start() {
      if (starting) return starting
      starting = (async () => {
        await ensureStream()
        await ensureVad()
        try { await vad!.start() } catch { /* already running */ }
        console.debug("[voice] Silero VAD ready; ort base:", ORT_BASE, "wasm:", ortWasmBin)
      })()
      try { await starting } finally { starting = null }
    },
    stop() {
      try { vad?.pause() } catch { /* ignore */ }
      vad = null
      try { stream?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
      try { ctx?.close() } catch { /* ignore */ }
      stream = null
      ctx = null
    },
    on: (event, cb) => hub.on(event, cb),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/voice/silero.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/voice/silero.ts packages/desktop/src/renderer/mafw/voice/silero.test.ts
git commit -m "feat(desktop): SileroVadAnalyzer with shared single mic stream + event hub multicast"
```

---

### Task 9: AudioWorkletPlayer + pcm-worklet.js

**Files:**
- Create: `packages/desktop/public/voice/pcm-worklet.js`
- Create: `packages/desktop/src/renderer/mafw/voice/worklet-player.ts`
- Test: `packages/desktop/src/renderer/mafw/voice/pcm-align.test.ts`（纯函数：chunk 字节对齐）

**Interfaces:**
- Consumes: Task 7 `TtsPlayer`
- Produces: `createAudioWorkletPlayer(ctx: AudioContext): Promise<TtsPlayer>`；`alignPcmChunks(remainder: Uint8Array, bytes: Uint8Array): { aligned: Uint8Array; remainder: Uint8Array }`（从 ChatPane playStreamingTts 抽出的纯函数）

- [ ] **Step 1: 写失败测试（字节对齐纯函数）**

`packages/desktop/src/renderer/mafw/voice/pcm-align.test.ts`：

```typescript
import { test, expect } from "bun:test"
import { alignPcmChunks } from "./worklet-player"

test("odd bytes carry over to next chunk as remainder", () => {
  const r1 = alignPcmChunks(new Uint8Array(0), new Uint8Array([1, 2, 3]))
  expect([...r1.aligned]).toEqual([1, 2])
  expect([...r1.remainder]).toEqual([3])
  const r2 = alignPcmChunks(r1.remainder, new Uint8Array([4]))
  expect([...r2.aligned]).toEqual([3, 4])
  expect(r2.remainder.length).toBe(0)
})

test("even chunk passes through with empty remainder", () => {
  const r = alignPcmChunks(new Uint8Array(0), new Uint8Array([1, 2, 3, 4]))
  expect(r.aligned.length).toBe(4)
  expect(r.remainder.length).toBe(0)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/voice/pcm-align.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 worklet 处理器（publicDir 静态资产）**

`packages/desktop/public/voice/pcm-worklet.js`：

```javascript
/**
 * PCM16 环形缓冲播放器（AudioWorkletProcessor）。
 * 主线程 port.postMessage({type:'feed', pcm: Int16Array}) 投喂；
 * {type:'flush'} 清缓冲（barge-in 即时静音）；每处理 N 帧上报已渲染帧数。
 * 起步缓冲 STARTUP_FRAMES（~200ms）抗网络抖动。
 */
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.capacity = sampleRate * 30 // 30s 环形缓冲
    this.ring = new Float32Array(this.capacity)
    this.readPos = 0
    this.writePos = 0
    this.buffered = 0
    this.playing = false
    this.renderedFrames = 0
    this.startupFrames = Math.floor(sampleRate * 0.2) // 200ms
    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'feed') {
        const pcm = msg.pcm // Int16Array
        for (let i = 0; i < pcm.length; i++) {
          if (this.buffered >= this.capacity) break // 满了丢弃（30s 不可能吃满）
          this.ring[this.writePos] = pcm[i] / 32768
          this.writePos = (this.writePos + 1) % this.capacity
          this.buffered++
        }
        if (!this.playing && this.buffered >= this.startupFrames) {
          this.playing = true
          this.port.postMessage({ type: 'started' })
        }
      } else if (msg.type === 'flush') {
        this.readPos = this.writePos = this.buffered = 0
        this.playing = false
        this.port.postMessage({ type: 'flushed', renderedFrames: this.renderedFrames })
      } else if (msg.type === 'eof') {
        this.eof = true
      }
    }
  }
  process(_inputs, outputs) {
    const out = outputs[0][0]
    if (this.playing) {
      for (let i = 0; i < out.length; i++) {
        if (this.buffered > 0) {
          out[i] = this.ring[this.readPos]
          this.readPos = (this.readPos + 1) % this.capacity
          this.buffered--
          this.renderedFrames++
        } else {
          out[i] = 0
          if (this.eof) {
            this.playing = false
            this.eof = false
            this.port.postMessage({ type: 'drained' })
          } else {
            this.playing = false // 欠载：回到起步缓冲等待
            this.port.postMessage({ type: 'underrun' })
          }
        }
      }
      if (this.renderedFrames % sampleRate < 128) {
        this.port.postMessage({ type: 'cursor', renderedFrames: this.renderedFrames })
      }
    }
    return true
  }
}
registerProcessor('pcm-player', PcmPlayerProcessor)
```

- [ ] **Step 4: 实现主线程播放器**

`packages/desktop/src/renderer/mafw/voice/worklet-player.ts`：

```typescript
// @ts-nocheck
import type { TtsPlayer } from "./types"

/** SSE chunk 边界可能切半个 sample：残余字节留到下一块拼齐。 */
export function alignPcmChunks(remainder: Uint8Array, bytes: Uint8Array): { aligned: Uint8Array; remainder: Uint8Array } {
  const combined = new Uint8Array(remainder.length + bytes.length)
  combined.set(remainder)
  combined.set(bytes, remainder.length)
  const alignedLen = combined.length - (combined.length % 2)
  return {
    aligned: combined.subarray(0, alignedLen),
    remainder: combined.subarray(alignedLen),
  }
}

/**
 * AudioWorklet 环形缓冲播放器。ctx 由调用方在用户手势内创建
 * （Chromium autoplay 策略），采样率 = 引擎声明采样率。
 * 无 BufferSource 回退——Electron Chromium 必有 AudioWorklet（spec 决策）。
 */
export async function createAudioWorkletPlayer(ctx: AudioContext): Promise<TtsPlayer> {
  await ctx.audioWorklet.addModule("/voice/pcm-worklet.js")
  const node = new AudioWorkletNode(ctx, "pcm-player", { outputChannelCount: [1] })
  node.connect(ctx.destination)

  const listeners = new Map<string, Set<() => void>>()
  let renderedFrames = 0
  let flushedRendered = 0

  node.port.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === "cursor" || msg.type === "flushed") {
      renderedFrames = msg.renderedFrames
    }
    if (msg.type === "flushed") flushedRendered = msg.renderedFrames
    for (const cb of listeners.get(msg.type) ?? []) {
      try { cb() } catch { /* ignore */ }
    }
  }

  return {
    feed(pcm: Int16Array) { node.port.postMessage({ type: "feed", pcm }, [pcm.buffer]) },
    flush() { node.port.postMessage({ type: "flush" }) },
    get playCursorMs() { return Math.round((renderedFrames / ctx.sampleRate) * 1000) },
    on(event, cb) {
      let set = listeners.get(event)
      if (!set) { set = new Set(); listeners.set(event, set) }
      set.add(cb)
    },
    async dispose() {
      node.disconnect()
      await ctx.close().catch(() => {})
    },
    // 内部：speak 结束时通知 worklet 数据已尽（触发 drained）
    ...{ markEof() { node.port.postMessage({ type: "eof" }) } },
  } as TtsPlayer & { markEof(): void }
}
```

> `markEof` 以交叉类型挂在返回值上，VoiceSession（Task 10）消费；不进 TtsPlayer 公共接口（保持接口最小）。

- [ ] **Step 5: 跑测试确认通过 + typecheck**

Run: `cd packages/desktop && bun test src/renderer/mafw/voice/pcm-align.test.ts && npx tsgo -b`
Expected: PASS（2 tests）；typecheck 无新错误

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/public/voice/pcm-worklet.js packages/desktop/src/renderer/mafw/voice/worklet-player.ts packages/desktop/src/renderer/mafw/voice/pcm-align.test.ts
git commit -m "feat(desktop): AudioWorklet ring-buffer TTS player (replaces BufferSource onended chain)"
```

---

### Task 10: VoiceSession 状态机

**Files:**
- Create: `packages/desktop/src/renderer/mafw/voice/session.ts`
- Create: `packages/desktop/src/renderer/mafw/voice/upload.ts`
- Test: `packages/desktop/src/renderer/mafw/voice/session.test.ts`

**Interfaces:**
- Consumes: Task 7 types、Task 8 analyzer、Task 9 player、SDK `tts.streamUrl()`、`tts.interrupt()`
- Produces（后续 Task 11 ChatPane 消费）：
  - `createVoiceSession(deps): VoiceSession`
  - deps: `{ vad: VadAnalyzer; strategy: TurnStopStrategy; streamUrl(): Promise<string>; interrupt(sessionId): Promise<unknown>; sessionId(): string | null; defaultVoice(): string }`
  - VoiceSession: `startRecording()/stopRecording()/speak(text, voice?)/speakFromTool(text, voice?)/playUrl(url)/stopSpeaking(reason)/state/on(event, cb)/dispose()`
  - 事件：`'state'`（VoiceState）、`'segment'`（{ wavBytes: ArrayBuffer; duration: number }）、`'barge_in'`、`'error'`（{ message: string }）

- [ ] **Step 1: 写失败测试（mock vad/player/fetch）**

`packages/desktop/src/renderer/mafw/voice/session.test.ts`：

```typescript
import { test, expect, mock } from "bun:test"
import { createVoiceSession } from "./session"
import { SilenceTimeoutStrategy } from "./turn"
import { DEFAULT_VAD_PARAMS, type VadAnalyzer, type VadEvent } from "./types"

function fakeVad() {
  const subs = new Map<VadEvent, ((a?: Float32Array) => void)[]>()
  const vad: VadAnalyzer = {
    start: async () => {},
    stop: () => {},
    on: (e, cb) => { subs.set(e, [...(subs.get(e) ?? []), cb]) },
  }
  return { vad, emit: (e: VadEvent, a?: Float32Array) => subs.get(e)?.forEach(cb => cb(a)) }
}

function fakePlayer() {
  return {
    feed: mock(() => {}), flush: mock(() => {}), playCursorMs: 0,
    on: () => {}, dispose: async () => {},
  }
}

const baseDeps = (vad: VadAnalyzer) => ({
  vad,
  strategy: new SilenceTimeoutStrategy({ stopSecs: DEFAULT_VAD_PARAMS.stopSecs }),
  streamUrl: async () => "http://gw:3000/api/tts/stream",
  interrupt: async () => ({ ok: true, cancelled: 0 }),
  sessionId: () => "sess-1",
  defaultVoice: () => "茉莉",
})

test("recording: vad speech_stopped emits segment event with wav bytes", async () => {
  const { vad, emit } = fakeVad()
  const vs = createVoiceSession(baseDeps(vad))
  const segments: { wavBytes: ArrayBuffer; duration: number }[] = []
  vs.on("segment", (s) => segments.push(s))
  await vs.startRecording()
  expect(vs.state).toBe("recording")
  emit("speech_stopped", new Float32Array(16000)) // 1s @16k
  expect(segments).toHaveLength(1)
  expect(segments[0].duration).toBeCloseTo(1, 1)
  expect(segments[0].wavBytes.byteLength).toBe(44 + 16000 * 2) // RIFF 头 + pcm16
  vs.dispose()
})

test("barge-in during speaking: speech_started flushes player and interrupts gateway", async () => {
  const { vad, emit } = fakeVad()
  let interrupted = ""
  const player = fakePlayer()
  const vs = createVoiceSession({
    ...baseDeps(vad),
    interrupt: async (sid: string) => { interrupted = sid; return { ok: true, cancelled: 1 } },
    _makePlayer: async () => player as any, // 测试注入点
  } as any)
  // 模拟 speaking 态（不经真实 fetch：直接调内部状态——见实现注）
  ;(vs as any)._enterSpeakingForTest(player)
  emit("speech_started")
  expect(player.flush).toHaveBeenCalled()
  await new Promise(r => setTimeout(r, 0))
  expect(interrupted).toBe("sess-1")
  expect(vs.state).toBe("interrupted")
  vs.dispose()
})

test("speakFromTool dedupes repeated identical text", async () => {
  const { vad } = fakeVad()
  let plays = 0
  const vs = createVoiceSession({
    ...baseDeps(vad),
    _makePlayer: async () => { plays++; throw new Error("stop after count") },
  } as any)
  await vs.speakFromTool("同一段话").catch(() => {})
  await vs.speakFromTool("同一段话").catch(() => {})
  expect(plays).toBe(1)
  vs.dispose()
})
```

> 实现注：`createVoiceSession` deps 增加可选 `_makePlayer?: (ctx: AudioContext) => Promise<TtsPlayer>`（测试注入；生产缺省 = `createAudioWorkletPlayer`）。`_enterSpeakingForTest` 仅测试用。若评审认为测试钩子污染接口，可改为把 speak 的 fetch 也做成注入点——实现者任选，保持测试可行即可。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/voice/session.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 VoiceSession**

`packages/desktop/src/renderer/mafw/voice/session.ts`：

```typescript
// @ts-nocheck
import type { TtsPlayer, VadAnalyzer, VoiceState } from "./types"
import type { TurnStopStrategy } from "./types"
import { createAudioWorkletPlayer, alignPcmChunks } from "./worklet-player"

export interface VoiceSessionDeps {
  vad: VadAnalyzer
  strategy: TurnStopStrategy
  streamUrl: () => Promise<string>
  interrupt: (sessionId: string) => Promise<unknown>
  sessionId: () => string | null
  defaultVoice: () => string
  _makePlayer?: (ctx: AudioContext) => Promise<TtsPlayer>
}

type Handler = (data?: any) => void

const WAV_SAMPLE_RATE = 16000
const DEDUP_TTL_MS = 60_000

function encodeWavBytes(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeString = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  writeString(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE"); writeString(12, "fmt "); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeString(36, "data"); view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2
  }
  return buffer
}

function hashText(t: string): string {
  let h = 0
  for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0
  return String(h)
}

/**
 * VoiceSession — 桌面语音唯一入口。显式状态机：
 *   idle → recording（VAD 分段 → segment 事件）
 *   idle → speaking ⇄ interrupted（barge-in：flush + gateway interrupt）
 * 播放互斥、speak 去重（TTL hash）、打断传播全部收敛在这里。
 */
export function createVoiceSession(deps: VoiceSessionDeps) {
  let state: VoiceState = "idle"
  const listeners = new Map<string, Set<Handler>>()
  const recentSpeaks = new Map<string, number>() // hash → ts（TTL 去重）
  let activePlayer: (TtsPlayer & { markEof?(): void }) | null = null
  let activeAbort: AbortController | null = null

  const emit = (event: string, data?: any) => {
    for (const cb of listeners.get(event) ?? []) {
      try { cb(data) } catch (e) { console.error("[voice] listener error:", e) }
    }
  }
  const setState = (s: VoiceState) => { state = s; emit("state", s) }

  // VAD 信号按状态路由：recording → 分段；speaking → barge-in
  deps.vad.on("speech_started", () => {
    if (state === "speaking") bargeIn()
    else if (state === "recording") deps.strategy.onSpeechStarted()
  })
  deps.vad.on("speech_stopped", (audio?: Float32Array) => {
    if (state !== "recording" || !audio) return
    if (deps.strategy.onSpeechStopped(audio) !== "end_turn") return
    const wavBytes = encodeWavBytes(audio, WAV_SAMPLE_RATE)
    const duration = audio.length / WAV_SAMPLE_RATE
    console.log(`[voice] segment (${Math.round(duration * 1000)}ms, ${wavBytes.byteLength} bytes)`)
    emit("segment", { wavBytes, duration })
  })

  function bargeIn() {
    const cursor = activePlayer?.playCursorMs ?? 0
    console.log(`[voice] barge-in: flushed at ${cursor}ms`)
    activePlayer?.flush()
    activeAbort?.abort()
    const sid = deps.sessionId()
    if (sid) void deps.interrupt(sid).catch(e => console.warn("[voice] interrupt failed:", e))
    setState("interrupted")
    emit("barge_in", { playCursorMs: cursor })
  }

  async function startRecording() {
    if (state === "recording") return
    if (state === "speaking") stopSpeaking("manual")
    try {
      await deps.vad.start()
    } catch (e: any) {
      emit("error", { message: e?.message || String(e) })
      return
    }
    deps.strategy.reset()
    setState("recording")
  }

  function stopRecording() {
    if (state === "recording") setState("idle")
    // 不 stop VAD：speaking 监听可能复用；idle 时由 dispose 统一管理
  }

  async function playStream(text: string, voice: string, signal: AbortSignal): Promise<void> {
    const streamUrl = await deps.streamUrl()
    const res = await fetch(streamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, sessionId: deps.sessionId() ?? undefined }),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`TTS stream HTTP ${res.status}`)
    const sampleRate = parseInt(res.headers.get("x-tts-sample-rate") || "24000", 10)
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioCtx({ sampleRate })
    if (ctx.state === "suspended") {
      try { await ctx.resume() } catch { void ctx.close().catch(() => {}); throw new Error("AudioContext resume failed") }
    }
    try {
      const sid = (ctx as any).setSinkId
      if (typeof sid === "function") void sid.call(ctx, "default").catch(() => {})
    } catch { /* ignore */ }
    const makePlayer = deps._makePlayer ?? createAudioWorkletPlayer
    const player = await makePlayer(ctx) as TtsPlayer & { markEof?(): void }
    activePlayer = player
    setState("speaking")
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let remainder = new Uint8Array(0)
    let buf = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (signal.aborted || ctx.state === "closed") throw new DOMException("aborted", "AbortError")
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith("data:")) continue
          let j: any
          try { j = JSON.parse(t.slice(5).trim()) } catch { continue }
          if (!j.data) continue
          const bin = atob(j.data)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          const { aligned, remainder: rem } = alignPcmChunks(remainder, bytes)
          remainder = rem
          if (aligned.length === 0) continue
          player.feed(new Int16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2))
        }
      }
      player.markEof?.()
      await new Promise<void>(r => {
        const t = setTimeout(r, 60_000)
        player.on("drained", () => { clearTimeout(t); r() })
      })
    } finally {
      reader.releaseLock()
      await player.dispose()
      if (activePlayer === player) activePlayer = null
    }
  }

  async function speak(text: string, voice?: string) {
    const t = (text || "").trim()
    if (!t || state === "speaking") return
    stopSpeaking("manual")
    const abort = new AbortController()
    activeAbort = abort
    try {
      await playStream(t, voice || deps.defaultVoice(), abort.signal)
    } finally {
      if (activeAbort === abort) activeAbort = null
      if (state === "speaking") setState("idle")
    }
  }

  async function speakFromTool(text: string, voice?: string) {
    const clean = (text || "").trim()
    if (!clean) return
    const h = hashText(clean)
    const now = Date.now()
    for (const [k, ts] of recentSpeaks) if (now - ts > DEDUP_TTL_MS) recentSpeaks.delete(k)
    if (recentSpeaks.has(h)) return
    recentSpeaks.set(h, now)
    await speak(clean, voice)
  }

  function stopSpeaking(_reason: "user_barge_in" | "manual") {
    activePlayer?.flush()
    activeAbort?.abort()
    if (state === "speaking" || state === "interrupted") setState("idle")
  }

  return {
    get state() { return state },
    startRecording, stopRecording, speak, speakFromTool, stopSpeaking,
    on(event: string, cb: Handler) {
      let set = listeners.get(event)
      if (!set) { set = new Set(); listeners.set(event, set) }
      set.add(cb)
    },
    dispose() {
      stopSpeaking("manual")
      deps.vad.stop()
      listeners.clear()
    },
    // 测试钩子（见 session.test.ts 实现注）
    _enterSpeakingForTest(player: TtsPlayer) { activePlayer = player; setState("speaking") },
  }
}

export type VoiceSession = ReturnType<typeof createVoiceSession>
```

`packages/desktop/src/renderer/mafw/voice/upload.ts`（从 ChatPane 迁出的发送 helper，deps 注入不碰 store）：

```typescript
// @ts-nocheck
/** 语音分段上传 + 发送。store 操作经回调注入，本模块不认识 Solid store。 */
export async function uploadVoiceSegment(deps: {
  wavBytes: ArrayBuffer
  sessionID: string
  uploadAndCreate: (args: { bytes: ArrayBuffer; mediaType: string }) => Promise<{ id: string; contextId: string; artifactId: string }>
  sendEnriched: (args: { message: string; sessionID: string; parts: any[] }) => Promise<unknown>
}): Promise<{ pointerText: string; partId: string }> {
  const task = await deps.uploadAndCreate({ bytes: deps.wavBytes, mediaType: "audio/wav" })
  const ts = Date.now()
  const partId = `prt_media_${ts}_0`
  const pointerText = `[媒体附件 taskID: ${task.id} contextID: ${task.contextId} artifactId: ${task.artifactId}（媒体: voice-${ts}.wav），这是用户发给你的语音消息——调用 mafw_media_ask 工具获取其内容后，用 mafw_media_speak 工具以语音回复用户（taskID 填 ${task.id}）]`
  await deps.sendEnriched({
    message: "",
    sessionID: deps.sessionID,
    parts: [{ type: "text", id: partId, text: pointerText, synthetic: true }],
  })
  return { pointerText, partId }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/voice/`
Expected: PASS（voice 目录全部：turn 3 + silero 3 + pcm-align 2 + session 3 = 11 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/voice/session.ts packages/desktop/src/renderer/mafw/voice/upload.ts packages/desktop/src/renderer/mafw/voice/session.test.ts
git commit -m "feat(desktop): VoiceSession state machine (recording/speaking/interrupted) + barge-in interrupt propagation"
```

---

### Task 11: ChatPane 绑定层切换 + 删除旧语音代码

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（~360-686 行语音段整体替换）
- Delete: `packages/desktop/src/renderer/mafw/components/VoiceRecorder.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts:199-203` + `mafw-types.ts:166`（tts namespace 加 interrupt）
- Test: 无新单测（绑定层）；依赖 typecheck + 手测清单

**Interfaces:**
- Consumes: Task 10 `createVoiceSession`、`uploadVoiceSegment`；SDK `tts.interrupt`（Task 4）
- Produces: ChatPane 语音代码收敛为 ~80 行绑定

- [ ] **Step 1: preload 加 tts.interrupt 透传**

`packages/desktop/src/preload/mafw-api.ts` tts 段加：

```typescript
      interrupt: (sessionId) => invoke("tts", "interrupt", sessionId),
```

`mafw-types.ts` 的 tts 类型同步加 `interrupt(sessionId: string): Promise<{ ok: boolean; cancelled: number }>`。gateway 侧 main 进程的通用 IPC 派发（`invoke(ns, m, args)` → SDK）若已覆盖 tts namespace 则零改动（对齐 sessions.fork 先例）；否则在 main IPC 加 `tts.interrupt → client.tts.interrupt(...)` 一行。

- [ ] **Step 2: ChatPane 接入 VoiceSession**

在 ChatPane setup 顶部（信号声明区）：

```typescript
  // ── 语音核心（VoiceSession 状态机；UI 只绑定事件）──
  const voiceSession = createVoiceSession({
    vad: createSileroVadAnalyzer(vadParams),   // vadParams 由 config media.tts.vad 读取，fail-open DEFAULT_VAD_PARAMS
    strategy: new SilenceTimeoutStrategy({ stopSecs: vadParams.stopSecs }),
    streamUrl: () => window.api.mafw.tts.streamUrl(),
    interrupt: (sid) => window.api.mafw.tts.interrupt(sid),
    sessionId: () => sidProp(),
    defaultVoice: () => ttsVoiceSel() ?? "茉莉",
  })
  onCleanup(() => voiceSession.dispose())

  const [voiceRecording, setVoiceRecording] = createSignal(false)
  voiceSession.on("state", (s) => {
    setVoiceRecording(s === "recording")
    setTtsSpeaking(s === "speaking")
  })
  voiceSession.on("error", (e) => showToastV2({ description: `语音失败: ${e.message}`, duration: 3000 }))
  voiceSession.on("segment", ({ wavBytes, duration }) => { void handleVoiceSegment(wavBytes, duration) })
```

`handleVoiceSegment` = 旧 `onSegment` + `uploadAndSendVoice` 的合并（乐观消息 store 逻辑保留在 ChatPane，上传/发送调 `uploadVoiceSegment` helper）。

替换点清单（删除旧实现，改为绑定）：
- `speakText`（362-432）→ `voiceSession.speak(lastAssistantText(), ttsVoiceSel() ?? undefined)`（toast/空文本保护保留）
- `playStreamingTts`（434-513）→ **删除**（已进 session.ts）
- `handleMediaSpeak`（656-686）→ `(text, voice) => void voiceSession.speakFromTool(text, voice)`；`onRegisterMediaSpeak` 接线保留
- `beginPlayback/endPlayback/activePlayCount/activeCtxRef/activeAbortRef`（643-652 及声明）→ **删除**
- `stopActivePlayback` → `voiceSession.stopSpeaking("manual")`
- `VoiceRecorder({...})` 实例化（517-549）→ 删除，改 voiceSession.on("segment")
- `VOICE_REPLY_RE`/AudioReply 相关不动（AudioReply 组件保留）
- `streamedSpeakHashes`/`playedVoiceArtifacts`/`hashText` → 删除（已进 VoiceSession）
- TTS picker（ttsVoices/ttsVoiceSel/ttsStyle/openTtsPicker，~1325-1405 + JSX 2350-2404）→ **保留不动**（纯 UI）

`vadParams` 读取（onMount 或 createEffect，fail-open）：

```typescript
  const [vadParams, setVadParams] = createSignal(DEFAULT_VAD_PARAMS)
  onMount(() => {
    void (async () => {
      try {
        const cfg: any = await window.api.mafw.config.get("media.tts.vad")
        if (cfg && typeof cfg === "object") setVadParams({ ...DEFAULT_VAD_PARAMS, ...cfg })
      } catch { /* fail-open 默认值 */ }
    })()
  })
```

> 注意：vadParams 在 voiceSession 创建前需要就绪——把 voiceSession 创建移进同一 onMount 的 then 里，或 createVoiceSession 接受 `params: () => VadParams` getter。实现者取较简方案并在代码注释说明。

- [ ] **Step 3: 删除 VoiceRecorder.ts**

```bash
git rm packages/desktop/src/renderer/mafw/components/VoiceRecorder.ts
```

- [ ] **Step 4: typecheck + 全量 desktop 测试**

Run: `cd packages/desktop && npx tsgo -b && bun test`
Expected: 编译过；既有测试全绿（ChatPane 无现成单测覆盖语音段）

- [ ] **Step 5: 手测清单（逐项验证，行为等价）**

```bash
cd packages/desktop && bun run dev   # 或打好的桌面包
```

- [ ] 点麦克风 → 说话 → 停顿 1.2s → 出现乐观消息 → 转写后 AI 回复（与旧行为一致）
- [ ] TTS picker 选音色 → 🔊 播报最后一条回复 → 流式播放（首块 <1s）
- [ ] 播报中说话 → 立即静音（barge-in）；gateway 日志可见 `interrupt` 取消（`cancelled: 1`）
- [ ] assistant 经 mafw_media_speak 回复 → 自动播放一次不重复（去重 TTL 生效）
- [ ] 切音色为 kokoro（config `media.tts.engine: kokoro`，已装 optional dep）→ 播报走本地 ONNX
- [ ] Config 置 `media.tts.vad.confidence: 0.3` → 重启会话录音灵敏度变化

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/preload packages/desktop/src/renderer/mafw/components/VoiceRecorder.ts
git commit -m "refactor(desktop): ChatPane voice logic converges onto VoiceSession; delete VoiceRecorder (-400 lines inline)"
```

---

### Task 12: 文档收尾

**Files:**
- Modify: `AGENTS.md`（§5 增补语音架构小节）
- Modify: `packages/desktop/AGENTS.md`（如需要）
- Test: 无

- [ ] **Step 1: AGENTS.md §5 加小节（5.21 语音管道）**

内容要点（压缩为 AGENTS.md 风格的高密度条目）：
- `renderer/mafw/voice/`：VadAnalyzer（Silero 默认，参数 `media.tts.vad.*` 可配）/ TurnStopStrategy（v1 SilenceTimeout 直通，语义 detector 预留）/ AudioWorkletPlayer（环形缓冲，flush=barge-in，playCursorMs）/ VoiceSession（唯一入口，状态机 idle|recording|speaking|interrupted）
- gateway `tts/`：TtsEngine 接口（capabilities 声明 sampleRate/streaming）、TtsEngineRegistry（包>legacy>内置）、sentence-adapter（伪流式统一）、mimo+kokoro 内置（kokoro-js optional dep，模型按需下载 ~/.mafw/models/）、`~/.mafw/tts-plugins/` legacy 目录
- 打断传播：barge-in → 前端 flush + `POST /api/tts/interrupt {sessionId}` 取消在途合成
- 采样率：引擎声明，SSE `x-tts-sample-rate` 头透传，不强写 24kHz
- 开源 TTS 许可红线：ChatTTS/F5/Fish S2/IndexTTS/edge-tts/Piper 不内置

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md packages/desktop/AGENTS.md
git commit -m "docs: AGENTS.md voice pipeline architecture section (§5.21)"
```

---

## Self-Review 记录

- **Spec 覆盖**：G1(voice 核心)→Task 7-10 ✅；G2(VAD 配置化)→Task 7 types + Task 11 vadParams ✅；G3(TTS 插件化)→Task 1/3/5/6 ✅；G4(打断传播)→Task 4 + Task 10 bargeIn ✅；G5(ChatPane 瘦身)→Task 11 ✅；迁移计划 5 步 → Task 1-6(gateway 1-2 步)/7-10(desktop 3-4 步)/5,12(插件+文档) ✅
- **已知剪裁**：spec §3.5 提到 AudioReply 播放改走 VoiceSession——实现时若 AudioReply 的 `<audio>` 短播放与 VoiceSession 耦合过深，允许保留 AudioReply 现状并在 Task 11 commit message 说明取舍（互斥场景：AudioReply autoplay 与播报并发概率低）
- **类型一致性**：`speakFromTool`/`markEof`/`_makePlayer`/`_enterSpeakingForTest` 在 Task 10 定义与 Task 11 消费一致 ✅；`PcmChunk.pcm: Buffer`（gateway）与前端 `Int16Array` 转换边界在 session.ts playStream 内 ✅
