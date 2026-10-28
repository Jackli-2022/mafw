# Voice Runtime v2 — P0/P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the gateway-side voice foundation and a working `/ws/voice` ASR-only slice on the local RTX 4090: model catalog/license, ASR engine registry, Qwen3-ASR-1.7B vLLM sidecar, streaming partial/final over WebSocket.

**Architecture:** Add a new `gateway/src/voice/` module. It owns the `AsrEngine` contract, a typed model catalog, a sidecar lifecycle manager, a streaming ASR adapter, a `/ws/voice` protocol/session, and a thin gateway wiring. The desktop is untouched in this plan; `/api/tts` and `mafw_media_speak` remain unchanged. P2 (TTS/desktop) and later phases are separate plans.

**Tech Stack:** TypeScript (CJS), Jest 30, `ws`, Node 24 on Windows x64; Python 3.12 + `qwen-asr[vllm]` + FastAPI/uvicorn sidecar.

**Spec:** `docs/superpowers/specs/2026-10-28-voice-runtime-v2-design.md`

## Global Constraints

- Reference machine: local `RTX 4090 Laptop 16 GB` + `i9-13900H` + `32 GB RAM` + Windows 11; Node v24.9.0 / npm 11.6.0.
- v1 primary tier is dGPU: Qwen3-ASR-1.7B via the Python sidecar. No cloning in v1.
- `/ws/voice` v1 accepts **PCM16 16 kHz mono only**; `webm-opus` is reserved and not implemented.
- Do not modify `packages/desktop`, `mafw_media_speak`, `/api/tts`, `/api/tts/stream`, or `/api/tts/voices` in this plan.
- Do not add `sherpa-onnx-node` in this plan; that is P4 (iGPU compatibility). P0/P1 must not require a native Node addon.
- Built-in catalog licenses are only `Apache-2.0`, `MIT`, `BSD-2-Clause`; `user-plugin` entries require explicit acceptance and are never bundled.
- Sidecars spawn with `windowsHide: true`; stop with Windows `taskkill /PID <pid> /T /F` or POSIX `SIGTERM`; never leave a child after a failed start.
- Model files live under `~/.mafw/models/voice/<model-id>/`.
- TDD: every task writes a failing test first, runs it, implements, runs it green, commits. Report new test count and full-suite count in the task summary.
- Single gateway test command: `npm test --prefix gateway -- tests/unit/<file>.test.ts`. Build gate: `npm run build --prefix gateway`.

## Review Focus

1. **Sidecar never becomes healthy or crashes during start** — `start()` must reject with an actionable message (stderr tail, port, command), leave no orphan child, and not take down the gateway.
2. **Binary frame before `hello`** — the socket must answer `{type:"error",code:"hello_required"}` and close cleanly; no unhandled exception, no ASR call.
3. **`cancel` during an utterance** — no `asr.final` may arrive after `turn.cancelled`; the next `hello`/utterance must start with a fresh ASR stream.
4. **`end_audio` with empty or missing audio** — must produce an explicit error or empty final, never a crash or a hung turn.
5. **Unsupported language** — selecting a language the ASR engine does not declare must return `{type:"error",code:"language_unsupported"}` before any model call, not silently transcribe in another language.
6. **Sidecar port conflict** — a second start on the same port must fail with `sidecar_port_in_use` (or a clear wrapped message), not hang for the full timeout.

---

## File Structure

Create:

```
gateway/src/voice/
  types.ts
  config.ts
  catalog.ts
  registry.ts
  runtime.ts
  session.ts
  sidecar/qwen3-asr-sidecar.ts
  engines/asr/qwen3-vllm.ts
  transport/protocol.ts
  transport/ws-voice.ts
  routes/voice-status.ts

gateway/voice_sidecars/
  qwen3_asr_server.py
  requirements.txt

gateway/scripts/
  voice-bench.ts
```

Modify:

```
gateway/src/index.ts                 # wire /ws/voice upgrade + GET /api/voice/status
gateway/src/routes/route-catalog.ts  # add voice.status
gateway/package.json                 # no new deps in P0/P1; sidecar is Python
```

Tests:

```
gateway/tests/unit/voice-types.test.ts
gateway/tests/unit/voice-catalog.test.ts
gateway/tests/unit/voice-registry.test.ts
gateway/tests/unit/voice-config.test.ts
gateway/tests/unit/voice-qwen3-sidecar.test.ts
gateway/tests/unit/voice-qwen3-asr.test.ts
gateway/tests/unit/voice-protocol.test.ts
gateway/tests/unit/voice-session-asr.test.ts
gateway/tests/unit/voice-runtime.test.ts
gateway/tests/unit/voice-ws.test.ts
gateway/tests/unit/voice-status.test.ts
gateway/tests/unit/voice-bench.test.ts
```

---

### Task 1: Voice types and capability validation

**Files:**
- Create: `gateway/src/voice/types.ts`
- Test: `gateway/tests/unit/voice-types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `AsrCapabilities { streaming:'native'|'none'; languages:string[]; punctuation:boolean; timestamps:'word'|'segment'|'none'; sampleRate:number; maxAudioSeconds?:number }`
  - `AsrResult { text:string; language?:string; words?:Array<{text:string;startMs:number;endMs:number}>; confidence?:number; durationMs:number; engine:string; final:boolean }`
  - `AsrOptions { sessionId:string; language?:string; sampleRate:number; signal?:AbortSignal }`
  - `AsrStream { push(pcm:Buffer):void; end():Promise<AsrResult>; abort():void; onPartial(cb:(text:string)=>void):void }`
  - `AsrEngine { name:string; capabilities:AsrCapabilities; isAvailable():Promise<{ok:boolean;reason?:string}>; createStream(opts:AsrOptions):AsrStream; transcribe(audio:Buffer, opts:AsrOptions):Promise<AsrResult> }`
  - `assertAsrCapabilities(caps:AsrCapabilities):void`
  - `supportsLanguage(caps:{languages:string[]}, language?:string):boolean`
  - `VoiceTier = 'auto'|'local'|'cloud'`
  - `VoiceEngineTier = 'dgpu'|'igpu'|'cloud'`
  - `RoutingStatus = 'local_accelerated'|'local_cpu'|'cloud'|'degraded'`

- [ ] **Step 1: Write the failing test**

```ts
import { assertAsrCapabilities, supportsLanguage, type AsrCapabilities } from '../../src/voice/types';

const caps = (over: Partial<AsrCapabilities> = {}): AsrCapabilities => ({
  streaming: 'native', languages: ['zh'], punctuation: true,
  timestamps: 'none', sampleRate: 16000, ...over,
});

test('rejects non-positive sampleRate', () => {
  expect(() => assertAsrCapabilities(caps({ sampleRate: 0 }))).toThrow(/sampleRate/);
});

test('rejects empty languages', () => {
  expect(() => assertAsrCapabilities(caps({ languages: [] }))).toThrow(/languages/);
});

test('accepts a valid capability set', () => {
  expect(() => assertAsrCapabilities(caps())).not.toThrow();
});

test('supports exact and region-tagged languages', () => {
  expect(supportsLanguage(caps(), 'zh')).toBe(true);
  expect(supportsLanguage(caps(), 'zh-CN')).toBe(true);
  expect(supportsLanguage(caps(), 'en')).toBe(false);
  expect(supportsLanguage(caps(), undefined)).toBe(true);
  expect(supportsLanguage({ languages: ['multi'] }, 'en')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-types.test.ts`
Expected: FAIL because `../../src/voice/types` does not exist.

- [ ] **Step 3: Implement types and validators**

Create `gateway/src/voice/types.ts` with the interfaces above. `assertAsrCapabilities` throws `Error('AsrCapabilities.sampleRate must be > 0')` and `Error('AsrCapabilities.languages must not be empty')`. `supportsLanguage` returns true for `undefined`/empty/`'auto'`, true for `'multi'`, else compares the lowercase base tag before the first `-`/`_`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/voice-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/types.ts gateway/tests/unit/voice-types.test.ts
git commit -m "feat(voice): add ASR capability types and validation"
```

---

### Task 2: Typed model catalog and built-in license gate

**Files:**
- Create: `gateway/src/voice/catalog.ts`
- Test: `gateway/tests/unit/voice-catalog.test.ts`

**Interfaces:**
- Consumes: `VoiceEngineTier` from `gateway/src/voice/types.ts`.
- Produces:
  - `VoiceModelKind = 'asr'|'tts'`
  - `VoiceLicense = 'Apache-2.0'|'MIT'|'BSD-2-Clause'|'user-plugin'`
  - `VoiceModelEntry { id:string; kind:VoiceModelKind; tier:VoiceEngineTier; engine:string; languages:string[]; license:VoiceLicense; sizeBytes:number; files:Array<{url:string;sha256:string;path:string}>; requires?:{ramGb?:number;vramGb?:number}; capabilities:Record<string,unknown> }`
  - `VOICE_MODELS: readonly VoiceModelEntry[]`
  - `findVoiceModel(id:string): VoiceModelEntry | undefined`
  - `voiceModelsFor(kind:VoiceModelKind, tier?:VoiceEngineTier): VoiceModelEntry[]`
  - `assertBuiltinLicense(model:VoiceModelEntry): void`

- [ ] **Step 1: Write the failing test**

```ts
import { assertBuiltinLicense, findVoiceModel, voiceModelsFor, VOICE_MODELS } from '../../src/voice/catalog';

test('catalog has the v1 dGPU ASR primary', () => {
  const m = findVoiceModel('qwen3-asr-1.7b-vllm');
  expect(m?.kind).toBe('asr');
  expect(m?.tier).toBe('dgpu');
  expect(m?.engine).toBe('qwen3-asr-vllm');
});

test('iGPU ASR list contains Zipformer and Qwen3 0.6B', () => {
  const ids = voiceModelsFor('asr', 'igpu').map(m => m.id);
  expect(ids).toContain('sherpa-zipformer-bilingual-zh-en');
  expect(ids).toContain('qwen3-asr-0.6b');
});

test('iGPU TTS list contains Kokoro and MeloTTS', () => {
  const ids = voiceModelsFor('tts', 'igpu').map(m => m.id);
  expect(ids).toContain('kokoro-zh-en');
  expect(ids).toContain('melo-zh-en');
});

test('built-in license gate accepts Apache/MIT/BSD and rejects user-plugin', () => {
  const builtin = VOICE_MODELS.find(m => m.id === 'qwen3-asr-1.7b-vllm')!;
  expect(() => assertBuiltinLicense(builtin)).not.toThrow();
  expect(() => assertBuiltinLicense({ ...builtin, license: 'user-plugin' }))
    .toThrow(/user-plugin/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-catalog.test.ts`
Expected: FAIL because `../../src/voice/catalog` does not exist.

- [ ] **Step 3: Implement catalog**

Create entries with exact ids/engines:

| id | kind | tier | engine | license | languages |
|---|---|---|---|---|---|
| `qwen3-asr-1.7b-vllm` | asr | dgpu | `qwen3-asr-vllm` | Apache-2.0 | zh,en |
| `qwen3-asr-0.6b` | asr | igpu | `sherpa-qwen3-asr` | Apache-2.0 | zh,en |
| `sherpa-zipformer-bilingual-zh-en` | asr | igpu | `sherpa-zipformer` | Apache-2.0 | zh,en |
| `cosyvoice3-0.5b` | tts | dgpu | `cosyvoice3` | Apache-2.0 | zh,en |
| `qwen3-tts-0.6b` | tts | dgpu | `qwen3-tts` | Apache-2.0 | zh,en |
| `kokoro-zh-en` | tts | igpu | `sherpa-kokoro` | Apache-2.0 | zh,en |
| `melo-zh-en` | tts | igpu | `sherpa-melo` | MIT | zh,en |

Use placeholder `files` with real upstream URLs where known and `sha256: ''`; the model manager in a later plan fills checksums. `assertBuiltinLicense` throws `Error('model <id> uses user-plugin license; accept it before use')` for `user-plugin`, passes the three built-in licenses.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/voice-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/catalog.ts gateway/tests/unit/voice-catalog.test.ts
git commit -m "feat(voice): add typed model catalog and license gate"
```

---

### Task 3: ASR engine registry

**Files:**
- Create: `gateway/src/voice/registry.ts`
- Test: `gateway/tests/unit/voice-registry.test.ts`

**Interfaces:**
- Consumes: `AsrEngine` from `gateway/src/voice/types.ts`.
- Produces:
  - `class AsrEngineRegistry { register(engine:AsrEngine):void; resolve(name?:string):AsrEngine; list():Array<{name:string; capabilities:AsrCapabilities; source:'builtin'|'plugin'}> }`
  - `DEFAULT_ASR_ENGINE = 'qwen3-asr-vllm'`

- [ ] **Step 1: Write the failing test**

```ts
import { AsrEngineRegistry } from '../../src/voice/registry';
import type { AsrEngine } from '../../src/voice/types';

function fakeAsr(name: string): AsrEngine {
  return {
    name,
    capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({ push: () => {}, end: async () => ({ text: '', durationMs: 0, engine: name, final: true }), abort: () => {}, onPartial: () => {} }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
  };
}

test('resolves a registered engine by name', () => {
  const r = new AsrEngineRegistry();
  r.register(fakeAsr('qwen3-asr-vllm'));
  expect(r.resolve('qwen3-asr-vllm').name).toBe('qwen3-asr-vllm');
});

test('resolves the default engine when name is omitted', () => {
  const r = new AsrEngineRegistry();
  r.register(fakeAsr('qwen3-asr-vllm'));
  expect(r.resolve().name).toBe('qwen3-asr-vllm');
});

test('throws for unknown engine', () => {
  const r = new AsrEngineRegistry();
  expect(() => r.resolve('nope')).toThrow(/unknown asr engine/i);
});

test('list reports capabilities and source', () => {
  const r = new AsrEngineRegistry();
  r.register(fakeAsr('qwen3-asr-vllm'));
  expect(r.list()[0]).toMatchObject({ name: 'qwen3-asr-vllm', source: 'builtin' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-registry.test.ts`
Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement registry**

Use a `Map<string, AsrEngine>`. `register` overwrites duplicates. `resolve(name?)` uses `name ?? DEFAULT_ASR_ENGINE`; if missing, throw `Error('unknown ASR engine: <name>')`. `list()` returns `{ name, capabilities, source: 'builtin' }` for now; a later plugin task can add `source:'plugin'` by a second registration method.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/voice-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/registry.ts gateway/tests/unit/voice-registry.test.ts
git commit -m "feat(voice): add ASR engine registry"
```

---

### Task 4: Voice config loader

**Files:**
- Create: `gateway/src/voice/config.ts`
- Test: `gateway/tests/unit/voice-config.test.ts`

**Interfaces:**
- Consumes: `VoiceTier` from `gateway/src/voice/types.ts`.
- Produces:
  - `VoiceConfig { tier:VoiceTier; localTier:'dgpu'|'igpu'; asrEngine:string; ttsEngine:string; cloudConsent:boolean; modelsDir:string; sidecarPort:number }`
  - `DEFAULT_VOICE_CONFIG: VoiceConfig`
  - `resolveVoiceConfig(raw:any, env?:Record<string,string|undefined>): VoiceConfig`

- [ ] **Step 1: Write the failing test**

```ts
import { DEFAULT_VOICE_CONFIG, resolveVoiceConfig } from '../../src/voice/config';

test('defaults to auto/dgpu/qwen3-asr', () => {
  const c = resolveVoiceConfig({});
  expect(c.tier).toBe('auto');
  expect(c.localTier).toBe('dgpu');
  expect(c.asrEngine).toBe('qwen3-asr-1.7b-vllm');
  expect(c.cloudConsent).toBe(false);
});

test('raw voice block overrides defaults', () => {
  const c = resolveVoiceConfig({ voice: { tier: 'local', localTier: 'igpu', asrEngine: 'sherpa-zipformer' } });
  expect(c.tier).toBe('local');
  expect(c.localTier).toBe('igpu');
  expect(c.asrEngine).toBe('sherpa-zipformer');
});

test('invalid tier falls back to auto', () => {
  expect(resolveVoiceConfig({ voice: { tier: 'bogus' } }).tier).toBe('auto');
});

test('env overrides win over raw config', () => {
  const c = resolveVoiceConfig({ voice: { tier: 'local' } }, { MAFW_VOICE_TIER: 'cloud' });
  expect(c.tier).toBe('cloud');
});

test('modelsDir defaults under ~/.mafw/models/voice', () => {
  expect(DEFAULT_VOICE_CONFIG.modelsDir.replace(/\\/g, '/')).toMatch(/\.mafw\/models\/voice$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-config.test.ts`
Expected: FAIL because `../../src/voice/config` does not exist.

- [ ] **Step 3: Implement config loader**

Use `os.homedir()` and `path.join`. `resolveVoiceConfig` merges `raw?.voice ?? {}` over defaults, then applies `MAFW_VOICE_TIER`, `MAFW_VOICE_LOCAL_TIER`, `MAFW_VOICE_ASR_ENGINE`, `MAFW_VOICE_TTS_ENGINE`, `MAFW_VOICE_CLOUD_CONSENT` (`'1'|'true'`), `MAFW_VOICE_SIDECAR_PORT`. Validate tier against `auto|local|cloud`; invalid → `auto`. Validate localTier against `dgpu|igpu`; invalid → `dgpu`. Port parse; invalid → default 3911.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/voice-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/config.ts gateway/tests/unit/voice-config.test.ts
git commit -m "feat(voice): add voice config loader"
```

---

### Task 5: Qwen3-ASR sidecar lifecycle

**Files:**
- Create: `gateway/src/voice/sidecar/qwen3-asr-sidecar.ts`
- Test: `gateway/tests/unit/voice-qwen3-sidecar.test.ts`

**Interfaces:**
- Consumes: Node `child_process`, `path`, `os`.
- Produces:
  - `Qwen3AsrSidecarOptions { python?:string; scriptPath?:string; model?:string; port?:number; gpuMemoryUtilization?:number; modelsDir?:string; startupTimeoutMs?:number; spawnImpl?:typeof spawn; fetchImpl?:typeof fetch; sleepImpl?:(ms:number)=>Promise<void> }`
  - `class Qwen3AsrSidecar { start():Promise<void>; stop():Promise<void>; isReady():Promise<boolean>; get baseUrl():string; get wsUrl():string; get pid():number|undefined }`

- [ ] **Step 1: Write the failing test**

```ts
import { EventEmitter } from 'events';
import { Qwen3AsrSidecar } from '../../src/voice/sidecar/qwen3-asr-sidecar';

class FakeChild extends EventEmitter {
  pid = 1234; stdout = new EventEmitter(); stderr = new EventEmitter();
  killed = false;
  kill = () => { this.killed = true; return true; };
}

test('start spawns the sidecar and waits for health', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3911,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({ ok: true })) as any,
    sleepImpl: async () => {},
  });
  await sidecar.start();
  expect(sidecar.pid).toBe(1234);
  expect(sidecar.baseUrl).toBe('http://127.0.0.1:3911');
});

test('start rejects with stderr when the child exits before health', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3912,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({ ok: false })) as any,
    sleepImpl: async () => { child.emit('exit', 2); },
    startupTimeoutMs: 50,
  });
  await expect(sidecar.start()).rejects.toThrow(/exited|stderr|sidecar/i);
});

test('stop kills the child and is idempotent', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3913,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({ ok: true })) as any,
    sleepImpl: async () => {},
  });
  await sidecar.start();
  await sidecar.stop();
  await sidecar.stop();
  expect(child.killed).toBe(true);
  expect(sidecar.pid).toBeUndefined();
});

test('start rejects when health never becomes ready', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3914,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({ ok: false })) as any,
    sleepImpl: async () => {},
    startupTimeoutMs: 20,
  });
  await expect(sidecar.start()).rejects.toThrow(/health|timeout|sidecar/i);
});

test('start reports port conflict from stderr', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3915,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({ ok: false })) as any,
    sleepImpl: async () => {},
    startupTimeoutMs: 1000,
  });
  const pending = sidecar.start();
  child.stderr.emit('data', Buffer.from('OSError: [Errno 98] Address already in use'));
  child.emit('exit', 1);
  await expect(pending).rejects.toThrow(/sidecar_port_in_use/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-qwen3-sidecar.test.ts`
Expected: FAIL because the sidecar class does not exist.

- [ ] **Step 3: Implement sidecar lifecycle**

Spawn `python <scriptPath> --model <model> --port <port> --gpu-memory-utilization <n> --cache-dir <modelsDir>` with `windowsHide: true`, `stdio: ['ignore','pipe','pipe']`, and `env: { ...process.env, HF_HOME: path.join(modelsDir, 'hf') }`. Default `modelsDir` is `path.join(os.homedir(), '.mafw', 'models', 'voice')`. Capture the last 20 stderr lines. Poll `GET http://127.0.0.1:<port>/health` every 500 ms until `startupTimeoutMs` (default 180_000). If the child exits first, reject with the stderr tail. If the timeout expires, reject with `sidecar_health_timeout` plus the stderr tail; if the tail contains `address already in use` (case-insensitive), wrap the message as `sidecar_port_in_use`. `stop()` calls `child.kill()` first (so tests and simple cases work), then `taskkill /PID <pid> /T /F` on Windows to kill the tree; wait up to 5 s; clear `pid`. `isReady()` does one health fetch with a 1 s timeout.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/voice-qwen3-sidecar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/sidecar/qwen3-asr-sidecar.ts gateway/tests/unit/voice-qwen3-sidecar.test.ts
git commit -m "feat(voice): add Qwen3-ASR sidecar lifecycle"
```

---

### Task 6: Qwen3-ASR streaming adapter

**Files:**
- Create: `gateway/src/voice/engines/asr/qwen3-vllm.ts`
- Create: `gateway/voice_sidecars/qwen3_asr_server.py`
- Create: `gateway/voice_sidecars/requirements.txt`
- Test: `gateway/tests/unit/voice-qwen3-asr.test.ts`

**Interfaces:**
- Consumes: `AsrEngine`, `AsrResult`, `AsrStream`, `AsrOptions` from `gateway/src/voice/types.ts`; `Qwen3AsrSidecar`.
- Produces:
  - `class Qwen3AsrEngine implements AsrEngine { constructor(deps:{ sidecar: Qwen3AsrSidecar; wsFactory?:(url:string)=>WebSocket; fetchImpl?:typeof fetch }); name='qwen3-asr-vllm'; capabilities={ streaming:'native', languages:['zh','en'], punctuation:true, timestamps:'none', sampleRate:16000 } }`

Sidecar protocol (must match the Python script):

- WS `ws://127.0.0.1:<port>/stream`
- Client sends `{"type":"start","language":"zh","sampleRate":16000}` then binary PCM16 frames.
- Client sends `{"type":"end"}`.
- Server sends `{"type":"partial","text":"..."}` / `{"type":"final","text":"...","language":"zh","durationMs":123}` / `{"type":"error","message":"..."}`.
- HTTP `POST /transcribe` body `{"audio_b64":"...","language":"zh","sampleRate":16000}` → `{"text":"...","language":"zh","durationMs":123}`.
- `GET /health` → `{"ok":true}`.

- [ ] **Step 1: Write the failing test**

Use a real `ws` server on an ephemeral port as the fake sidecar:

```ts
import { WebSocketServer } from 'ws';
import { Qwen3AsrEngine } from '../../src/voice/engines/asr/qwen3-vllm';

test('streams partial and final over the sidecar WS', async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => wss.once('listening', () => r()));
  const port = (wss.address() as any).port;
  wss.on('connection', (ws) => {
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'start') ws.send(JSON.stringify({ type: 'partial', text: '你' }));
      if (msg.type === 'end') {
        ws.send(JSON.stringify({ type: 'partial', text: '你好' }));
        ws.send(JSON.stringify({ type: 'final', text: '你好。', language: 'zh', durationMs: 40 }));
      }
    });
  });
  const engine = new Qwen3AsrEngine({
    sidecar: { wsUrl: `ws://127.0.0.1:${port}/stream`, isReady: async () => true } as any,
  });
  const stream = engine.createStream({ sessionId: 's1', language: 'zh', sampleRate: 16000 });
  const partials: string[] = [];
  stream.onPartial(t => partials.push(t));
  stream.push(Buffer.alloc(320));
  const final = await stream.end();
  expect(partials).toEqual(['你', '你好']);
  expect(final).toMatchObject({ text: '你好。', language: 'zh', final: true, engine: 'qwen3-asr-vllm' });
  await new Promise<void>(r => wss.close(() => r()));
});

test('transcribe posts base64 audio to /transcribe', async () => {
  const calls: any[] = [];
  const engine = new Qwen3AsrEngine({
    sidecar: { baseUrl: 'http://127.0.0.1:9', isReady: async () => true } as any,
    fetchImpl: (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ text: 'hi', language: 'en', durationMs: 10 }) };
    }) as any,
  });
  const r = await engine.transcribe(Buffer.from('abc'), { sessionId: 's1', language: 'en', sampleRate: 16000 });
  expect(r.text).toBe('hi');
  expect(calls[0].url).toContain('/transcribe');
  expect(calls[0].body.audio_b64).toBe(Buffer.from('abc').toString('base64'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-qwen3-asr.test.ts`
Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement adapter and sidecar script**

Node adapter opens the WS on `createStream`, sends `start`, forwards binary frames, resolves `end()` on `final`, rejects on `error`/close before final, and `abort()` sends `{"type":"abort"}` + closes. Queue `push()`/`end()` calls made before the socket `open` event; flush them after `start`. `onPartial` may be registered before/after `start`; buffer the latest partial until a callback exists. `isAvailable()` delegates to `sidecar.isReady()`.

Python sidecar: FastAPI app with `/health`, `/transcribe`, and `/stream`; load `Qwen3ASRModel.LLM(...)` once at startup with `gpu_memory_utilization`; stream partial/final using the `qwen-asr` streaming API. `requirements.txt` contains `qwen-asr[vllm]`, `fastapi`, `uvicorn[standard]`, `websockets`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/voice-qwen3-asr.test.ts`
Expected: PASS.

Manual sidecar smoke (after installing `requirements.txt` in a venv):
`python gateway/voice_sidecars/qwen3_asr_server.py --model Qwen/Qwen3-ASR-1.7B --port 3911`
`curl http://127.0.0.1:3911/health` → `{"ok":true}`.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/engines/asr/qwen3-vllm.ts gateway/voice_sidecars/qwen3_asr_server.py gateway/voice_sidecars/requirements.txt gateway/tests/unit/voice-qwen3-asr.test.ts
git commit -m "feat(voice): add Qwen3-ASR streaming adapter and sidecar"
```

---

### Task 7: `/ws/voice` protocol codec

**Files:**
- Create: `gateway/src/voice/transport/protocol.ts`
- Test: `gateway/tests/unit/voice-protocol.test.ts`

**Interfaces:**
- Consumes: `VoiceTier` from `gateway/src/voice/types.ts`.
- Produces:
  - `VoiceClientMessage` union: `hello` / `vad.speech_started` / `vad.speech_stopped` / `end_audio` / `cancel` / `stop` / `config`.
  - `VoiceServerMessage` union: `ready` / `asr.partial` / `asr.final` / `routing` / `error` / `turn.cancelled` / `turn.done`.
  - `parseClientMessage(raw:string):VoiceClientMessage` (throws `Error('invalid_voice_message: ...')`).
  - `serverError(code:string, message:string, recoverable=false):VoiceServerMessage`.

- [ ] **Step 1: Write the failing test**

```ts
import { parseClientMessage, serverError } from '../../src/voice/transport/protocol';

test('parses a valid hello', () => {
  const m = parseClientMessage(JSON.stringify({
    type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto',
    language: 'zh', format: 'pcm16', clientVad: true,
  }));
  expect(m).toMatchObject({ type: 'hello', sessionId: 's1', tier: 'auto' });
});

test('rejects missing sessionId', () => {
  expect(() => parseClientMessage(JSON.stringify({ type: 'hello', mode: 'continuous' })))
    .toThrow(/sessionId/);
});

test('rejects unknown type', () => {
  expect(() => parseClientMessage(JSON.stringify({ type: 'nope' }))).toThrow(/invalid_voice_message/);
});

test('rejects invalid tier', () => {
  expect(() => parseClientMessage(JSON.stringify({ type: 'hello', sessionId: 's1', tier: 'bogus' })))
    .toThrow(/tier/);
});

test('serverError has a stable shape', () => {
  expect(serverError('hello_required', 'send hello first')).toEqual({
    type: 'error', code: 'hello_required', message: 'send hello first', recoverable: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-protocol.test.ts`
Expected: FAIL because the codec does not exist.

- [ ] **Step 3: Implement codec**

Parse JSON; switch on `type`; validate required fields. `hello` requires `sessionId`, `mode === 'continuous'`, `tier` in `auto|local|cloud`, `format === 'pcm16'`, `clientVad` boolean. `config` accepts optional `tier/voice/language`. Unknown/invalid throws `Error('invalid_voice_message: <reason>')`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/voice-protocol.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/transport/protocol.ts gateway/tests/unit/voice-protocol.test.ts
git commit -m "feat(voice): add /ws/voice protocol codec"
```

---

### Task 8: ASR-only voice session state machine

**Files:**
- Create: `gateway/src/voice/session.ts`
- Test: `gateway/tests/unit/voice-session-asr.test.ts`

**Interfaces:**
- Consumes: `AsrEngine`, `AsrStream`, `AsrResult`, `VoiceTier`; `VoiceClientMessage`, `VoiceServerMessage`.
- Produces:
  - `VoiceSessionDeps { asr:AsrEngine; send:(msg:VoiceServerMessage)=>void; now?:()=>number }`
  - `class VoiceSession { constructor(deps:VoiceSessionDeps); handleControl(msg:VoiceClientMessage):Promise<void>; handleAudio(pcm:Buffer):void; close():void; readonly state:'idle'|'listening'|'processing'|'closed' }`

- [ ] **Step 1: Write the failing test**

Use a fake ASR engine whose `createStream` captures callbacks:

```ts
import { VoiceSession } from '../../src/voice/session';

function fakeAsr() {
  const sent: any[] = [];
  let partialCb: ((t: string) => void) | undefined;
  let aborted = false;
  const engine = {
    name: 'fake', capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({
      push: () => {},
      abort: () => { aborted = true; },
      onPartial: (cb: any) => { partialCb = cb; },
      end: async () => ({ text: '你好。', language: 'zh', durationMs: 40, engine: 'fake', final: true }),
    }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: 'fake', final: true }),
  } as any;
  return { engine, sent, emitPartial: (t: string) => partialCb?.(t), wasAborted: () => aborted };
}

test('hello -> partial -> final -> turn.done', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true });
  f.emitPartial('你');
  s.handleAudio(Buffer.alloc(320));
  await s.handleControl({ type: 'end_audio' });
  const types = f.sent.map(m => m.type);
  expect(types).toEqual(['ready', 'asr.partial', 'asr.final', 'turn.done']);
  expect(f.sent[2]).toMatchObject({ text: '你好。', final: true });
});

test('cancel aborts the stream and suppresses a late final', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true });
  await s.handleControl({ type: 'cancel' });
  expect(f.wasAborted()).toBe(true);
  expect(f.sent.some(m => m.type === 'turn.cancelled')).toBe(true);
  expect(f.sent.some(m => m.type === 'asr.final')).toBe(false);
});

test('binary before hello is rejected', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  s.handleAudio(Buffer.alloc(320));
  expect(f.sent[0]).toMatchObject({ type: 'error', code: 'hello_required' });
});

test('unsupported language is rejected before ASR call', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'en', format: 'pcm16', clientVad: true });
  expect(f.sent[0]).toMatchObject({ type: 'error', code: 'language_unsupported' });
});

test('end_audio with no audio returns empty_audio', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({ type: 'hello', sessionId: 's1', mode: 'continuous', tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true });
  await s.handleControl({ type: 'end_audio' });
  expect(f.sent.some(m => m.code === 'empty_audio')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-session-asr.test.ts`
Expected: FAIL because `VoiceSession` does not exist.

- [ ] **Step 3: Implement session**

State: `idle | listening | processing | closed`. `hello` validates `supportsLanguage`, creates the ASR stream, sends `ready` with `{ routing:{status:'local_accelerated'}, asr:{engine, streaming}, tts:null }`, state `listening`. `handleAudio` before hello sends `hello_required` and returns; otherwise pushes. `end_audio` in `listening` → state `processing`; await `stream.end()`, send `asr.final` then `turn.done`, state `listening`, create a fresh stream for the next turn. `cancel` aborts, sends `turn.cancelled`, state `listening`, fresh stream. `close` aborts and sets `closed`. Empty audio: if no bytes were pushed, `end_audio` sends `error` code `empty_audio` and stays `listening`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix gateway -- tests/unit/voice-session-asr.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/session.ts gateway/tests/unit/voice-session-asr.test.ts
git commit -m "feat(voice): add ASR-only voice session state machine"
```

---

### Task 9: VoiceRuntime and status route

**Files:**
- Create: `gateway/src/voice/runtime.ts`
- Create: `gateway/src/voice/routes/voice-status.ts`
- Test: `gateway/tests/unit/voice-runtime.test.ts`, `gateway/tests/unit/voice-status.test.ts`

**Interfaces:**
- Consumes: `AsrEngineRegistry`, `VoiceSession`, `AsrEngine`, `VoiceConfig`.
- Produces:
  - `VoiceRuntimeDeps { registry:AsrEngineRegistry; config:VoiceConfig; createAsr:(name:string)=>Promise<AsrEngine> }`
  - `class VoiceRuntime { constructor(deps:VoiceRuntimeDeps); createSession(send:(msg:VoiceServerMessage)=>void):Promise<VoiceSession>; status():{config:VoiceConfig; engines:ReturnType<AsrEngineRegistry['list']>} }`
  - `handleVoiceStatus(req:any,res:any,deps:{ runtime?:VoiceRuntime; config:VoiceConfig }):Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
import { VoiceRuntime } from '../../src/voice/runtime';
import { handleVoiceStatus } from '../../src/voice/routes/voice-status';
import { AsrEngineRegistry } from '../../src/voice/registry';
import { DEFAULT_VOICE_CONFIG } from '../../src/voice/config';

test('status returns config and an engine list', async () => {
  const res = { status: 0, body: '', writeHead(s: number) { this.status = s; }, end(b: string) { this.body = b; } } as any;
  await handleVoiceStatus({}, res, { config: DEFAULT_VOICE_CONFIG });
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({ ok: true, engines: [] });
});

test('createSession resolves the configured ASR engine', async () => {
  const registry = new AsrEngineRegistry();
  const engine = {
    name: 'qwen3-asr-vllm',
    capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({ push:()=>{}, abort:()=>{}, onPartial:()=>{}, end:async()=>({text:'',durationMs:0,engine:'qwen3-asr-vllm',final:true}) }),
    transcribe: async () => ({ text:'',durationMs:0,engine:'qwen3-asr-vllm',final:true }),
  } as any;
  registry.register(engine);
  const rt = new VoiceRuntime({
    registry,
    config: { ...DEFAULT_VOICE_CONFIG, asrEngine: 'qwen3-asr-vllm' },
    createAsr: async () => engine,
  });
  const session = await rt.createSession(() => {});
  expect(session).toBeDefined();
  expect(rt.status().engines[0].name).toBe('qwen3-asr-vllm');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-runtime.test.ts`
Expected: FAIL because `../../src/voice/runtime` does not exist.

- [ ] **Step 3: Implement runtime and status route**

`VoiceRuntime.createSession(send)` resolves `deps.config.asrEngine` via `deps.registry` if present; otherwise calls `deps.createAsr(name)` and registers it. It returns `new VoiceSession({ asr, send })`. `status()` returns the config and `registry.list()`. `handleVoiceStatus` writes `200` JSON `{ ok:true, config, engines }`; if `runtime` is absent, returns `{ ok:true, config, engines: [] }` (the sidecar may not be initialized yet).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix gateway -- tests/unit/voice-runtime.test.ts tests/unit/voice-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/runtime.ts gateway/src/voice/routes/voice-status.ts gateway/tests/unit/voice-runtime.test.ts gateway/tests/unit/voice-status.test.ts
git commit -m "feat(voice): add VoiceRuntime and status route"
```

---

### Task 10: WebSocket transport and gateway wiring

**Files:**
- Create: `gateway/src/voice/transport/ws-voice.ts`
- Modify: `gateway/src/index.ts` (imports, `MafwScheduler` voice fields, lazy voice runtime, upgrade handler around line 7461)
- Modify: `gateway/src/routes/route-catalog.ts` (add `voice.status`)
- Test: `gateway/tests/unit/voice-ws.test.ts`

**Interfaces:**
- Consumes: `VoiceRuntime`, `VoiceSession`, `parseClientMessage`, `serverError`, `Qwen3AsrSidecar`, `Qwen3AsrEngine`, `AsrEngineRegistry`, `resolveVoiceConfig`.
- Produces:
  - `VoiceSocketLike { send(data:string|Buffer):void; close(code?:number,reason?:string):void; on(event:'message',cb:(data:Buffer,isBinary:boolean)=>void):void; on(event:'close',cb:()=>void):void }`
  - `attachVoiceSocket(socket:VoiceSocketLike, deps:{ createSession:()=>Promise<VoiceSession> }):void`
  - `isVoiceUpgradePath(url:string):boolean` (true for `/ws/voice` and `/ws/voice?*`)

- [ ] **Step 1: Write the failing test**

```ts
import { attachVoiceSocket, isVoiceUpgradePath } from '../../src/voice/transport/ws-voice';
import { VoiceSession } from '../../src/voice/session';

test('isVoiceUpgradePath only matches /ws/voice', () => {
  expect(isVoiceUpgradePath('/ws/voice')).toBe(true);
  expect(isVoiceUpgradePath('/ws/voice?x=1')).toBe(true);
  expect(isVoiceUpgradePath('/api/ws')).toBe(false);
  expect(isVoiceUpgradePath('/ws/voicex')).toBe(false);
});

test('socket routes hello into the session', async () => {
  const sent: any[] = [];
  const handlers = new Map<string, Function>();
  const socket = { send: (d: any) => sent.push(d), close: () => {}, on: (e: string, cb: Function) => handlers.set(e, cb) } as any;
  const session = new VoiceSession({
    asr: { name:'fake', capabilities:{streaming:'native',languages:['zh'],punctuation:true,timestamps:'none',sampleRate:16000}, isAvailable:async()=>({ok:true}), createStream:()=>({push:()=>{},abort:()=>{},onPartial:()=>{},end:async()=>({text:'x',durationMs:1,engine:'fake',final:true})}), transcribe:async()=>({text:'x',durationMs:1,engine:'fake',final:true}) } as any,
    send: m => sent.push(m),
  });
  attachVoiceSocket(socket, { createSession: async () => session });
  handlers.get('message')!(Buffer.from(JSON.stringify({type:'hello',sessionId:'s1',mode:'continuous',tier:'auto',language:'zh',format:'pcm16',clientVad:true})), false);
  await new Promise(r => setTimeout(r, 0));
  expect(sent[0]).toMatchObject({ type: 'ready' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-ws.test.ts`
Expected: FAIL because the transport does not exist.

- [ ] **Step 3: Implement transport and wiring**

`attachVoiceSocket` parses JSON control messages with `parseClientMessage`; binary frames call `session.handleAudio`; parse errors send `serverError('invalid_voice_message', ...)`; close calls `session.close()`. It creates the session lazily on the first valid `hello`, not on socket open, so a sidecar failure is reported as an error frame rather than a socket drop.

In `MafwScheduler`, add:

```ts
private voiceSidecar?: Qwen3AsrSidecar;
private voiceRuntime?: VoiceRuntime;
private voiceAsrRegistry = new AsrEngineRegistry();
private voiceRuntimeConfig = resolveVoiceConfig({});
private voiceWss?: WebSocketServer;
```

Add a lazy `getVoiceRuntime()` method: create `Qwen3AsrSidecar` with `port: this.voiceRuntimeConfig.sidecarPort` and `modelsDir: this.voiceRuntimeConfig.modelsDir`, call `start()`, register `new Qwen3AsrEngine({ sidecar })` in `this.voiceAsrRegistry`, then return `new VoiceRuntime({ registry, config, createAsr: async (name) => this.voiceAsrRegistry.resolve(name) })`. Do **not** start the sidecar at gateway boot; a missing Python env must not break startup.

Initialize `this.voiceWss = new WebSocketServer({ noServer: true });` once near the existing `wss` at line ~7398. In the upgrade handler (line ~7461), before the `/api/ws` check:

```ts
if (isVoiceUpgradePath(url)) {
  if (!isLoopbackAddr(rawAddr)) {
    const wsAuth = authorizeWsUpgrade({ remoteAddress: rawAddr, headers: req.headers as any, url, host: String(req.headers.host || '') }, wsToken);
    if (!wsAuth.ok) { socket.write(wsAuth.rejectResponse!); socket.destroy(); return; }
  }
  this.voiceWss!.handleUpgrade(req, socket, head, (ws) => attachVoiceSocket(ws as any, {
    createSession: async () => (await this.getVoiceRuntime()).createSession((m) => ws.send(JSON.stringify(m))),
  }));
  return;
}
```

Add `GET /api/voice/status` route before the dashboard fallback; add `{ method:'GET', path:'/api/voice/status', operationId:'voice.status', tags:['voice'] }` to `route-catalog.ts`.

- [ ] **Step 4: Run test and build**

Run: `npm test --prefix gateway -- tests/unit/voice-ws.test.ts`
Expected: PASS. Then `npm run build --prefix gateway` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/transport/ws-voice.ts gateway/src/index.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/voice-ws.test.ts
git commit -m "feat(voice): wire /ws/voice into gateway"
```

---

### Task 11: Benchmark harness and 4090 acceptance

**Files:**
- Create: `gateway/scripts/voice-bench.ts`
- Test: `gateway/tests/unit/voice-bench.test.ts`

**Interfaces:**
- Consumes: `ws` client; `parseClientMessage`/server events; a WAV file path.
- Produces:
  - `summarizeBench(samples:{firstPartialMs?:number;finalMs?:number;text:string}[]):{count:number;firstPartialP50:number;finalP50:number;empty:number}`
  - CLI `npx ts-node gateway/scripts/voice-bench.ts --url ws://127.0.0.1:3000/ws/voice --wav <file> [--repeat 3]`

- [ ] **Step 1: Write the failing test**

```ts
import { summarizeBench } from '../../scripts/voice-bench';

test('summarizeBench computes p50 and empty count', () => {
  const r = summarizeBench([
    { firstPartialMs: 100, finalMs: 300, text: 'a' },
    { firstPartialMs: 200, finalMs: 500, text: '' },
    { firstPartialMs: 300, finalMs: 700, text: 'c' },
  ]);
  expect(r.count).toBe(3);
  expect(r.firstPartialP50).toBe(200);
  expect(r.finalP50).toBe(500);
  expect(r.empty).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/voice-bench.test.ts`
Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement benchmark**

Read a 16 kHz mono PCM16 WAV (strip 44-byte header; reject other formats with a clear error). Connect to `/ws/voice`, send `hello`, stream 20 ms frames (640 bytes) with a small delay, send `end_audio`, measure `asr.partial` and `asr.final`. Repeat N times; print JSON. `summarizeBench` sorts values and returns p50.

- [ ] **Step 4: Run test + manual 4090 acceptance**

Run: `npm test --prefix gateway -- tests/unit/voice-bench.test.ts` → PASS.

On the 4090, start the sidecar and gateway, then:

```bash
npx ts-node gateway/scripts/voice-bench.ts --url ws://127.0.0.1:3000/ws/voice --wav docs/fixtures/voice/zh-01.wav --repeat 3
```

Record the JSON in `docs/research/2026-10-28-voice-bench-p1.md`. Acceptance: first partial ≤200 ms, final ≤300 ms (hot model, p50 over 30 clips).

- [ ] **Step 5: Commit**

```bash
git add gateway/scripts/voice-bench.ts gateway/tests/unit/voice-bench.test.ts docs/research/2026-10-28-voice-bench-p1.md
git commit -m "feat(voice): add /ws/voice benchmark harness and P1 results"
```

---

## P0/P1 Done Criteria

- `npm test --prefix gateway -- tests/unit/voice-*.test.ts` is green.
- `npm run build --prefix gateway` exits 0.
- `/ws/voice` accepts `hello` + PCM16 + `end_audio` and returns `asr.partial`/`asr.final` from Qwen3-ASR-1.7B on the local 4090.
- `GET /api/voice/status` returns config + registered ASR engines.
- Sidecar can be started/stopped repeatedly; a missing Python env yields `model_not_available`/`sidecar_unavailable`, not a gateway crash.
- Benchmark JSON is recorded; first partial p50 ≤200 ms and final p50 ≤300 ms on the reference machine.

## Next Plan

P2 (CosyVoice3 TTS + sentence streaming + desktop continuous loop + barge-in + external-speaker AEC) is a separate plan. Do not start it until this P0/P1 slice is green and the benchmark is recorded.
