# Voice Duplex v1 Plan 1 — ASR 产品化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实 Desktop 通过 `/ws/voice` 持续发送麦克风 PCM，显示流式 ASR partial/final，并把 Qwen3-ASR sidecar 从“只有 bench 能跑的 P1 切片”推进到可部署、可收养、可停止的生产 ASR 输入层。

**Architecture:** 复用 `gateway/src/voice/` 的 ASR registry、Qwen3-ASR 引擎和 `/ws/voice`，补齐诚实的 session 身份/路由、sidecar adopt 与发布资产。Desktop 新增独立 `DuplexVoiceClient`：连接 ready 后才启动单实例 Silero/麦克风 tap，持续发送 20ms PCM16 帧；本计划只显示 partial/final，不接 LLM/TTS。

**Tech Stack:** TypeScript CJS gateway、Jest 30、Node 24、SolidJS desktop、`ws`、AudioWorklet、Silero VAD、Qwen3-ASR vLLM sidecar。

**Spec:** `docs/superpowers/specs/2026-11-03-voice-duplex-v1-design.md`

## Global Constraints

- 仅实施 Spec Slice A：流式 ASR 产品化；不接 LLM、TTS、播放游标、Smart Turn 或 backchannel。
- `/ws/voice` 二进制方向固定：客户端→服务端麦克风 PCM16 16 kHz mono；服务端二进制本计划不发送。
- `hello` 必须同时携带 `voiceSessionId` 与 `chatSessionId`；两者不得复用同一个字段。
- v1 `clientVad` 只能为 `true`；`false` 返回 `client_vad_required`。
- v1 `tier:'cloud'` 必须返回 `cloud_not_implemented`；不得静默走本地或声称云端可用。
- 功能开关 `voice.duplexV1` 默认 `false`；关闭时现有录音→WAV→Media Agent 路径必须零回归。
- 必须已有打开的 chat session；Welcome 不隐式创建会话。
- Qwen3 sidecar 被收养时 gateway 不拥有/不杀该进程；owned 模式仍必须 `windowsHide: true`、启动失败无孤儿、Windows 树杀。
- `gateway/voice_sidecars/` 必须同时进入 npm package、`deploy-local.mjs`、desktop `stage-gateway.ts`。
- 旧 `/api/tts*`、`mafw_media_speak`、artifact 播放、文本 chat 不修改行为。
- 每个任务 TDD：写失败测试 → 看预期失败 → 最小实现 → 目标测试绿 → 相关全量绿 → 独立 commit。
- 每个任务汇报新增用例数与当时全量用例数；不得用一个超大 commit 混合 gateway、desktop、打包。
- 参考机器为 Windows 11 + 本机 4090；vLLM sidecar 可运行在 WSL2/Linux，并由 gateway adopt。
- 预期首 partial p50 ≤300ms；复用 P1 已实测 180ms 基线，不在本计划重新优化模型。

## Review Focus

- **麦克风连续帧在 VAD 说话结束前没有流出**：用户应在一开口就看到 partial，而不是停口后才有字；Task 6/7 的 fake tap 必须发送早于 `speech_stopped` 的帧。
- **sidecar 端口被无关服务占用却被错误收养**：只有健康响应同时含 `ok:true`、字符串 `model`、数字 `chunkSizeSec` 才能 adopt；Task 3 覆盖。
- **功能开关关闭后旧语音消息链路回归**：Task 5/8 必须保留 legacy 分支，并测试默认 false。
- **start/stop 泄漏麦克风、AudioContext 或 WebSocket**：重复 stop、ready 前 stop、socket error 都必须幂等释放；Task 7 覆盖。
- **发布包缺少 sidecar 脚本，开发机可用而安装包必坏**：Task 4 同时钉住 root files、本地 deploy 和 desktop bundle。

---

## File Structure

**Gateway core**
- Modify `gateway/src/voice/transport/protocol.ts` — 两种 session id、v1 消息身份。
- Modify `gateway/src/voice/session.ts` — clientVad/tier gate、真实 routing、required routing dep。
- Create `gateway/src/voice/routing.ts` — 配置→routing 状态的纯函数。
- Modify `gateway/src/voice/runtime.ts` — 创建 session 时传入 routing；status 暴露 routing。
- Modify `gateway/src/voice/config.ts` — `duplexV1` 开关。
- Modify `gateway/src/voice/routes/voice-status.ts` — status 返回 routing。
- Modify `gateway/src/voice/sidecar/qwen3-asr-sidecar.ts` — external adopt 与兼容健康检查。
- Modify `gateway/src/index.ts` — 把 config routing 传给 runtime/status（只改现状接线处）。

**Gateway tests**
- Modify `gateway/tests/unit/voice-protocol.test.ts`
- Modify `gateway/tests/unit/voice-session-asr.test.ts`
- Modify `gateway/tests/unit/voice-ws.test.ts`
- Modify `gateway/tests/unit/voice-runtime.test.ts`
- Modify `gateway/tests/unit/voice-status.test.ts`
- Modify `gateway/tests/unit/voice-config.test.ts`
- Create `gateway/tests/unit/voice-routing.test.ts`
- Modify `gateway/tests/unit/voice-qwen3-sidecar.test.ts`
- Create `gateway/tests/unit/voice-packaging.test.ts`
- Modify `gateway/scripts/voice-bench.ts` — 新 hello 身份。

**Packaging**
- Modify `package.json` — root `files`。
- Modify `gateway/scripts/deploy-local.mjs`
- Modify `packages/desktop/scripts/stage-gateway.ts`

**SDK / Desktop bridge**
- Modify `packages/gateway-sdk/src/types.ts`
- Modify `packages/gateway-sdk/src/client.ts`
- Modify `packages/gateway-sdk/src/client.test.ts`
- Modify `packages/desktop/src/preload/mafw-types.ts`
- Modify `packages/desktop/src/preload/mafw-api.ts`
- Create `packages/desktop/src/preload/mafw-voice.test.ts`（源码契约测试，若 preload 无 DOM 可执行环境）

**Desktop capture/client/UI**
- Modify `packages/desktop/src/renderer/mafw/voice/types.ts` — `MicInput`、可选 `getInput()`。
- Modify `packages/desktop/src/renderer/mafw/voice/silero.ts` — 暴露共享 stream/context。
- Create `packages/desktop/src/renderer/mafw/voice/pcm-capture.ts`
- Create `packages/desktop/src/renderer/mafw/voice/pcm-capture.test.ts`
- Create `packages/desktop/public/voice/pcm-capture-worklet.js`
- Create `packages/desktop/src/renderer/mafw/voice/duplex-client.ts`
- Create `packages/desktop/src/renderer/mafw/voice/duplex-client.test.ts`
- Create `packages/desktop/src/renderer/mafw/chat/use-duplex-voice.ts`
- Create `packages/desktop/src/renderer/mafw/chat/duplex-voice-mode.ts`
- Create `packages/desktop/src/renderer/mafw/chat/duplex-voice-mode.test.ts`
- Create `packages/desktop/src/renderer/mafw/components/DuplexVoiceBar.tsx`
- Modify `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify `packages/desktop/src/renderer/mafw/mafw.css`（或现有 composer CSS 所在文件）
- Create `packages/desktop/src/renderer/mafw/components/duplex-voice-wiring.test.ts`（源码契约守卫）

---

### Task 1: Split voice/chat session identity and enforce v1 gates

**Files:**
- Modify: `gateway/src/voice/transport/protocol.ts`
- Modify: `gateway/src/voice/session.ts`
- Modify: `gateway/tests/unit/voice-protocol.test.ts`
- Modify: `gateway/tests/unit/voice-session-asr.test.ts`
- Modify: `gateway/tests/unit/voice-ws.test.ts`
- Modify: `gateway/scripts/voice-bench.ts`

**Interfaces:**
- Consumes: 现有 `AsrEngine`、`VoiceSession`、`parseClientMessage`。
- Produces:
  - `VoiceHelloMessage { type:'hello'; voiceSessionId:string; chatSessionId:string; mode:'continuous'; tier:VoiceTier; language?:string; voice?:string; format:'pcm16'; clientVad:boolean }`
  - `parseClientMessage` 对两个 id 都做非空校验。
  - `VoiceSession.handleControl(hello)`：`clientVad:false` → error code `client_vad_required`；`tier:'cloud'` → `cloud_not_implemented`；两者都发生在 ASR stream 创建前。

- [ ] **Step 1: Write the failing tests**

Add to `voice-protocol.test.ts`:

```ts
test('hello requires both voiceSessionId and chatSessionId', () => {
  expect(parseClientMessage(JSON.stringify({
    type: 'hello', voiceSessionId: 'v1', chatSessionId: 'c1', mode: 'continuous',
    tier: 'auto', language: 'zh', format: 'pcm16', clientVad: true,
  }))).toMatchObject({ voiceSessionId: 'v1', chatSessionId: 'c1' });

  expect(() => parseClientMessage(JSON.stringify({
    type: 'hello', chatSessionId: 'c1', mode: 'continuous',
    tier: 'auto', format: 'pcm16', clientVad: true,
  }))).toThrow(/voiceSessionId/);

  expect(() => parseClientMessage(JSON.stringify({
    type: 'hello', voiceSessionId: 'v1', mode: 'continuous',
    tier: 'auto', format: 'pcm16', clientVad: true,
  }))).toThrow(/chatSessionId/);
});
```

Add to `voice-session-asr.test.ts`:

```ts
test('rejects clientVad=false before creating ASR stream', async () => {
  const f = fakeAsr();
  let creates = 0;
  f.engine.createStream = () => { creates += 1; return f.engine.createStream; };
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({
    type: 'hello', voiceSessionId: 'v1', chatSessionId: 'c1', mode: 'continuous',
    tier: 'auto', format: 'pcm16', clientVad: false,
  });
  expect(f.sent[0]).toMatchObject({ type: 'error', code: 'client_vad_required' });
  expect(creates).toBe(0);
});

test('rejects cloud tier explicitly', async () => {
  const f = fakeAsr();
  const s = new VoiceSession({ asr: f.engine, send: m => f.sent.push(m) });
  await s.handleControl({
    type: 'hello', voiceSessionId: 'v1', chatSessionId: 'c1', mode: 'continuous',
    tier: 'cloud', format: 'pcm16', clientVad: true,
  });
  expect(f.sent[0]).toMatchObject({ type: 'error', code: 'cloud_not_implemented' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/voice-protocol.test.ts tests/unit/voice-session-asr.test.ts`

Expected: FAIL because `voiceSessionId`/`chatSessionId` and the two error codes are not implemented.

- [ ] **Step 3: Implement identity and gates**

Update `VoiceHelloMessage`, parser, and `VoiceSession.handleControl`:

```ts
if (!msg.clientVad) {
  this.send({ type: 'error', code: 'client_vad_required', message: 'v1 requires client VAD', recoverable: false });
  return;
}
if (msg.tier === 'cloud') {
  this.send({ type: 'error', code: 'cloud_not_implemented', message: 'cloud voice is not implemented', recoverable: false });
  return;
}
```

Use `msg.voiceSessionId` as the ASR session id; `chatSessionId` is retained on the session for later slices but creates no hidden chat session in Plan 1.

- [ ] **Step 4: Update all existing hello fixtures**

Replace old `sessionId` fixtures in `voice-session-asr.test.ts`, `voice-ws.test.ts`, and `gateway/scripts/voice-bench.ts` with:

```ts
voiceSessionId: '...unique voice id...',
chatSessionId: 'bench-chat',
```

Do not keep an aliasing compatibility branch; `/ws/voice` has no production client yet.

- [ ] **Step 5: Run focused tests**

Run: `npm test --prefix gateway -- tests/unit/voice-protocol.test.ts tests/unit/voice-session-asr.test.ts tests/unit/voice-ws.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/voice/transport/protocol.ts gateway/src/voice/session.ts gateway/tests/unit/voice-protocol.test.ts gateway/tests/unit/voice-session-asr.test.ts gateway/tests/unit/voice-ws.test.ts gateway/scripts/voice-bench.ts
git commit -m "feat(voice): split voice and chat session identity"
```

### Task 2: Report honest local routing and add the duplex feature flag

**Files:**
- Create: `gateway/src/voice/routing.ts`
- Create: `gateway/tests/unit/voice-routing.test.ts`
- Modify: `gateway/src/voice/session.ts`
- Modify: `gateway/src/voice/runtime.ts`
- Modify: `gateway/src/voice/config.ts`
- Modify: `gateway/src/voice/routes/voice-status.ts`
- Modify: `gateway/src/index.ts`（仅 getVoiceRuntime/status 接线处）
- Modify: `gateway/scripts/voice-bench-server.ts`（VoiceSession 构造需显式 routing）
- Modify: `gateway/tests/unit/voice-runtime.test.ts`
- Modify: `gateway/tests/unit/voice-status.test.ts`
- Modify: `gateway/tests/unit/voice-config.test.ts`
- Modify: `gateway/tests/unit/voice-session-asr.test.ts`

**Interfaces:**
- Produces:
  - `routingForConfig(config: Pick<VoiceConfig,'localTier'>): VoiceRouting`
  - `VoiceSessionDeps` 新增 required `routing: VoiceRouting`；`ready.routing` 使用该值。
  - `VoiceConfig.duplexV1: boolean`，默认 `false`，env `MAFW_VOICE_DUPLEX_V1`。
  - `VoiceRuntime.status()` 返回 `{ config, engines, routing }`。

- [ ] **Step 1: Write failing routing/status/config tests**

`voice-routing.test.ts`:

```ts
import { routingForConfig } from '../../src/voice/routing';

test('dgpu reports local_accelerated and igpu reports local_cpu', () => {
  expect(routingForConfig({ localTier: 'dgpu' })).toEqual({ status: 'local_accelerated' });
  expect(routingForConfig({ localTier: 'igpu' })).toEqual({ status: 'local_cpu' });
});
```

`voice-config.test.ts` add:

```ts
test('duplexV1 defaults off and can be enabled by env', () => {
  expect(resolveVoiceConfig({}).duplexV1).toBe(false);
  expect(resolveVoiceConfig({}, { MAFW_VOICE_DUPLEX_V1: 'true' }).duplexV1).toBe(true);
});
```

`voice-runtime.test.ts` / `voice-status.test.ts` assert `routing.status` is `local_accelerated` for dgpu and appears in `GET /api/voice/status` body.

- [ ] **Step 2: Run to verify red**

Run: `npm test --prefix gateway -- tests/unit/voice-routing.test.ts tests/unit/voice-config.test.ts tests/unit/voice-runtime.test.ts tests/unit/voice-status.test.ts`

Expected: FAIL because routing module/field/status do not exist.

- [ ] **Step 3: Implement routing and wire it**

Implement:

```ts
export function routingForConfig(config: Pick<VoiceConfig, 'localTier'>): VoiceRouting {
  return { status: config.localTier === 'dgpu' ? 'local_accelerated' : 'local_cpu' };
}
```

`VoiceRuntime.createSession(send)` computes `routingForConfig(this.deps.config)` and passes `routing` into `VoiceSession`. `status()` returns the same routing. `handleVoiceStatus` uses `deps.runtime?.status().routing ?? routingForConfig(deps.config)` so the status endpoint reports local routing before the lazy runtime exists. Add both runtime-present and runtime-absent cases to `voice-status.test.ts`.

Add `duplexV1` to `VoiceConfig`, default config, resolver, and `voice-status` JSON automatically through `config`.

- [ ] **Step 4: Update VoiceSession fixtures**

All `new VoiceSession(...)` tests must pass an explicit routing, e.g.:

```ts
routing: { status: 'local_cpu' },
```

Do not default routing inside `VoiceSession`; a missing value should remain a type error.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test --prefix gateway -- tests/unit/voice-routing.test.ts tests/unit/voice-config.test.ts tests/unit/voice-runtime.test.ts tests/unit/voice-status.test.ts tests/unit/voice-session-asr.test.ts`

Run: `npx tsc --noEmit -p gateway/tsconfig.json`

Expected: both PASS/rc=0.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/voice/routing.ts gateway/src/voice/session.ts gateway/src/voice/runtime.ts gateway/src/voice/config.ts gateway/src/voice/routes/voice-status.ts gateway/src/index.ts gateway/scripts/voice-bench-server.ts gateway/tests/unit/voice-routing.test.ts gateway/tests/unit/voice-runtime.test.ts gateway/tests/unit/voice-status.test.ts gateway/tests/unit/voice-config.test.ts gateway/tests/unit/voice-session-asr.test.ts
git commit -m "feat(voice): report actual local routing and duplex flag"
```

### Task 3: Adopt a compatible external Qwen3-ASR sidecar

**Files:**
- Modify: `gateway/src/voice/sidecar/qwen3-asr-sidecar.ts`
- Modify: `gateway/tests/unit/voice-qwen3-sidecar.test.ts`

**Interfaces:**
- Produces:
  - `Qwen3AsrSidecar.isExternal(): boolean`
  - `Qwen3AsrSidecar.start(): Promise<void>` 在端口已监听且 `/health` 为 `{ok:true, model:string, chunkSizeSec:number}` 时 adopt；否则 `sidecar_port_in_use`。
  - External sidecar 的 `pid` 为 `undefined`；`stop()`/`stopSync()` 不杀外部进程。

- [ ] **Step 1: Write failing adopt tests**

```ts
test('adopts a compatible external sidecar without spawning or killing it', async () => {
  let spawned = false;
  const sidecar = new Qwen3AsrSidecar({
    port: 3920,
    probePortImpl: async () => true,
    spawnImpl: (() => { spawned = true; return new FakeChild(); }) as any,
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 }),
    })) as any,
  });
  await sidecar.start();
  expect(spawned).toBe(false);
  expect(sidecar.isExternal()).toBe(true);
  expect(sidecar.pid).toBeUndefined();
  await sidecar.stop();
  expect(sidecar.isExternal()).toBe(true);
});

test('rejects an unrelated service occupying the sidecar port', async () => {
  const sidecar = new Qwen3AsrSidecar({
    port: 3921,
    probePortImpl: async () => true,
    fetchImpl: (async () => ({ ok: true, json: async () => ({ ok: true }) })) as any,
  });
  await expect(sidecar.start()).rejects.toThrow(/sidecar_port_in_use|not a compatible/i);
});
```

- [ ] **Step 2: Run to verify red**

Run: `npm test --prefix gateway -- tests/unit/voice-qwen3-sidecar.test.ts`

Expected: FAIL because port-open always throws and `isExternal` is missing.

- [ ] **Step 3: Implement health compatibility and adopt**

Add private `readHealth()` returning parsed JSON or null. Use it for `isReady()` and adopt. Keep startup ping loop using `readHealth().ok`. On adopt, set `this.external = true`, remove any stale stderr state, return before spawn. Update existing fetch mocks to expose `json()`; success mocks must return the full compatible health object.

- [ ] **Step 4: Run focused tests**

Run: `npm test --prefix gateway -- tests/unit/voice-qwen3-sidecar.test.ts`

Expected: PASS, including all previous startup/stop/port-conflict cases.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/voice/sidecar/qwen3-asr-sidecar.ts gateway/tests/unit/voice-qwen3-sidecar.test.ts
git commit -m "feat(voice): adopt compatible external ASR sidecar"
```

### Task 4: Ship voice_sidecars in package, local deploy, and desktop bundle

**Files:**
- Modify: `package.json`
- Modify: `gateway/scripts/deploy-local.mjs`
- Modify: `packages/desktop/scripts/stage-gateway.ts`
- Create: `gateway/tests/unit/voice-packaging.test.ts`

**Interfaces:**
- Consumes: `gateway/voice_sidecars/qwen3_asr_server.py`
- Produces:
  - npm `files` contains `gateway/voice_sidecars/`
  - deploy-local copies the directory to `<gateway>/voice_sidecars`
  - desktop stage copies it to `<outDir>/voice_sidecars`

- [ ] **Step 1: Write the failing source/package guard**

`voice-packaging.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');

test('voice sidecar assets are included in all distribution paths', () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  expect(rootPkg.files).toContain('gateway/voice_sidecars/');

  const deploy = fs.readFileSync(path.join(root, 'gateway/scripts/deploy-local.mjs'), 'utf8');
  expect(deploy).toContain('voice_sidecars');

  const stage = fs.readFileSync(path.join(root, 'packages/desktop/scripts/stage-gateway.ts'), 'utf8');
  expect(stage).toContain('voice_sidecars');
});
```

- [ ] **Step 2: Run to verify red**

Run: `npm test --prefix gateway -- tests/unit/voice-packaging.test.ts`

Expected: FAIL on root files missing.

- [ ] **Step 3: Implement distribution copies**

- Root `files`: add `"gateway/voice_sidecars/"` after `gateway/scripts/office/`.
- deploy-local assets: add `[gatewayRoot/voice_sidecars, target/voice_sidecars]`.
- stage-gateway: after copying dist, `await cp(path.join(gatewayDir, 'voice_sidecars'), path.join(outDir, 'voice_sidecars'), { recursive: true })`.
- Log each copy consistently with existing staging messages.

- [ ] **Step 4: Run guard and packaging tests**

Run: `npm test --prefix gateway -- tests/unit/voice-packaging.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json gateway/scripts/deploy-local.mjs packages/desktop/scripts/stage-gateway.ts gateway/tests/unit/voice-packaging.test.ts
git commit -m "build(voice): ship ASR sidecar with gateway artifacts"
```

### Task 5: Expose voice status and WS URL through SDK/preload

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Create: `packages/desktop/src/preload/mafw-voice.test.ts`

**Interfaces:**
- Produces:
  - SDK `voice.status()` 类型含 `routing` 与 `config.duplexV1: boolean`。
  - SDK `voice.wsUrl(): string`，把 `http://`→`ws://`、`https://`→`wss://`，路径固定 `/ws/voice`。
  - Preload `window.api.mafw.voice.status()` 与 `.wsUrl()`，均经 main 的通用 `invoke("voice", ...)`。

- [ ] **Step 1: Write failing SDK tests**

Add to `packages/gateway-sdk/src/client.test.ts`:

```ts
test('voice.wsUrl converts HTTP schemes to the voice WebSocket endpoint', () => {
  expect(new MafwClient('http://gw:3000').voice.wsUrl()).toBe('ws://gw:3000/ws/voice')
  expect(new MafwClient('https://gw.example').voice.wsUrl()).toBe('wss://gw.example/ws/voice')
})
```

Add `mafw-voice.test.ts` reading preload source:

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'

test('preload exposes voice status and wsUrl without renderer URL assembly', () => {
  const src = readFileSync(new URL('./mafw-api.ts', import.meta.url), 'utf8')
  expect(src).toMatch(/voice:\s*\{/)
  expect(src).toContain('status: () => invoke("voice", "status")')
  expect(src).toContain('wsUrl: () => invoke("voice", "wsUrl")')
})
```

- [ ] **Step 2: Run to verify red**

Run: `npm test -w @mafw/sdk`

Run desktop targeted test command for `src/preload/mafw-voice.test.ts`.

Expected: FAIL because `voice.wsUrl` and preload voice namespace do not exist.

- [ ] **Step 3: Implement SDK and preload**

SDK implementation:

```ts
wsUrl: (): string => `${this.baseUrl.replace(/\/$/, '').replace(/^http/, 'ws')}/ws/voice`,
status: async (): Promise<VoiceStatusResponse> => this.request('/api/voice/status'),
```

Define `VoiceStatusResponse` in `types.ts`. Add the desktop MafwAPI `voice` block and preload implementation; do not add a new IPC handler because `mafw-invoke` already dispatches `voice` namespace.

- [ ] **Step 4: Run focused tests/typecheck**

Run: `npm test -w @mafw/sdk`

Run from `packages/desktop`: `node --import tsx --import ../../packages/test-shim/register.mjs --test "src/preload/mafw-voice.test.ts"`

Run: `npx tsgo --noEmit -p packages/desktop/tsconfig.json`

Expected: PASS/rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-voice.test.ts
git commit -m "feat(sdk): expose voice status and websocket URL"
```

### Task 6: Add continuous PCM framing and a shared microphone tap

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/voice/types.ts`
- Modify: `packages/desktop/src/renderer/mafw/voice/silero.ts`
- Create: `packages/desktop/src/renderer/mafw/voice/pcm-capture.ts`
- Create: `packages/desktop/src/renderer/mafw/voice/pcm-capture.test.ts`
- Create: `packages/desktop/public/voice/pcm-capture-worklet.js`

**Interfaces:**
- Produces:
  - `MicInput { stream: MediaStream; context: AudioContext; sampleRate: 16000 }`
  - `VadAnalyzer.getInput?(): MicInput | null`
  - `floatToPcm16(frames: Float32Array): Int16Array`
  - `createPcmFrameBuffer(): { push(frames: Float32Array): Int16Array[]; reset(): void }`，每帧 320 samples / 20ms。
  - `VoicePcmTap { dispose(): Promise<void> }`
  - `createVoicePcmTap(input: MicInput, onFrame: (pcm: Int16Array) => void): Promise<VoicePcmTap>`
  - Silero `start()` 后 `getInput()` 返回同一个 stream/context；`stop()` 后返回 null。

- [ ] **Step 1: Write failing framing tests**

```ts
test('floatToPcm16 clamps and scales to signed 16-bit', () => {
  const out = floatToPcm16(new Float32Array([-2, -0.5, 0, 1, 2]));
  expect(Array.from(out)).toEqual([-32768, -16384, 0, 32767, 32767]);
});

test('frame buffer emits 20ms frames and preserves remainder', () => {
  const b = createPcmFrameBuffer();
  expect(b.push(new Float32Array(100))).toHaveLength(0);
  const frames = b.push(new Float32Array(300));
  expect(frames).toHaveLength(1);
  expect(frames[0]).toHaveLength(320);
  expect(b.push(new Float32Array(640))).toHaveLength(2);
  b.reset();
  expect(b.push(new Float32Array(319))).toHaveLength(0);
});

test('frame buffer never splits a frame across push calls', () => {
  const b = createPcmFrameBuffer();
  const first = b.push(new Float32Array(319));
  const second = b.push(new Float32Array(1));
  expect(first).toHaveLength(0);
  expect(second).toHaveLength(1);
  expect(second[0]).toHaveLength(320);
});
```

- [ ] **Step 2: Run to verify red**

Run from `packages/desktop`: `node --import tsx --import ../../packages/test-shim/register.mjs --test "src/renderer/mafw/voice/pcm-capture.test.ts"`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement framing and tap**

Pure conversion/framing in `pcm-capture.ts`; browser tap loads `/voice/pcm-capture-worklet.js`, creates `MediaStreamAudioSourceNode` and `AudioWorkletNode('pcm-capture')`, converts incoming Float32 to Int16 via the frame buffer, and disconnects both nodes on dispose. Do not own/stop the MediaStream in the tap.

Capture worklet posts mono input copies:

```js
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) this.port.postMessage(new Float32Array(channel))
    return true
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor)
```

- [ ] **Step 4: Expose Silero input**

Store and return the existing `stream`/`ctx` through `getInput()`. Make the interface member optional so existing fake VAD tests remain valid; `DuplexVoiceClient` will fail explicitly when it is absent.

- [ ] **Step 5: Run framing tests and typecheck**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test "src/renderer/mafw/voice/pcm-capture.test.ts"`

Run: `npx tsgo --noEmit -p packages/desktop/tsconfig.json`

Expected: PASS/rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/voice/types.ts packages/desktop/src/renderer/mafw/voice/silero.ts packages/desktop/src/renderer/mafw/voice/pcm-capture.ts packages/desktop/src/renderer/mafw/voice/pcm-capture.test.ts packages/desktop/public/voice/pcm-capture-worklet.js
git commit -m "feat(voice): add continuous PCM capture framing"
```

### Task 7: Implement the Desktop duplex ASR client

**Files:**
- Create: `packages/desktop/src/renderer/mafw/voice/duplex-client.ts`
- Create: `packages/desktop/src/renderer/mafw/voice/duplex-client.test.ts`

**Interfaces:**
- Consumes: `VadAnalyzer.getInput()`, `createVoicePcmTap` (already emits 20ms Int16 frames).
- Produces:

```ts
type DuplexClientState = 'idle' | 'connecting' | 'listening' | 'error' | 'closed'

interface DuplexSocket {
  readyState: number
  send(data: string | ArrayBufferView): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
}

interface DuplexClientDeps {
  chatSessionId: string
  wsUrl: () => Promise<string>
  vad: VadAnalyzer
  createTap: (input: MicInput, onFrame: (pcm: Int16Array) => void) => Promise<VoicePcmTap>
  wsFactory?: (url: string) => DuplexSocket
  idFactory?: () => string
  readyTimeoutMs?: number
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onState: (state: DuplexClientState) => void
  onError: (error: Error) => void
}

function createDuplexClient(deps: DuplexClientDeps): {
  start(): Promise<void>
  stop(): Promise<void>
  state(): DuplexClientState
  voiceSessionId(): string | null
}
```

- [ ] **Step 1: Write failing client tests**

Use a fake socket with `onopen/onmessage` and a fake VAD/tap. Required tests:

```ts
test('sends hello with both ids and starts the mic only after ready', async () => {
  // start() -> assert sent hello contains voiceSessionId/chatSessionId/clientVad:true;
  // assert vad.start not called until server sends {"type":"ready"};
  // after ready -> state listening, vad.start called once.
});

test('streams 20ms PCM frames before speech_stopped', async () => {
  // tapCallbacks[0](new Int16Array(320));
  // assert socket sent one 640-byte binary;
  // emit speech_stopped -> one JSON end_audio;
  // emit asr.partial/asr.final -> callbacks received.
});

test('stop is idempotent and releases socket, tap, and VAD', async () => {
  // start then stop twice; close/send('stop') and dispose/vad.stop each once.
});

test('ready timeout closes socket and reports a recoverable error', async () => {
  // readyTimeoutMs: 10, no ready; expect error "voice_ready_timeout";
  // state error; socket closed; vad start not called.
});

test('server error frame stops the client with that code', async () => {
  // {"type":"error","code":"voice_unavailable","message":"..."} -> error callback.
});
```

- [ ] **Step 2: Run to verify red**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test "src/renderer/mafw/voice/duplex-client.test.ts"`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement minimal client**

Order:

1. state connecting and resolve `wsUrl`.
2. create/factory socket, await `open`.
3. send `hello` with `mode:'continuous'`, `tier:'auto'`, `format:'pcm16'`, `clientVad:true`, language optional not set yet.
4. await `ready` or timeout; reject/error on server error/close.
5. call `vad.start()`; require `vad.getInput() !== null`, else error `voice_mic_unavailable`.
6. set listening; create tap; each frame sends `ArrayBuffer` if `readyState === 1` (WebSocket OPEN; use the numeric constant so Node tests need no browser global).
7. VAD `speech_stopped` sends `{type:'end_audio'}`; `speech_started` is ignored in Plan 1.
8. partial/final callbacks; final does not stop listening.
9. `stop()` sends `stop` when open, closes socket, disposes tap, calls `vad.stop()`, state closed; all parts idempotent.
10. socket close/error while active surfaces one error unless stop was requested.

Do not add reconnect, TTS playback, close-code retries, or end-of-turn semantics; those belong to later plans.

- [ ] **Step 4: Run focused tests**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test "src/renderer/mafw/voice/duplex-client.test.ts"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/voice/duplex-client.ts packages/desktop/src/renderer/mafw/voice/duplex-client.test.ts
git commit -m "feat(voice): add desktop continuous ASR websocket client"
```

### Task 8: Wire the duplex ASR UI behind voice.duplexV1

**Files:**
- Create: `packages/desktop/src/renderer/mafw/chat/use-duplex-voice.ts`
- Create: `packages/desktop/src/renderer/mafw/chat/duplex-voice-mode.ts`
- Create: `packages/desktop/src/renderer/mafw/chat/duplex-voice-mode.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/DuplexVoiceBar.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（若语音样式在拆分文件，则改对应文件）
- Create: `packages/desktop/src/renderer/mafw/components/duplex-voice-wiring.test.ts`
- Modify: `AGENTS.md` §5.21

**Interfaces:**
- Produces:
  - `voiceMicAction({ duplexEnabled, duplexActive, legacyRecording }): 'start_duplex'|'stop_duplex'|'start_legacy'|'stop_legacy'`
  - `useDuplexVoice(sid: () => string, ready: () => boolean)` 返回 `{ enabled, active, partial, finalText, error, toggle, stop }`。
  - `DuplexVoiceBar` props `{ partial, finalText, error, onStop }`。
- Consumes: Task 5 preload voice API, Task 6 Silero input/tap, Task 7 client.

- [ ] **Step 1: Write failing mode and wiring tests**

`duplex-voice-mode.test.ts`:

```ts
test('duplex flag controls the microphone action without breaking legacy fallback', () => {
  expect(voiceMicAction({ duplexEnabled: true, duplexActive: false, legacyRecording: false })).toBe('start_duplex')
  expect(voiceMicAction({ duplexEnabled: true, duplexActive: true, legacyRecording: false })).toBe('stop_duplex')
  expect(voiceMicAction({ duplexEnabled: false, duplexActive: false, legacyRecording: false })).toBe('start_legacy')
  expect(voiceMicAction({ duplexEnabled: false, duplexActive: false, legacyRecording: true })).toBe('stop_legacy')
})
```

`duplex-voice-wiring.test.ts` (source contract, same style as existing design contract tests):

```ts
test('ChatPane gates duplex through the hook and renders the partial bar', () => {
  const src = readFileSync(new URL('./ChatPane.tsx', import.meta.url), 'utf8')
  expect(src).toContain('useDuplexVoice(() => sidProp(), () => props.gwReady)')
  expect(src).toContain('voiceMicAction')
  expect(src).toContain('<DuplexVoiceBar')

  const hook = readFileSync(new URL('../chat/use-duplex-voice.ts', import.meta.url), 'utf8')
  expect(hook).toMatch(/config\?\.duplexV1\s*===\s*true/)
})
```

- [ ] **Step 2: Run to verify red**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test "src/renderer/mafw/chat/duplex-voice-mode.test.ts" "src/renderer/mafw/components/duplex-voice-wiring.test.ts"`

Expected: FAIL because files/wiring do not exist.

- [ ] **Step 3: Implement mode decision and hook**

- `duplex-voice-mode.ts` is pure.
- `use-duplex-voice.ts` uses a `createEffect` that calls `window.api.mafw.voice.status()` when `ready()` first becomes true; `enabled = config?.duplexV1 === true`. Do not fetch once on mount while gateway is still disconnected.
- `toggle()` only starts when `ready() && sid()` is non-empty; if no sid, surface `voice_chat_session_required`. If not ready, keep the legacy/disabled behavior.
- Construct `createSileroVadAnalyzer({...DEFAULT_VAD_PARAMS})` once per started client, `createVoicePcmTap`, and `createDuplexClient` with preload `wsUrl`.
- Use a start generation guard so late status/client callbacks cannot change a stopped or switched session.
- `onCleanup` stops the client.
- On `asr.final`, store final text; on new `asr.partial`, replace partial text.
- Errors use `showToastV2` in ChatPane or expose `error`; do not crash the pane.

After the existing `useVoiceBinding` call in ChatPane, add exactly one hook instance:

```tsx
const duplexVoice = useDuplexVoice(() => sidProp(), () => props.gwReady)
```

Both microphone entry points (composer toolbar and narrow “更多” menu) must call one shared `handleMicClick()`; do not duplicate branch logic.

- [ ] **Step 4: Implement the bar and integrate ChatPane**

`DuplexVoiceBar`:

- Uses `ButtonV2` only; no raw `<button>`.
- Shows “正在听…” while active and no text.
- Shows current partial; final text stays until the next utterance.
- Shows error text with a stop button.
- `role="status"`, `aria-live="polite"`, CSS class `mafw-duplex-voice-bar`.

Insert immediately after `<div class="mafw-composer" ...>` opening and before attachment chips, behind:

```tsx
<Show when={duplexVoice.enabled() && (duplexVoice.active() || duplexVoice.partial() || duplexVoice.finalText() || duplexVoice.error())}>
  <DuplexVoiceBar ... />
</Show>
```

Update the microphone button handler through one shared function used by both entry points:

```tsx
function handleMicClick() {
  const action = voiceMicAction({
    duplexEnabled: duplexVoice.enabled(),
    duplexActive: duplexVoice.active(),
    legacyRecording: voiceRecording(),
  })
  if (action === 'stop_duplex') { void duplexVoice.stop(); return }
  if (action === 'start_duplex') { stopActivePlayback(); void duplexVoice.toggle(); return }
  if (action === 'stop_legacy') { voiceSession.stopRecording(); return }
  stopActivePlayback()
  void voiceSession.startRecording()
}
```

Do not auto-send `asr.final` to the agent in Plan 1. The bar is an ASR milestone, not the LLM loop.

- [ ] **Step 5: Update docs**

In `AGENTS.md` §5.21 append one bullet:

- **Duplex ASR Plan 1（2026-11-03）**：`voice.duplexV1` 默认关；桌面 PTT 经 `/ws/voice` 持续发 16k PCM16、显示 partial/final；sidecar 支持 adopt；LLM/TTS 闭环不在本切片。

Use an ASCII-only anchor and the repository’s established safe insertion method because AGENTS.md contains historical replacement characters.

- [ ] **Step 6: Run focused tests, desktop full tests, typecheck, build**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test "src/renderer/mafw/chat/duplex-voice-mode.test.ts" "src/renderer/mafw/components/duplex-voice-wiring.test.ts"`

Run from `packages/desktop`: `npm test`

Run: `npx tsgo --noEmit -p tsconfig.json`

Run: `npx electron-vite build`

Expected: targeted tests PASS; desktop full suite green with new count; typecheck/build rc=0.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/chat/use-duplex-voice.ts packages/desktop/src/renderer/mafw/chat/duplex-voice-mode.ts packages/desktop/src/renderer/mafw/chat/duplex-voice-mode.test.ts packages/desktop/src/renderer/mafw/components/DuplexVoiceBar.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/components/duplex-voice-wiring.test.ts packages/desktop/src/renderer/mafw/mafw.css AGENTS.md
git commit -m "feat(desktop): stream duplex ASR subtitles behind flag"
```

---

## Final Verification

After all tasks:

- [ ] **Gateway full suite**: `npm test --prefix gateway -- --runInBand --forceExit` → 0 failures; record total tests/suites.
- [ ] **Gateway typecheck**: `npx tsc --noEmit -p gateway/tsconfig.json` → rc=0.
- [ ] **SDK tests**: `npm test -w @mafw/sdk` → 0 failures.
- [ ] **Desktop full suite**: `cd packages/desktop && npm test` → 0 failures.
- [ ] **Desktop typecheck/build**: `npx tsgo --noEmit -p tsconfig.json` and `npx electron-vite build` → rc=0.
- [ ] **No accidental product changes**: `git diff --stat` only contains Plan 1 files plus AGENTS.md.
- [ ] **Sidecar asset checks**: root package list, deploy-local, and staged bundle all contain `voice_sidecars/qwen3_asr_server.py`.

### Real ASR smoke (manual, required before calling Slice A delivered)

Preconditions:

1. WSL2 sidecar is running on port 3911 using the command documented in `docs/research/2026-10-28-voice-bench-p1.md`.
2. Windows can reach it at `http://127.0.0.1:3911/health`.
3. Gateway config has `voice.duplexV1: true`; old voice behavior remains default when false.
4. Gateway and desktop are restarted so config/preload changes take effect.
5. An existing chat session is open.

Expected observations:

- Clicking microphone enters “正在听” without creating a hidden chat/session.
- Speaking shows non-empty partial text before the user stops speaking.
- Stopping speech produces a final text and then automatically returns to listening without re-opening microphone permission/device.
- `GET /api/voice/status` reports actual `local_accelerated`/`local_cpu`, the external ASR engine, and `duplexV1:true`.
- Stopping duplex releases mic/audio/socket; a second start works.
- With `voice.duplexV1:false`, clicking microphone follows the legacy recording → WAV → Media Agent path unchanged.
- With an unrelated process holding port 3911, gateway reports `sidecar_port_in_use` and does not adopt or kill that process.
- P1 partial p50 remains ≤300ms; record observed numbers and sample count in the delivery report.

Do not start Plan 2 (LLM/TTS loop) until this smoke passes and Slice A is reviewed.
