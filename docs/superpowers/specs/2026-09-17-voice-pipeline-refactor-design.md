# 语音管道重构设计（Voice Pipeline Refactor）

> 日期：2026-09-17 · 状态：待评审
> 动机：为「实时语音对话模式 / VAD 引擎可配置 / TTS 引擎插件化」三个未来功能打地基。
> 依据：业界调研（Pipecat Frame/Pipeline + Smart Turn、LiveKit Agents TurnHandlingOptions、OpenAI Realtime PlaybackTracker、Vocode 反模式）。

## 1. 现状与问题

当前语音链路分布：

| 位置 | 职责 | 问题 |
|---|---|---|
| `ChatPane.tsx`（2455 行） | speakText / playStreamingTts / barge-in / TTS picker / 语音发送，~400 行内联 | 语音状态机、播放、发送与 UI 纠缠 |
| `VoiceRecorder.ts`（213 行） | 麦克风流 + Silero VAD 分段 + monitor | VAD 直接当轮次边界（onSpeechEnd → 立即上传） |
| `AudioReply.tsx`（134 行） | `[语音回复 art:<id>]` 标记渲染 + 播放 | 基本健康，小改 |
| gateway `media/tts-service.ts` + index.ts 路由 | /api/tts、/api/tts/stream、/api/tts/voices | MiMo 硬编码，无插件缝 |

调研确认的差距（详见对话调研报告）：

1. **VAD = 轮次边界**：Vocode 教训——endpointing 焊死在分段逻辑里会失去演化空间。
2. **半吊子打断**：barge-in 只停前端播放，gateway 在途 TTS 合成照烧 token。
3. **BufferSourceNode onended 链式调度**：主线程抖动欠载爆音、无播放游标、打断需逐个停已调度节点。
4. **隐式状态**：`playedVoiceArtifacts`/`streamedSpeakHashes` 双去重 + `activePlayCount` 引用计数推断播放状态。

## 2. 目标与非目标

**目标（本次交付）：**

- G1. Desktop 抽出 UI 无关的 `voice/` 核心：VadAnalyzer / TurnStopStrategy / TtsPlayer(AudioWorklet) / VoiceSession 状态机
- G2. VAD 参数配置化（confidence/startSecs/stopSecs/minSpeechMs），引擎接口可换（Silero 为默认实现）
- G3. Gateway TTS 插件化：`TtsEngine` 接口 + 统一插件包体系新增 `tts` 贡献类型 + `~/.mafw/tts-plugins/` legacy 目录；MiMo 为内置实现
- G4. 打断传播：barge-in → 前端 flush 播放缓冲 + `POST /api/tts/interrupt` 取消 gateway 在途合成
- G5. ChatPane 语音代码全部迁出，只留绑定层

**非目标（明确不做）：**

- N1. 实时全双工对话模式本体（只留状态机/打断/游标的接缝）
- N2. 语义 turn detector（Smart Turn 类 ONNX 模型）——TurnStopStrategy 接口预留
- N3. S2S 端到端模型接入
- N4. 上下文按播放游标截断（播放游标 v1 只记日志；截断随实时对话模式再做）
- N5. TUI / plugin 侧语音能力

## 3. Desktop 架构：`renderer/mafw/voice/`

```
voice/
  index.ts         createVoiceSession(deps) 工厂 + 公共类型导出
  session.ts       VoiceSession 状态机 + 对外 API（唯一入口）
  vad/
    types.ts       VadAnalyzer 接口 + VadParams
    silero.ts      SileroVadAnalyzer（现有 VoiceRecorder 逻辑迁入，含 WASM 资产处理）
  turn/
    strategy.ts    TurnStopStrategy 接口 + SilenceTimeoutStrategy(stopSecs)
  playback/
    player.ts      TtsPlayer 接口
    worklet.ts     AudioWorkletPlayer（环形缓冲，24kHz PCM16）
    pcm-worklet.js AudioWorkletProcessor（publicDir /voice/ 静态资产）
  interrupt.ts     barge-in 协调（VAD monitor → flush + gateway interrupt）
```

### 3.1 VadAnalyzer（对齐 Pipecat VADAnalyzer）

```typescript
interface VadParams {
  confidence: number      // 语音判定阈值，默认 0.5（现 POSITIVE_THRESHOLD）
  negativeConfidence: number  // 默认 0.35
  stopSecs: number        // 静音宽限（现 REDEMPTION_MS 1200ms → 1.2）
  minSpeechMs: number     // 防误触最短语音（现 500）
  preSpeechPadMs: number  // 段前缓冲（现 800）
}

interface VadAnalyzer {
  start(): Promise<void>
  stop(): void
  readonly params: VadParams
  // VAD 只发原始信号，不决定轮次（关键分层）
  on(event: 'speech_started' | 'speech_stopped' | 'misfire',
     cb: (audio?: Float32Array) => void): void
}
```

`SileroVadAnalyzer` 持有 MicVAD 实例与单一 getUserMedia 流（含 echoCancellation/noiseSuppression/autoGainControl，沿用现状）；多个消费者（recording + barge-in monitor）共享一个 analyzer 实例，替代现有 mode 切换逻辑。

### 3.2 TurnStopStrategy（轮次边界可换）

```typescript
interface TurnStopStrategy {
  // VAD speech_stopped 后由策略决定本轮是否结束
  onSpeechStopped(audio: Float32Array): 'end_turn' | 'continue'
  reset(): void
}
```

初版唯一实现 `SilenceTimeoutStrategy`：`stopSecs` 内无 speech_started 即 `end_turn`。VAD 参数与策略参数同源配置。未来语义 turn detector 作为新实现挂入，上层不动。

> 注：v1 行为与现状等价（VAD stop 即段结束）；分层的价值在于接缝，不在于引入新行为。

### 3.3 TtsPlayer（AudioWorklet 环形缓冲）

```typescript
interface TtsPlayer {
  feed(pcm: Int16Array): void     // 投喂 PCM16 块（采样率在构造时固定）
  flush(): void                   // barge-in：清环形缓冲，即时静音
  readonly playCursorMs: number   // 已实际播放的游标（v1 记日志用）
  on(event: 'started' | 'drained' | 'flushed', cb: () => void): void
  dispose(): Promise<void>
}
```

`AudioWorkletPlayer`：主线程经 `port.postMessage` 投喂 PCM 块到 worklet 内环形缓冲，`process()` 以 128 帧回调拷贝输出。起步缓冲 ~200ms 抗网络抖动；`flush()` = 清缓冲（一条 port 消息），替代现有"逐个停 BufferSource + 60s onended 兜底"。`playCursorMs` 由 worklet 上报已渲染帧数换算。AudioContext 仍在用户手势内创建 + `setSinkId('default')`（沿用现状两条 Windows 踩坑防线）；**采样率取 SSE 响应头声明的引擎采样率**（不再硬编码 24000），同一播报会话内不变。

`pcm-worklet.js` 放 renderer publicDir `/voice/`（与 VAD 资产同款布局，dev 静态服务 / build 原样拷贝，不经 import()）。

### 3.4 VoiceSession（唯一对外入口，显式状态机）

```typescript
type VoiceState = 'idle' | 'recording' | 'speaking' | 'interrupted'

interface VoiceSession {
  // 语音输入
  startRecording(): Promise<void>
  stopRecording(): void
  // 语音输出（两条触发路径，语义不同）
  speak(text, voice?): Promise<void>        // 手动「播报」：流式 TTS，失败回退整段 wav
  speakFromTool(text, voice?): Promise<void> // mafw_media_speak 工具事件：流式播放，hash 去重，不回退
  stopSpeaking(reason: 'user_barge_in' | 'manual'): void
  // 状态与事件
  readonly state: VoiceState
  on(event: 'state' | 'segment' | 'barge_in', cb: (data?: any) => void): void
  dispose(): void
}
```

职责收敛：
- **播放互斥 + barge-in**：speaking 时自动挂 VAD monitor（共享 analyzer）；speech_started → `flush()` + 上报 gateway interrupt + 状态 → interrupted。替代 `activePlayCount` 引用计数。
- **录音分段**：VAD → TurnStopStrategy → `segment` 事件（WAV bytes + duration）→ ChatPane 绑定层上传（`uploadAndSendVoice` 逻辑迁到绑定层 helper，VoiceSession 不认识 store/IPC）。
- **去重**：`speakFromTool` 的 streamed-hash 去重保留但收敛进 VoiceSession 内部（`recentSpeaks: Set<string>`，TTL 清理），替代散落在 ChatPane 的 `playedVoiceArtifacts`/`streamedSpeakHashes`。
- **非流式兜底**：speak 流式失败时回退 `/api/tts` wav（沿用现状逻辑）。

### 3.5 ChatPane 绑定层（迁出后剩余）

- 按钮事件 → `voiceSession.startRecording()/speak()/stopSpeaking()`
- `voiceSession.on('segment')` → 乐观消息 + `uploadAndSendVoice`（helper 函数迁到 `voice/upload.ts`，仍调 `window.api.mafw.media.uploadAndCreate`）
- `voiceSession.on('state')` → `setVoiceRecording/setTtsSpeaking` UI 信号
- TTS picker（音色列表/试听/风格输入）保留在 ChatPane（纯 UI，不属于核心）
- `onRegisterMediaSpeak` 接线改为转发到 `voiceSession.speakFromTool`

AudioReply.tsx 基本不动（标记渲染逻辑健康）；仅播放改走 VoiceSession（保证互斥与 barge-in 一致）。

## 4. Gateway：TTS 插件化 + 打断传播

> 选型依据：开源 TTS 调研（2026-09-17）。许可安全档：Kokoro（Apache 2.0 含权重）、CosyVoice 2/3（Apache 2.0）、MeloTTS（MIT）、sherpa-onnx（Apache 2.0）；许可有坑不内置：ChatTTS/F5-TTS/Fish S2（非商用/研究许可）、IndexTTS（商用需授权）、edge-tts（微软 ToS 风险）、Piper（GPL 只能 sidecar）。

### 4.1 TtsEngine 接口

```typescript
interface TtsEngine {
  name: string
  capabilities: {
    streaming: 'native' | 'none'        // native=边生成边出块；none=走句切分适配层
    voiceCloning: boolean               // 支持 refAudio
    styleControl: boolean               // 支持 opts.style 文本风格指令
    languages: string[]
    sampleRate: number                  // per-engine 声明（22.05k/24k/32-48k 并存，不强写 24k）
  }
  voices(): { id: string; label: string; lang: string }[]
  synthesizeStream(text: string, opts: TtsOpts, signal: AbortSignal): AsyncIterable<PcmChunk>
  synthesize(text: string, opts: TtsOpts): Promise<Buffer>   // 整段 wav（兜底）
}

interface TtsOpts {
  voice?: string
  style?: string                        // 风格指令（MiMo/CosyVoice instruct）
  speed?: number
  lang?: string                         // 中英混读场景显式语言标记
  refAudio?: { path: string; text?: string }   // 声音克隆参考音频（预留，不支持则忽略）
}

interface PcmChunk { pcm: Buffer; sampleRate: number }   // 采样率随块走
```

- **采样率策略**：引擎声明 `sampleRate`，`PcmChunk` 携带；`/api/tts/stream` SSE 响应头带 `sampleRate`，前端 AudioWorkletPlayer 按声明采样率创建 AudioContext（同一引擎会话内不变，不逐块重采样）
- **伪流式适配层**（`tts/sentence-adapter.ts`）：`capabilities.streaming === 'none'` 的引擎，gateway 侧句切分（中英文标点 + 长度上限）→ 逐句 `synthesize()` → 立即 yield chunk，统一对外 `AsyncIterable<PcmChunk>` 流式语义
- 内置 `mimo` 引擎：现有 `tts-service.ts` 逻辑原样迁入，经 `registerBuiltin('mimo', …)` 注册（与 runtime/media 内置件同款 dogfood），`capabilities.streaming: 'native'`
- 内置 `kokoro` 引擎：kokoro-js（transformers.js ONNX Runtime，Node 进程内，Apache 2.0 含权重）；90MB 量化模型**按需下载**到 `~/.mafw/models/kokoro/`（不打包），`streaming: 'none'`（走适配层），定位离线兜底
- 插件加载：统一插件包（§5.14b）新增 `tts` 贡献类型 + `~/.mafw/tts-plugins/*.js` legacy 目录（形态 A：插件内自带 HTTP client 接外部服务）；优先级 包 > legacy > 内置；`PluginHost.reload()` 原子推入
- 配置路由：`media.tts.engine`（默认 `mimo`）+ `media.tts.pluginConfig.<engine>`；引擎未知时 fail-open 回退 mimo + warn 日志
- `GET /api/tts/voices` 返回当前引擎 voices + `capabilities`（picker 可显示能力徽标）；`/api/tts`、`/api/tts/stream` 路由签名不变（桌面端零契约变更）

### 4.2 打断传播

- 新端点 `POST /api/tts/interrupt { sessionId }`：gateway 维护 `sessionId → AbortController` 映射（synthesize 调用时登记、结束清理），收到 interrupt 即 abort 在途合成。route-catalog 登记 + OpenAPI 契约 + SDK `tts.interrupt`
- 前端 VoiceSession barge-in 时 fire-and-forget 调用（失败仅 warn，本地 flush 已生效）
- 播放游标 `playCursorMs` v1 仅打日志（`[voice] flushed at <ms>ms`），不进任何上下文逻辑

### 4.3 配置面

```yaml
media:
  tts:
    engine: mimo            # 新增
    defaultVoice: 茉莉       # 现有
    style: ""               # 现有
    vad:                    # 新增（desktop 启动时读取下发）
      confidence: 0.5
      stopSecs: 1.2
      minSpeechMs: 500
```

VAD 参数由 desktop 经 `GET /api/config?path=media.tts.vad`（现有 config 通道）读取，fail-open 用默认值。

## 5. 错误处理

| 场景 | 行为 |
|---|---|
| getUserMedia 拒绝 | VoiceSession 保持 idle，`state` 事件带 error；UI toast（沿用现状） |
| Silero WASM 加载失败 | VadAnalyzer start 失败 → speak/record 均报显式错误，不静默 |
| TTS 流 HTTP 非 200 | speak 回退整段 wav 路径（沿用现状） |
| barge-in 时 gateway interrupt 失败 | 仅 warn；本地 flush 已生效，用户感知正常 |
| AudioWorklet 模块加载失败 | 回退旧 BufferSource 播放器？——**不回退**：显式报错。Electron Chromium 必有 AudioWorklet，兜底链只会藏 bug |
| kokoro 模型下载失败 | 引擎状态记 error，fail-open 回退 mimo + 提示检查网络（模型源可配镜像） |
| 插件 TTS 引擎加载/执行抛错 | fail-open 回退 mimo + 状态记 error（对齐 media 插件体系语义） |

## 6. 测试策略

- **纯逻辑单测**（desktop，`bun test`——与现有 `components/*.test.ts` 同款运行方式）：TurnStopStrategy 状态转换、VoiceSession 状态机迁移（mock VadAnalyzer/TtsPlayer）、去重 TTL
- **gateway 单测**（jest）：TtsEngine 注册表路由（插件覆盖内置、未知引擎 fail-open）、interrupt 端点 abort 语义
- **手测清单**（文档化于实现计划）：录音分段 → 发送、流式播报、barge-in 打断（确认 gateway 日志显示合成取消）、音色切换、`[语音回复]` 自动播放不重复
- AudioWorklet 环形缓冲本身：jsdom 无音频栈，以手测 + 日志断言（chunks 数、playCursorMs 推进）为准

## 7. 迁移计划（实现顺序）

1. Gateway TtsEngine 注册表 + mimo 内置迁入 + 句切分适配层 + interrupt 端点（路由签名不变，桌面端无感）
2. kokoro 内置引擎（kokoro-js 进程内 ONNX + 模型按需下载）——作为适配层的真实消费者验证伪流式路径
3. Desktop `voice/` 骨架：VadAnalyzer(Silero 迁入) + TurnStopStrategy + 行为等价验证
4. AudioWorkletPlayer + VoiceSession，ChatPane 绑定层切换，删除旧代码
5. TTS 插件包加载接线 + 配置面 + 文档（AGENTS.md §5 增补语音架构小节）

每步独立可交付、可回滚。

## 8. 后续方向（本期不做，已留缝）

- CosyVoice HTTP sidecar 插件（GPU 用户本地中文天花板，Apache 2.0）——插件体系就绪后作为社区插件发布
- OpenAI-compatible TTS 通用插件（一次接入 Kokoro-FastAPI / Fish / 各家兼容服务）
- GPT-SoVITS 声音克隆插件（refAudio 扩展点已预留）
- 语义 turn detector（TurnStopStrategy 新实现）
- 实时全双工对话模式（VoiceSession 状态机 + 打断传播 + 播放游标已就位）
