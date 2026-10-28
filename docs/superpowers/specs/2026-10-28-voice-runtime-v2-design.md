# Voice Runtime v2：端到端连续语音重构设计

> 日期：2026-10-28 · 状态：待评审
> 范围：MAFW gateway + desktop；协议层为 mobile/TUI/agent 预留。
> 依据：`docs/research/2026-10-28-voice-model-selection.md`、`docs/research/2026-10-28-voicestudio-voice-architecture.md`、现有 `gateway/src/tts/` 与 `packages/desktop/src/renderer/mafw/voice/` 源码。

## 1. 为什么要重做

现在的语音链路是「桌面 VoiceSession 录音 → 上传整段 WAV → Media Agent 多模态模型转写 → 文本回复 → MiMo TTS 整段/句级播放」。它能用，但不是连续对话：

- 没有真正的流式 ASR：音频要上传完、模型分析完才有文本；没有 partial。
- 麦克风在 TTS 播放期间只是「监听打断」，不是连续会话；一轮结束后要再按。
- TTS 默认依赖云端 MiMo；本地 Kokoro 只有英文音色，且 `voiceCloning: true` 没有实现。
- 语音状态机在 desktop，gateway 只提供 TTS 接口；mobile/TUI/agent 无法复用同一套会话。
- 没有模型目录、许可门、设备路由、显存生命周期；重模型会叠。

目标不是修一条链路，而是把语音做成 MAFW 的**一等运行时**。

## 2. 目标 / 非目标

### 目标

1. **连续对话**：按一次麦克风进入；用户说话 → 回应 → 自动回到听；直到手动结束。
2. **可打断**：TTS 播放期间麦克风持续监听；用户开口立即停播，新语音成为下一轮。
3. **流式**：ASR partial、LLM 流式、TTS 按句流式；首包优先。
4. **本地/云端可选**：本地优先，云端可作质量档或兜底；本地档必须在核显/CPU 上可用。
5. **统一运行时**：gateway 持有 `VoiceRuntime`；desktop/mobile/TUI/agent 都是客户端。
6. **能力真实**：引擎声明什么就真的支持什么；不允许 `voiceCloning: true` 但没接线。
7. **可运维**：模型目录、许可、设备路由、健康检查、指标、超时、取消、单引擎常驻。

### 非目标（v1 不做）

- 电话/PSTN、会议转写、视频配音、音乐生成。
- 端到端 S2S 模型（speech-to-speech 单模型）。
- 声音克隆的完整产品化（参考音管理、克隆音色库）——v1 只保留接口，不默认启用。
- 移动端/TUI 的完整语音 UI——v1 先交付协议和 desktop；其他客户端后续接入。
- 语义 turn detector 的自训练——v1 用 Smart Turn v3.2 现成模型。

### 反目标（即使技术能跑也算失败）

- 用户说完后 2–3 秒才听到第一声。
- TTS 播到一半被自己的声音触发 barge-in。
- 本地档在核显上卡成幻灯片，或必须让用户装 Python/编译器。
- 切引擎后显存不释放，第二次对话 OOM。
- 云端不可用时整个语音功能死掉，没有本地回退。
- 「本地」只是把云 API 换成 localhost 的大模型，核显根本跑不动。

## 3. 约束

- Windows 10/11 x64；Electron + Node/TS gateway（CJS）；Node ≥ 22（以仓库现状为准）。
- 本地档必须覆盖核显/CPU；RTX 4090 Laptop 16G 为高质量档。
- 中文为主，允许中英混说、英文术语/产品名/代码标识符。
- 内置模型只用 Apache-2.0 / MIT / BSD-2-Clause；受限模型只经用户插件接入。
- 需要兼容现有 `mafw_media_speak`、`[语音回复 art:...]`、`/api/tts`、`/api/tts/stream`。
- 不引入必须常驻的 Python 进程；Python 只用于独显高质量档的可选 sidecar。
- 所有阶段 TDD；每个任务独立 commit；报告新增用例数与全量用例数（用户既有偏好）。

## 4. 目标体验

```
[按麦克风] → listening
  用户说话
  → asr.partial（屏幕上实时出现文字）
  → 静音 + Smart Turn 判定说完
  → asr.final
  → thinking（LLM 开始流式）
  → tts.start（第一句开始合成）
  → speaking（PCM 流式播放）
  → 用户插话 → 立刻 flush + cancel → interrupted → listening
  → tts.done / turn.done → listening（自动下一轮）
[再按麦克风] → 结束
```

关键指标（v1 目标，待实测校准）：

- 首 partial：≤ 300 ms（本地流式 Zipformer，热模型）。
- 说完到 `asr.final`：≤ 500 ms（本地，含 Smart Turn 判定）。
- **端到端首声**（`end_audio` → 第一块 TTS）：核显档 ≤ 1.5 s；独显/云端 ≤ 800 ms。
- **流水线首声**（首个 LLM token → 第一块 TTS）：核显档 ≤ 300 ms；独显/云端 ≤ 200 ms。
- barge-in 停播：≤ 100 ms（本地 flush，不等云端）。
- 误打断率：≤ 5%（安静室内；外放场景 P2 单独测，不达标则 P2 内上服务端 AEC）。

## 5. 总体架构

```
Desktop / Mobile / TUI / Agent
   │  WS /ws/voice（双向二进制音频 + JSON 事件）
   │  HTTP /v1/audio/*（外部 agent 兼容层，可选）
   ▼
Gateway: VoiceRuntime
   ├─ VoiceSession（每连接/每会话状态机）
   ├─ TurnController（VAD + Smart Turn + barge-in）
   ├─ AsrRouter ── AsrEngine（sherpa stream / qwen3-asr / cloud）
   ├─ TtsRouter ── TtsEngine（sherpa kokoro/melo / cosyvoice / mimo）
   ├─ AecProcessor（可选，服务端回声消除）
   ├─ ModelManager（目录/下载/许可/加载/卸载）
   └─ Metrics / Logging
```

**核心变化**：desktop 不再拥有语音状态机；`VoiceSession` 变成 gateway 的 `VoiceRuntime`，desktop 只做采集、播放、UI 绑定。这样 mobile/TUI/agent 才能复用同一套连续对话。

## 6. Gateway 模块

```
gateway/src/voice/
  types.ts              VoiceCapabilities / AsrEngine / TtsEngine / events
  runtime.ts            VoiceRuntime：会话创建、状态机、事件总线
  session.ts            VoiceSession：一轮对话的 ASR→LLM→TTS 编排
  turn.ts               VAD + Smart Turn + barge-in 策略
  router.ts             本地/云端/档位选择 + 健康检查 + 回退
  catalog.ts            模型目录（typed entries）
  model-manager.ts      下载/校验/许可/加载/卸载/单引擎常驻
  metrics.ts            TTFA/RTF/partial/final/barge-in 指标
  aec.ts                服务端 NLMS AEC（v2 可选）
  engines/
    asr/sherpa-streaming.ts
    asr/sherpa-offline.ts
    asr/cloud-qwen.ts
    tts/sherpa-kokoro.ts
    tts/sherpa-melo.ts
    tts/cloud-mimo.ts
    tts/cloud-minimax.ts
  transport/
    ws-voice.ts         /ws/voice 协议编解码
```

现有 `gateway/src/tts/` 保留为兼容层：`/api/tts`、`/api/tts/stream`、`/api/tts/voices`、`/api/tts/interrupt` 继续工作；新运行时通过 `TtsEngine` 适配器复用现有引擎。

## 7. `/ws/voice` 协议

### 客户端 → 服务端

- JSON `hello`：`{sessionId, mode:"continuous", tier:"auto|local|cloud", language:"zh", voice?, format:"pcm16|webm-opus", clientVad:true|false}`
- 二进制帧：麦克风 PCM16 16 kHz mono（v1 只接受 PCM16；`webm-opus` 为预留值，v1 不实现服务端 Opus 解码）
- JSON `vad.speech_started` / `vad.speech_stopped`：客户端 Silero VAD 的原始信号；服务端只据此做 barge-in 和回合边界，不把 sherpa endpoint 当权威
- JSON `end_audio`：客户端 Smart Turn 判定 `complete` 后发送，表示当前 utterance 真正说完
- JSON `cancel`：打断当前语音回合的 TTS/LLM；不 abort 整个 chat session
- JSON `stop`：结束整个连续会话
- JSON `config`：运行中切换 `tier`/`voice`/`language`（下一轮生效）

非浏览器客户端可以设 `clientVad:false`，由服务端跑 VAD + Smart Turn；此时 `vad.*` 由服务端内部产生，不要求客户端发送。

### 服务端 → 客户端

- JSON `ready`：`{routing:{status,reason}, asr:{engine,streaming}, tts:{engine,sampleRate}, aec:{enabled}}`
- JSON `asr.partial`：`{text}`
- JSON `asr.final`：`{text, language?, durationMs}`
- JSON `turn.started`：`{turnId}`
- JSON `tts.start`：`{turnId, sampleRate, engine, voice}`
- 二进制帧：TTS PCM16（采样率见 `tts.start`）
- JSON `tts.done`：`{turnId, ttfaMs, totalMs}`
- JSON `turn.done`：`{turnId}`
- JSON `turn.cancelled`：`{turnId, reason}`
- JSON `routing`：`{status:"local_accelerated|local_cpu|cloud|degraded", reason?}`
- JSON `error`：`{code, message, recoverable}`

二进制方向约定：客户端发的二进制 = 麦克风；服务端发的二进制 = TTS。JSON 只走控制/事件，避免 base64 膨胀。

### 兼容层

- 保留 `/api/tts/stream` SSE 给旧 desktop；新 desktop 用 `/ws/voice`。
- 保留 `/v1/audio/speech`、`/v1/audio/transcriptions`、`/v1/audio/translations` 给外部 agent；内部不依赖厂商 wire format。
- `mafw_media_speak` 继续生成 `[语音回复 art:...]` artifact；VoiceRuntime 的 TTS 完成时也可以落 artifact，供历史回放。

## 8. ASR 设计

### 8.1 接口

```ts
interface AsrCapabilities {
  streaming: 'native' | 'none';
  languages: string[];
  punctuation: boolean;
  timestamps: 'word' | 'segment' | 'none';
  sampleRate: number;
  maxAudioSeconds?: number;
}

interface AsrResult {
  text: string;
  language?: string;
  words?: Array<{ text: string; startMs: number; endMs: number }>;
  confidence?: number;
  durationMs: number;
  engine: string;
  final: boolean;
}

interface AsrStream {
  push(pcm: Buffer): void;
  end(): Promise<AsrResult>;
  abort(): void;
  onPartial(cb: (text: string) => void): void;
}

interface AsrEngine {
  name: string;
  capabilities: AsrCapabilities;
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  createStream(opts: AsrOptions): AsrStream;
  transcribe(audio: Buffer, opts: AsrOptions): Promise<AsrResult>;
}
```

### 8.2 分档

| 档位 | 主 ASR | 终稿 |
|---|---|---|
| 核显/CPU | sherpa-onnx streaming Zipformer bilingual zh-en | Qwen3-ASR-0.6B int8（离线二次解码） |
| 独显 | Qwen3-ASR-1.7B via vLLM | 同模型 / Fun-ASR-Nano 备选 |
| 云端 | Qwen3-ASR-Flash Realtime | 云端 batch 兜底 |

### 8.3 两遍解码

- **第一遍**：Zipformer 持续 `push(pcm)`，`onPartial` 更新 UI；sherpa endpoint 只作为「这里可能停了一下」的提示，**不**直接产生送 LLM 的 final。
- **回合边界**：客户端 VAD `speech_stopped` 后跑 Smart Turn；`complete` 才发 `end_audio`。服务端把同一回合内多个 sherpa utterance 的 PCM/文本拼接起来，作为一个完整 utterance。
- **第二遍**：`TurnController` 收到 `end_audio` 后，把整段 PCM 交给 Qwen3-ASR-0.6B `transcribe()` 重解码；用终稿替换 partial 文本，再送 LLM。
- 若终稿失败/超时（例如 800 ms 预算），回退 partial final，不阻塞对话。
- 终稿解码在独立 worker/队列，不能阻塞下一轮 ASR。

### 8.4 云端

- `cloud-qwen` 适配器：DashScope Realtime WS；partial/final；断线重连；本地 Silero 仍负责 barge-in。
- 云端 ASR 只接收已确认的 utterance 音频，不把常开麦克风音频整段上传；减少隐私和成本。
- 云端不可用时，router 回退本地；回退事件通过 `routing` 帧告知 UI。

## 9. TTS 设计

### 9.1 接口

```ts
interface TtsCapabilities {
  streaming: 'native' | 'sentence';
  languages: string[];
  sampleRate: number;
  voiceCloning: boolean;
  styleControl: boolean;
  emotion: boolean;
  maxRefSeconds?: number;
}

interface TtsEngine {
  name: string;
  capabilities: TtsCapabilities;
  isAvailable(): Promise<{ ok: boolean; reason?: string }>;
  voices(): TtsVoice[];
  synthesizeStream(text: string, opts: TtsOptions, signal: AbortSignal): AsyncIterable<PcmChunk>;
  synthesize(text: string, opts: TtsOptions): Promise<Buffer>;
}
```

### 9.2 分档

| 档位 | 主 TTS | 备选 |
|---|---|---|
| 核显/CPU | Kokoro multi-lang v1.1 zh_en（质量） | MeloTTS zh_en（弱核显/低延迟） |
| 独显 | CosyVoice3-0.5B（150 ms 双流式） | Qwen3-TTS-0.6B（97 ms，克隆） |
| 云端 | MiniMax Speech-02 Turbo | MiMo TTS（现有）/ Azure |

### 9.3 逐句流式

- `VoiceSession` 从 LLM 拿流式文本；`SentenceChunker` 增量切句。
- **首句短**：目标 ≤ 20 个中文字符/40 个英文字符；通过 voice prompt 约束 + chunker 优先在逗号/句号处切实现，**不硬切词/标识符**。后续句可正常长度。首句优先合成、优先发。
- 每句 `ttsEngine.synthesizeStream()`；native 引擎直接 yield PCM；sentence 引擎按句 `synthesize()` 后 yield。
- 服务端做 mastering / normalize / 水印（可选）；每块带 `sampleRate`。
- 客户端 AudioWorklet 环形缓冲；`flush()` 用于 barge-in。
- LLM 还没结束时，已完成的句子先发；不要等整段回复。

### 9.4 声音/风格

- `TtsOptions`：`voice`、`style`、`speed`、`language`、`refAudio`、`refText`、`emotion`。
- v1 只启用预置音色；`refAudio` 接口保留，不默认开放克隆。
- 引擎必须在 `capabilities` 里声明 `voiceCloning/styleControl/emotion`；不支持就拒绝，不静默忽略。

## 10. Turn / barge-in / AEC

### 10.1 TurnController

- **所有权**：v1 由客户端持有 VAD + Smart Turn（低延迟、已具备 `@ricky0123/vad-web` 资产）；服务端信任客户端发来的 `vad.*` / `end_audio`，只做 ASR 和回合编排。非浏览器客户端 `clientVad:false` 时，服务端跑同一套 Silero + Smart Turn。
- VAD：Silero VAD；`speech_stopped` 后跑 Smart Turn v3.2（`@micdrop/smart-turn`，Node/浏览器均可）；`complete` 才发 `end_audio`，否则继续等。
- sherpa 的 endpoint 只用于 ASR 内部断句/partial 刷新，**不决定** LLM 回合是否结束；否则和 Smart Turn 会打架，出现「sherpa 以为说完了、Smart Turn 说没说完」的双重 final。
- 客户端 VAD 低延迟触发 barge-in；服务端在收到 `cancel` 后 abort 当前语音回合的 TTS/LLM。
- 非浏览器客户端：服务端 VAD + Smart Turn 作为主路径，协议事件由服务端生成。

### 10.2 Barge-in

```
speaking + vad.speech_started
  → client: player.flush()
  → client: send {type:"cancel"}
  → server: abort TTS stream, abort LLM if possible, send turn.cancelled
  → server: reset ASR stream, state=listening
```

要求：

- 客户端 flush 必须在 100 ms 内生效，不等服务端确认。
- 服务端 abort 要能取消：native 引擎的 generation、sentence 队列、HTTP 请求、sidecar 请求。
- **取消粒度是「语音回合」而不是「chat session」**：`cancel` 只 abort 本 VoiceSession 的 TTS/LLM 请求；不调用 session-scoped `runtime.session.abort`，避免误杀同一会话里的打字回合或正在写文件的工具。
- **`thinking` / 工具执行中用户插话**：不 abort 已经产生副作用的工具；只停 TTS、把当前回合标记为 `interrupted`，新语音进入下一轮。工具结果如果在新回合开始后才回来，丢弃它的语音播报，只留在历史里。
- 误打断保护：VAD 连续语音 ≥ 200–300 ms 才触发；咳嗽/点击不打断。
- TTS 自己的声音不能触发 VAD：客户端 `echoCancellation: true` 为第一道；外放验收不过则 P2 必须上服务端 AEC，而不是把问题留到 v2。

### 10.3 AEC

- v1：客户端 `getUserMedia({echoCancellation:true, noiseSuppression:true, autoGainControl:true})`；耳机场景足够。
- **外放是 P2 硬验收**：P2 必须在真实扬声器上测误打断率；如果客户端 AEC 不达标，P2 内补服务端 `AecProcessor`（NLMS 起步，必要时 WebRTC AEC3），不能把问题留到 v2。
- 服务端 AEC：far-end = 服务端刚发出的 TTS PCM，near-end = 麦克风 PCM；每个会话一个实例；需要处理播放延迟估计/时钟漂移，先用固定 + 自适应延迟窗，实测校准。
- v2 可升级到 WebRTC AEC3 或更强的远场方案，但接口不变。

## 11. Router / 本地云端

```ts
type VoiceTier = 'auto' | 'local' | 'cloud';
type RoutingStatus = 'local_accelerated' | 'local_cpu' | 'cloud' | 'degraded';

interface VoiceRouter {
  select(opts: { tier: VoiceTier; sessionId: string }): Promise<{
    asr: AsrEngine;
    tts: TtsEngine;
    status: RoutingStatus;
    reason?: string;
  }>;
}
```

规则：

1. `cloud`：直接用云端 ASR/TTS；本地 Silero 仍负责 barge-in。**云端必须是用户显式选择/显式同意**；`auto` 不得在用户不知情时把麦克风音频发到云端。
2. `local`：本地引擎；如果 GPU 引擎不可用但 CPU 可用，状态 `local_cpu`，并在 `ready`/`routing` 帧明确告知。
3. `auto`：本地默认引擎可用且满足延迟预算 → local；本地模型未安装/硬件不够且用户已同意云端 → cloud；都不可用 → `degraded`（只保留 ASR 文本、不播报，或只保留 TTS）。
4. 任何回退都发 `routing` 事件；不允许静默降级。
5. 云端连续失败 N 次 → 本会话熔断，回退本地；本地失败 → 标记不可用，下一次请求重新探测。
6. **首次运行**：本地模型未安装时，`auto` 不阻塞下载、也不偷偷上云；UI 提示「下载本地模型」或「使用云端（需同意）」。下载在对话前完成，进度可见；模型源优先 HF，失败走 `hf-mirror.com` 镜像。
7. **延迟预算**：`auto` 的本地可用性先由静态硬件档位决定；启动后跑一次短音频微基准（≤2 s）校准；之后用本会话最近 3 轮的实际 TTFA 判断是否降级。没有测量数据时，宁可显式提示，不假装本地可用。

## 12. 模型目录 / 生命周期 / 许可

### 12.1 目录

`gateway/src/voice/catalog.ts`（typed）或 `gateway/config/voice-models.json`；每条：

```ts
interface VoiceModelEntry {
  id: string;
  kind: 'asr' | 'tts';
  tier: 'igpu' | 'dgpu' | 'cloud';
  engine: string;
  languages: string[];
  license: 'Apache-2.0' | 'MIT' | 'BSD-2-Clause' | 'user-plugin';
  sizeBytes: number;
  files: Array<{ url: string; sha256: string; path: string }>;
  requires?: { ramGb?: number; vramGb?: number; cpuFeatures?: string[] };
  capabilities: Record<string, unknown>;
}
```

### 12.2 生命周期

- 懒加载：首次使用时下载/加载；`ensureReady()` 与 `generate()` 分开计时。
- 单引擎常驻：同一时刻只保留一个重 TTS + 一个重 ASR；切引擎先 `unload()` 旧实例。
- 实例缓存：按 engine id 缓存；`inUse` 计数保护长任务；idle 10 分钟回收（可配）。
- 模型目录变更/删除：拒绝正在使用的模型；提示先切换。
- 下载：进度事件、断点续传、SHA256 校验、磁盘预算；失败不污染现有模型。

### 12.3 许可

- 内置只收 Apache-2.0 / MIT / BSD-2-Clause。
- 受限模型（IndexTTS、Piper、Supertonic、Moonshine 中文等）只经用户插件接入，不打包。
- 许可接受状态持久化；未接受时 `isAvailable()` 返回 false + reason；UI 能弹接受框。
- 模型权重和代码许可分开记录。

## 13. Desktop 改动

- `packages/desktop/src/renderer/mafw/voice/` 保留 `silero.ts`、`worklet-player.ts`、`pcm-align.ts`；`session.ts` 改为 `VoiceClient`：
  - 连接 `/ws/voice`；
  - 发送 mic PCM；
  - 接收 partial/final/TTS PCM；
  - 保留 `flush()`、`speakFromTool`、artifact 播放、去重；
  - 状态机由 gateway 事件驱动，本地仍保留 `listening/speaking/interrupted` 用于 UI。
- `use-voice-binding.ts`：
  - 按一次麦克风 → `voiceClient.start()`；再按 → `stop()`；
  - `asr.partial` → 显示实时字幕；
  - `routing` → UI 徽标（本地/云端/CPU）；
  - `tts.start` → 播放；`turn.done` → 自动下一轮；
  - barge-in → `player.flush()` + `send cancel`。
- 旧 `VoiceSession` API 保留一个兼容适配器，确保 `mafw_media_speak` artifact 自动播放不回归。
- 设置页：`voice.mode`（auto/local/cloud）、`voice.tts.engine`、`voice.asr.engine`、模型下载/许可、路由状态。

### 13.1 会话与文本投影

- **语音驱动当前 chat session**，不另开一条无历史的语音会话：VoiceRuntime 调既有 `runtime.session.promptAsync`，沿用当前 session 的 agent、模型、记忆、工具和权限。
- **回合归属**：VoiceRuntime 为每个语音回合生成 `turnId`，并记录本轮 prompt 的消息 id/会话事件游标；只消费本轮 assistant 的 `part.delta`/`part.updated`，不朗读历史消息或其他回合。
- **取消粒度**：不调用 session-scoped abort；VoiceRuntime 自己维护本轮 abort controller。运行时若暂时没有 per-turn abort，则停止 TTS、丢弃本轮剩余文本，LLM 后台完成的结果只落历史、不播报。
- **朗读文本投影**：只朗读 assistant 的最终可见文本；Markdown 去格式、代码块/表格/链接转成简短口语或跳过；工具卡、reasoning、synthetic 指针不朗读。若本轮只有工具调用没有 assistant 文本，不强行朗读，发 `turn.done` 等下一轮。
- **防双播**：如果本轮 assistant 调用了 `mafw_media_speak` 并产生 `[语音回复 art:...]`，VoiceRuntime 不再对同一段文本做运行时 TTS；artifact 播放优先。旧 `h:<hash>` 去重保留，但只作为第二道防线。
- **权限/提问**：工具触发 approval 或 ask_user 时，TTS 暂停并发送 `approval.required`/`question.required` 事件；客户端展示卡片，用户处理后再继续。不要用语音替用户点确认。
- **首句 ≤20 字**：作为 **prompt 约束 + chunker 偏好**，不是硬切。系统提示要求「先给一句 20 字以内的直接回答，再展开」；chunker 首句优先在逗号/句号处切，找不到短边界才放宽。禁止在词/标识符中间硬切。

## 14. 兼容 / 迁移

- 新增 `/ws/voice` 是 additive；旧 `/api/tts`、`/api/tts/stream`、`/api/tts/voices`、`/api/tts/interrupt` 不动。
- 旧 desktop 继续走 SSE；新 desktop 用 WS，feature flag `voice.runtimeV2` 控制。
- `mafw_media_speak` 工具继续可用；VoiceRuntime 完成 TTS 后可落 artifact，保持 `[语音回复 art:...]` 语义。
- 迁移顺序：
  1. 接口/目录/registry + 单测（不改 UI）。
  2. 本地 ASR 流式 + 两遍解码；`/ws/voice` ASR-only；CLI/dev 客户端；核显基准。
  3. 本地 TTS 逐句流 + barge-in；desktop flag；AEC 外放测试。
  4. 云端适配器 + router + 设置页 + 许可/下载 UI。
  5. mobile/TUI/agent 客户端；旧路径标记 deprecated。
- 每个阶段独立 commit；每阶段报告新增用例数与全量用例数。

## 15. 测试 / 观测

### 单元

- `AsrEngine`/`TtsEngine` 能力校验：语言、采样率、streaming、许可。
- `VoiceRouter` 四态与回退。
- `SentenceChunker` 首句长度、中英混排、`[tag]` 不切。
- `VoiceSession` 状态机：listening/thinking/speaking/interrupted/error。
- `/ws/voice` 协议编解码：二进制方向、错误帧、cancel。
- `AecProcessor`：far-end/near-end、double-talk。

### 集成

- Fake ASR/TTS 引擎 + WS golden tests。
- `sherpa-onnx-node` Windows x64 冒烟：加载 Zipformer、Kokoro/Melo、Qwen3-ASR 0.6B。
- 打包测试：`asarUnpack`、DLL 路径、`enableExternalBuffer:false`、Electron ABI。

### E2E / 基准

- 30–50 条中文 + 中英混说测试集：首 partial、final、TTFA、RTF、内存。
- 外放/耳机两种 barge-in 测试：误打断率、停播延迟。
- 云端断网/超时回退测试。
- 模型切换/显存释放测试：连续切 3 个引擎不 OOM。

### 指标

每次 turn 记录：`asr_first_partial_ms`、`asr_final_ms`、`llm_first_token_ms`、`tts_first_audio_ms`、`tts_total_ms`、`barge_in`、`false_barge_in`、`engine`、`routing`。写入 gateway 日志；可选 dashboard。

## 16. 阶段计划（草案）

| 阶段 | 交付 | 验收 |
|---|---|---|
| P0 | 接口/目录/registry/能力测试；`sherpa-onnx-node` 依赖与打包验证 | 单测绿；Windows 能加载一个模型 |
| P1 | 本地 ASR 流式 + 两遍解码 + `/ws/voice` ASR-only | 首 partial ≤ 300 ms；final ≤ 500 ms（核显实测） |
| P2 | 本地 TTS 逐句流 + desktop flag + barge-in + 外放 AEC | 端到端首声 ≤ 1.5 s / 流水线首声 ≤ 300 ms；停播 ≤ 100 ms；外放误打断 ≤ 5% |
| P3 | 云端适配器 + router + 设置/许可 UI | 云端断网自动回退；路由徽标正确 |
| P4 | dGPU sidecar（Qwen3-ASR-1.7B + CosyVoice3，opt-in） | 4090 上首声 ≤ 400 ms；显存可回收 |
| P5 | mobile/TUI/agent 接入；旧路径 deprecated | 协议复用；旧 artifact 不回归 |

## 17. Builder check 后钉死的点

1. **端点所有权**：客户端 VAD + Smart Turn 决定回合边界；sherpa endpoint 只做 ASR 内部分句提示。服务端信任 `end_audio`，非浏览器客户端可 `clientVad:false` 由服务端代跑。
2. **取消粒度**：`cancel` 只 abort 当前语音回合的 TTS/LLM，不 abort chat session；工具副作用不取消；本轮剩余文本只落历史不播报。
3. **会话归属**：语音驱动当前 chat session，沿用 agent/模型/记忆/工具/权限；VoiceRuntime 用 `turnId` 只消费本轮 assistant 输出。
4. **朗读文本投影**：只读 assistant 最终可见文本；Markdown 去格式，代码/表格/链接转口语或跳过；工具卡/reasoning/指针不读；只有工具调用没有文本时静默结束。
5. **防双播**：本轮有 `mafw_media_speak` artifact 时，运行时 TTS 让位给 artifact；旧 hash 去重保留为第二道。
6. **首轮/隐私**：云端必须显式同意；本地模型未安装时提示下载或选择云端，不阻塞、不偷传；`auto` 用静态硬件档 + 启动微基准 + 最近 3 轮 TTFA 判断。
7. **协议**：v1 只接受 PCM16 16 kHz；`webm-opus` 预留不实现；二进制方向固定（客户端→mic，服务端→TTS）。
8. **指标定义**：`e2e_first_audio_ms` 从 `end_audio` 到第一块 TTS；`pipeline_first_audio_ms` 从首个 LLM token 到第一块 TTS。验收同时看两者，避免把 LLM 延迟算进 TTS 或反之。

## 18. 需要你拍板

1. **参考机器**：本地档验收用哪台核显机器？Intel Iris Xe / AMD 780M / 其他？没有真机就只能远程或借测，P1/P2 的 300/500/800 ms 指标无法签字。
2. **dGPU 档排期**：Qwen3-ASR-1.7B + CosyVoice3 是放进 v1（P3），还是按草案放 P4（v1 先 iGPU + cloud）？
3. **云端厂商**：默认阿里 Qwen3-ASR-Flash + MiniMax TTS，还是继续小米 MiMo 全家桶（MiMo ASR 只能做离线/语音消息，不能实时）？
4. **目标延迟**：iGPU 端到端首声 1.5 s / dGPU+云 800 ms，还是你有更硬/更松的数字？
5. **声音克隆**：确认 v1 只留接口、不做产品化？

其余我按本文档的「我的暂定」执行：`/ws/voice` + 旧 SSE 兼容、Zipformer + Qwen3-ASR-0.6B 两遍解码、Kokoro/Melo 核显 TTS、外放不过则 P2 内上服务端 AEC、v1 desktop 优先。
