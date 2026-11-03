# Voice Duplex v1：单脑实时全双工语音设计

> 日期：2026-11-03
> 状态：builder check 已完成，9 项问题已收敛；待用户批准，尚未批准实施
> 范围：MAFW gateway + desktop；保留现有文本 chat、TTS API 和语音 artifact
> 前置事实：`2026-10-28-voice-runtime-v2-design.md`、`2026-10-28-voice-bench-p1.md`，以及 2026-11-03 对当前源码和业界实时语音系统的调研

## 1. 意图与为什么

目标不是单纯降低 TTS 首包，而是让真实 coding 对话可以自然进行：

> agent 正在播报或执行任务时，用户可以随时开口；系统立即安静、听懂新意图、保留任务上下文。agent 空闲时，约 1–2 秒后开始回复；agent 忙时先给确定性的“已收到/仍在执行”反馈，真正回答允许等待当前任务结束。

首版采用**单脑架构**：现有 agent 是唯一推理与工具执行主体，不引入“快脑子”。语音协调器负责音频、轮次、播放与取消，不做另一套推理。

用户已明确：**用户说完后等待 1–2 秒开始回复可以接受**；不为了亚秒首声更换 TTS/Realtime 引擎，也不提前引入双模型前后台。该口径适用于 agent 空闲回合，不假装“单脑 + 不取消长工具”也能保证忙时 1–2 秒给出答案。

## 2. 当前事实

### 2.1 产品旧链路

当前 desktop 语音消息主要是：

```text
Silero 固定约 1.2s 判停
→ 整段 WAV 上传
→ Media Agent 多模态分析
→ 主 agent 再经 mafw_media_ask 获取音频理解
→ 主 agent 回答
→ 手工/工具触发 TTS
```

主要问题：

- 没有流式 ASR partial；同段音频可能发生两次多模态分析。
- 语音播报不是由 assistant delta 驱动。
- barge-in 主要停播放与 TTS，不停当前回答；打断后的新语音可能被丢弃。
- 没有连续麦克风生命周期、播放位置回传和语音回合隔离。

### 2.2 可复用的新基础

已存在但尚无产品客户端的 `gateway/src/voice/` P1 切片：

- ASR 契约、引擎注册、Qwen3-ASR-1.7B vLLM sidecar、`/ws/voice`。
- 基准记录：gateway 首 partial p50 **180 ms**、final p50 **50 ms**（`docs/research/2026-10-28-voice-bench-p1.md`）。
- 该基准使用真实 voice classes + bench server，不代表生产 desktop 已接通，也不代表 Windows 默认 sidecar spawn 可用。

可复用的现有播放/TTS 能力：

- `gateway/src/tts/` 引擎注册与 `streamSentences()`。
- desktop AudioWorklet 播放器、播放背压、溢出上报、barge-in flush。
- 当前 chat session 的 prompt、queue、事件流、权限和记忆体系。

### 2.3 必须修复的生产缺口

- `/ws/voice` 只有 bench 客户端；desktop/mobile/TUI 未接。
- `VoiceSession` 在 `asr.final` 后直接 `turn.done`，没有 LLM/TTS。
- `ready.routing` 硬编码；`hello.tier/clientVad` 没有真实语义。
- Qwen sidecar 不能收养已运行实例，且 `voice_sidecars/` 未进入全部发布/桌面 staging 路径。
- 当前 worklet 只有破坏性 `flush()`，没有保留缓冲的 pause/resume。
- 没有播放进度协议、迟到语音抑制和语音专属审批提示。

## 3. 目标 / 非目标 / 反目标

### 3.1 v1 目标

1. 按一次麦克风进入连续会话，直到手动停止；不再每轮重新初始化 VAD/麦克风。
2. 用户说话时出现流式 partial；回合判定后由**当前 chat session 的现有 agent**回答。
3. assistant 可见文本增量驱动切句与 TTS；agent 空闲时，用户说完后约 1–2 秒开始回复是正常目标。忙时只承诺确定性状态反馈，不承诺新答案的时限。
4. 播报期间麦克风持续采集，上下行 PCM 可同时进行。
5. 用户开口立即暂停声音；附和/短噪声可续播，真正插话才清空并切换回合。
6. 播放端记录实际 playedMs；打断后按实际播放位置衔接，不把未播内容当作用户已听到。
7. 普通语音打断不调用 session-scoped abort，不杀写文件、测试等工具副作用。
8. 旧回合迟到的文本/PCM 不进入新回合播放。
9. 本地 ASR 与现有 TTS 可复用；所有路由与降级状态诚实可见。

### 3.2 非目标（v1 不做）

- 快脑子、双模型前台/后台、端到端 speech-to-speech 主模型。
- GPT-Live / MOSS-Live / Gemini Live / OpenAI Realtime 等云前台适配。
- mobile/TUI 的完整语音 UI；协议只为其保留扩展空间。
- 服务端 VAD/Smart Turn；v1 只支持 desktop 客户端持有该能力。
- 声音克隆、PSTN、会议转写、视频。
- 直接用语音执行破坏性任务取消或权限批准。
- 引入 Pipecat/LiveKit 作为新运行时；只借鉴其取消、播放截断和轮次语义。
- 为追求更低首声而替换当前 TTS 引擎。

### 3.3 反目标（能跑也算失败）

- 把“VAD 一响就 flush”宣称为完整全双工。
- 用户“嗯/对/继续”导致长回答被永久打断。
- 播放自己的声音反复触发 barge-in。
- 为语音打断调用 `runtime.session.abort`，误杀工具。
- 旧回答在新问题之后继续播放，或同一内容双播。
- 指标从 `end_audio` 才开始计算，从而隐藏真实判停等待。
- 声称支持 cloud/server VAD/routing，实际只是硬编码或 no-op。

## 4. 约束与已决定的方向

- v1 验收机：本机 RTX 4090 Laptop 16 GB / Windows 11；ASR sidecar 可运行在 WSL2/Linux。
- gateway TypeScript CJS；desktop Electron + SolidJS；renderer 只经 `window.api` 使用 preload 能力。
- 默认复用本地 Qwen3-ASR 与当前 TTS（生产通常为 MiMo）；云 ASR/TTS 路由不属于本批交付。
- 中文为主，允许中英混说、代码标识符；不为了语音修改主 agent 的模型。
- 使用 `/ws/voice` 双向连接：客户端二进制=麦克风 PCM16 16 kHz mono；服务端二进制=TTS PCM。
- `hello` 明确拆分 `voiceSessionId`（每次音频连接唯一）与 `chatSessionId`（目标现有聊天会话）；不再让一个 sessionId 兼任两种身份。
- v1 必须从已打开的 chat session 启动；Welcome 无会话时不隐式创建，入口显示“先打开会话”。切换 chat session 时关闭旧音频连接并重新 hello，不迁移旧播放。
- v1 `hello.clientVad` 必须为 `true`。收到 `false` 返回明确 `client_vad_required`，不伪装支持服务端 VAD。
- v1 `tier:'cloud'` 返回 `cloud_not_implemented`；`auto/local` 只选择实际可用的本地引擎，失败进入 `degraded` 并说明原因。
- 语音归属依赖 canonical `turn.started/completed` 能力；不能提供该能力的 runtime/dialect 返回 `voice_runtime_unsupported`，不靠模糊启发式冒充支持。
- 旧 `/api/tts*`、`mafw_media_speak`、artifact 播放与文本 chat 保持兼容；新路径由 `voice.duplexV1` flag 控制。

## 5. 目标体验

```text
[按麦克风] → listening
  用户说话 → asr.partial 实时字幕
  客户端 VAD + Smart Turn 判定说完 → end_audio
  → asr.final
  → 当前 agent（可能立即执行，也可能排队）
  → 可见文本 delta → 口语化/切句 → TTS PCM
  → speaking

播报中用户开口：
  → 本地立即 pause（保留未播缓冲，目标 ≤150ms）
  → 短附和/短噪声：resume，从断点继续
  → 真正插话：记录 playedMs → flush → cancel response → 新 utterance
  → agent 根据新输入回复；后台工具不被误杀

[再按麦克风] → stop，释放连接、ASR、TTS 与音频资源
```

## 6. 总体架构

```text
Desktop VoiceClient
  ├─ Mic / AEC / Silero（单实例，持续生命周期）
  ├─ Smart Turn + 初阶 backchannel 判定
  ├─ WS PCM 上行 / TTS PCM 下行
  ├─ AudioWorklet：pause / resume / flush / backpressure
  └─ Playback Ledger：playedMs / segment 进度
                    │ /ws/voice
                    ▼
Gateway VoiceRuntime
  ├─ VoiceSession（显式状态机 + generation）
  ├─ ASR Engine：复用 Qwen3-ASR P1
  ├─ TurnCoordinator：utterance、response、queue、取消
  ├─ VoiceAgentBridge（组合根注入）
  │    └─ 当前 chat session 的现有 agent；不切模型
  ├─ PromptCorrelation：所有 gateway prompt 的 FIFO 提交→turn 绑定
  ├─ SpeechProjector：可见文本过滤 + 增量切句
  ├─ TTS：复用 TtsEngineRegistry + streamSentences()
  ├─ VoicePlaybackContext：各 segment 的文本与播放进度
  └─ WS Backpressure：客户端水位→暂停/恢复 TTS iterator
```

### 6.1 单脑边界

语音协调器可以做确定性的状态提示，例如“收到，等当前任务结束”，但不得：

- 调用另一模型生成答案；
- 直接执行工具或修改文件；
- 写长期记忆；
- 修改当前 chat session 的模型/variant；
- 替用户批准权限或取消有副作用的任务。

所有需要推理的输入都进入现有 agent。

## 7. Desktop 设计

### 7.1 VoiceClient

新增 desktop `VoiceClient`，与旧 `VoiceSession` 适配共存：

- `start()`：创建/复用 AudioContext、麦克风、Silero 与 `/ws/voice` 连接。
- `stop()`：幂等释放全部资源。
- 将 Silero Float32 帧转换为 PCM16，按 20 ms 发送。
- `asr.partial/final` 写入字幕/临时 composer 投影，不直接重复发送文本消息。
- 接收 TTS PCM 并复用现有背压播放器。
- 旧 `speak()` / `speakFromTool()` / artifact 播放通过兼容适配器保留，不启用 duplex flag 时行为不变。

麦克风和 VAD 不因一轮播报结束而销毁；只有用户停止、会话切换或 fatal error 才重建。

### 7.2 客户端 AEC

默认：

```ts
getUserMedia({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
})
```

以 `getSettings()` 记录实际能力，不能只依据请求值声称 AEC 已开启。耳机与真实扬声器外放都验收；外放不达标时可以降级为 PTT，但不得静默自触发循环。服务端 AEC 不在 v1 范围。

### 7.3 播放器：pause 与 flush 分离

- `pause()`：停止消费样本、保留 ring buffer 与游标，立即静音。
- `resume()`：从同一游标继续，用于误打断/backchannel。
- `flush()`：清空未播缓冲，用于真实插话。
- 保留现有 backpressure 与 overflow 上报。
- 播放游标以 worklet 已渲染样本数为权威，不以 SSE 已读/已 feed 字节数冒充已播放。

### 7.4 WS 下行背压（不能照搬 SSE reader gate）

浏览器 WebSocket 没有 receive-side `reader.read()` 暂停语义。v1 使用**客户端有界 JS PCM 队列 + 应用层水位协议**：

1. WS 收到的 PCM 先进入 VoiceClient 的有界队列，由调度器按 worklet 可播放空间投喂，绝不直接无界写入 30s ring。
2. 客户端按“JS 队列 + 已 feed 未播放”计算 bufferedMs；超过高水位发送 `playback.backpressure { state:'pause', bufferedMs }`，低于低水位发送 `resume`。
3. gateway 收到 pause 后停止调用当前 TTS async iterator 的 `next()`，resume 后继续；初始沿用高 12s / 低 4s，实测可调整。
4. pause/resume/cancel/close 都须能打断等待；真正插话时清空客户端与 gateway 两侧队列。
5. 客户端另设硬上限与 `overflow` 显式错误；达到上限说明背压失效，必须报错并 flush，不允许静默丢帧。
6. 不采用 gateway 按实时速度限速发送，以免把生成与网络延迟强加给用户。

## 8. 轮次与状态机

VoiceSession 从 P1 的 `idle/listening/processing/closed` 扩为显式状态集合：

```text
idle
listening
user_speaking
endpointing
waiting_agent
agent_responding
speaking
overlap_pending
blocked
closed
```

核心规则：

1. 任意非 closed 状态都允许接收麦克风帧；ASR stream 是否接收由 utterance generation 决定，而非简单丢弃 `interrupted` 状态音频。
2. `speaking + vad.speech_started → overlap_pending`，客户端先 pause。
3. backchannel/短噪声 → 返回 speaking 并 resume；真实插话 → 当前 response cancelled，进入新的 user_speaking。
4. 每次新 utterance/response 都增加 generation；所有 ASR final、agent delta、TTS chunk 都校验 generation。
5. `stop` 和 socket close 必须幂等清理 ASR、TTS、监听器、队列注册和计时器。

## 9. ASR 与回合判定

### 9.1 客户端所有权

- Silero 只提供声学开始/结束信号，不独立决定最终回合。
- VAD stopped 后运行 Smart Turn；`complete` 才发送 `end_audio`。
- sherpa/Qwen 的 endpoint 只用于 ASR 内部，不与 Smart Turn 竞争产生双重 final。
- 首版可用规则化 backchannel 分类，不引入第二个 LLM：
  - 分类输入是**当前 utterance 的 ASR partial 与时长**，不等待 `stream.end()` 的 final。
  - 短时、无文本的咳嗽/点击倾向 resume；
  - 短文本“嗯/嗯嗯/对/好/是/行/继续/OK/yes”等且上下文为 agent speaking，倾向 backchannel；
  - 较长文本、纠正/命令/问题、或超过决策窗口仍不能确认，按真实插话处理。
- backchannel 只在客户端决定：不发送 `end_audio`，ASR stream 不 end、不产生 final、不提交 agent；客户端 resume 并发送 `playback.resumed`，服务端仅更新播放账本、保持原 response。
- 只有判定为真实插话后才发送 `cancel(response)` + `end_audio`；服务端此时才 end 当前 ASR stream 并提交新回合。VAD 本身永不直接创建 agent prompt，避免把“嗯”送入 agent。
- 初阶判定窗口默认约 600 ms，可配置；真实指标不达标时先调规则和阈值，不偷偷加模型。

### 9.2 ASR sidecar 生产化

- 支持 `external/adopt`：健康探测已运行的 sidecar，端口被占不再直接等于失败。
- 只有探测证明不是兼容服务时才报告 `sidecar_port_in_use`/健康错误。
- 保留 owned 模式的 spawn、windowsHide、树杀、退避与超时。
- `gateway/voice_sidecars/` 同步进入 npm files、deploy-local 和 desktop stage-gateway，添加发布包存在性测试。
- `ready.routing` 来自真实 engine/tier/健康状态；不硬编码。

## 10. 当前 agent 接入

### 10.1 VoiceAgentBridge

voice 模块只依赖注入端口，不直接 import 具体 runtime：

```ts
interface VoiceAgentBridge {
  startTurn(input: {
    chatSessionId: string
    voiceTurnId: string
    text: string
    idempotencyKey: string
    signal: AbortSignal
  }): Promise<VoiceAgentTurnHandle>
}
```

handle 至少提供：`queued/started/delta/completed/failed` 事件，以及 `cancelQueued()`。

组合根实现：

- 使用当前 chat session 的现有 `promptAsync` 与 canonical session events。
- 新增 gateway 侧 **PromptCorrelationService**，不依赖 `promptAsync` 返回 message id（当前没有）：
  1. 所有经 gateway 的 prompt 提交（voice、文本、queue flush、enriched）在提交前记录 per-chat FIFO：`submissionId/source/voiceTurnId?/promptHash/status`。
  2. 下一 canonical `turn.started` 绑定该 session 最早的 submitted-not-started 记录；queue flush 也走同一登记点，因此保持顺序。
  3. 同一 turn 的所有 assistant steps 都归属该记录，直到 `turn.completed/failed/aborted`；有 messageID/parentID 时用作一致性校验，不作为唯一依据。
  4. queue cancel、提交失败、终态和 socket close 都结算记录；重启后无法恢复绑定时 fail closed，不猜测归属。
- 文本输入与语音可以交错：文本回合也进入同一 FIFO，但其 source 不是 voice，delta 永不送 TTS。无需禁用 composer。
- 只消费本 voice turn 的 assistant 输出，不朗读其他打字回合或历史消息。
- runtime/dialect 无 canonical turn.started 时明确不支持 v1 语音闭环；不采用“下一个 assistant 大概属于我”的启发式。
- 不调用 `switchModel`，不改变当前 agent。

### 10.2 busy 与合并策略

- agent idle：立即提交；1–2 秒首声口径只适用于此路径。
- agent busy：使用现有 gateway queue + `delivery:'queue'`，发送 `agent.queued`，麦克风继续工作；VoiceSession 可用确定性文本“收到，当前任务还在执行，完成后接着处理”经同一 TTS/播放器给出状态反馈。该提示有自己的 turnId/segment 并计入指标，但不提交模型、不冒充任务答案，真正回复允许晚于 1–2 秒。
- 尚未提交的连续 utterance 可合并为一个用户 prompt，保留先后顺序。
- 已排队但未开始的 voice prompt 若被后续补充/纠正取代，可 cancel queued 后以新 generation 重新排队；不得重复执行。
- 已开始生成/执行工具的回合不 abort；旧输出只落文本历史，不再进入语音播放。
- 不为语音发明“立即 mid-turn steer”能力；opencode 当前 after-turn 语义不被夸大。

### 10.3 一次性 voice prompt context

允许附加**不改变模型/身份**的一次性 synthetic text part，内容仅包括：语音输出风格（首句尽量短、口语化）以及“不要调用 mafw_media_speak，语音由系统统一播报”。它不是第二个脑子，不修改全局 system prompt 或 InstructionSyncService 的常驻条目。

- part 标记 `synthetic:true`，不进入 T1 观察、桌面用户消息展示或 TTS。
- 只附着于当前 voice prompt；playback context 也通过同一通道传递，见 §12。
- runtime 不支持该 part 语义时返回 `voice_context_unsupported`，不启动 duplex 闭环；不能静默退化为会污染长期记忆或双播的普通文本。

## 11. 文本投影与 TTS

SpeechProjector 消费 delta：

- 只读最终用户可见 assistant 文本；不读 reasoning、工具卡、synthetic recall 指针。
- Markdown 转口语；代码块、表格、长路径/URL 默认摘要或跳过，不逐字朗读。
- 增量 `SentenceChunker` 在安全标点处切句；首句优先短句，但不硬切标识符。
- 每句调用现有 `streamSentences()`；PCM 通过 WS 二进制下行，携带对应 generation/turn/segment 元数据。
- 支持逐句 abort、整 response abort、socket close abort。
- duplex 模式下由 VoiceRuntime **独占自动发声**：一次性 voice context 要求 agent 不调用 `mafw_media_speak`；legacy SSE/Chat 的 artifact 自动播放对绑定的 duplex chat session 关闭，artifact 仅保留供历史手动回放。
- 若 agent 仍调用 `mafw_media_speak`，不启用第二个自动播放器、不打断当前 runtime TTS；记录 diagnostic。这样取消与播放游标始终只有一个权威，不依赖 60s hash 防双播。
- 非 duplex 会话保持原 artifact 自动播放行为。
- 只有工具调用没有可见文本时，不强行朗读，发送相应状态并继续聆听。

## 12. 播放账本与打断上下文

### 12.1 权威来源

desktop 播放游标是“用户实际听到”的唯一权威。gateway 维护每个语音 segment 的：

```text
turnId / segmentId / spokenText / generatedAudioMs / playedMs / status
```

- 完整播完的 segment：可确定已听到。
- 正在播放的 segment：记录 sentence 级位置与 playedMs。
- 没有文本-音素对齐时，不伪造精确到字符的“已听文本”；句内只能标记估算比例或未知。
- canonical chat 历史保留完整 assistant 文本；voice 专属上下文另记播放说明，不改写文本历史。
- 播放说明通过 §10.3 的**一次性 synthetic text part**附着到下一次 voice prompt，随该 prompt 进入模型上下文；不写入常驻 instruction entries、不注入每次后续回合、不进入 T1/UI/TTS。若用户改用文本继续，则不自动附带，避免陈旧播放状态误导。

打断后的 voice 上下文示例：

```text
上一语音回答在第 3 句中断；前 2 句完整播放，第 3 句仅播放约 800ms。
不要假设用户听到后续未播内容，也不要自动从头重读。
```

### 12.2 真实插话顺序

```text
本地 pause（冻结游标）
→ 判定为真实插话
→ 记录最终 playedMs
→ flush
→ playback.stopped
→ gateway abort 当前 TTS/朗读消费
→ 新 utterance 接管
```

backchannel 则 `playback.resumed`，不取消 response。

## 13. `/ws/voice` 协议扩展

保留 P1 的二进制方向约定。JSON 控制消息扩展为：

### 客户端 → 服务端

- 既有：`hello/config/vad.speech_started/vad.speech_stopped/end_audio/cancel/stop`。
- `playback.progress { turnId, segmentId, playedMs }`：约每 250 ms 及关键状态变化时发送。
- `playback.stopped { turnId, segmentId?, playedMs, reason }`。
- `playback.resumed { turnId, segmentId, playedMs }`。
- `playback.backpressure { state: 'pause'|'resume', bufferedMs }`：控制 gateway TTS iterator，见 §7.4。
- `cancel { turnId?, scope: 'utterance'|'speech'|'response' }`。

### 服务端 → 客户端

- 既有：`ready/routing/asr.partial/asr.final/turn.done/turn.cancelled/error`。
- `turn.started { turnId }`、`agent.queued`、`agent.started`。
- `tts.start { turnId, sampleRate, engine, voice }`。
- `tts.segment.start { turnId, segmentId }` / `tts.segment.done { turnId, segmentId, generatedAudioMs }`。
- `tts.done { turnId }`。
- `approval.required` / `question.required`。
- 所有与 utterance/response/TTS 有关的事件都带 turnId，必要时带 generation。

### 取消语义

- `utterance`：只 abort 当前 ASR stream。
- `speech`：暂停/清空当前音频，允许文本生成继续。
- `response`：停止当前 voice turn 的 TTS 与 delta 消费；若仍在 queue 则取消 queued prompt；不 abort 已开始的 agent/tool。
- v1 没有 `cancel:task`。任务取消仍走既有独立控制与确认语义。

## 14. 权限、提问与会话切换

- `permission.asked`/question 出现时，暂停语音播报，发送 `approval.required` 或 `question.required` 并展示既有卡片。
- 不用语音自动点击、批准或输入秘密；用户处理后按原会话语义继续。
- 切换 chat session 时，旧 voice session 停止消费并清理；在途 TTS 以**发起时 sessionId**中断，不能使用切换后的新 id。新会话通过新的 `voiceSessionId + chatSessionId` 重新 hello，不沿用旧 turn/generation。
- Welcome 没有当前 chat session 时不创建隐藏会话；提示先打开会话。语音入口只在 `chatSessionId` 存在时启用。
- socket 断开不默认 abort 当前 coding 任务；重连后只恢复音频控制，不回放旧 PCM。

## 15. 指标与验收

### 15.1 指标定义

每次 voice turn 记录：

- `speech_start_ms` / 实际声学结束 `acoustic_end_ms`；
- `asr_first_partial_ms` / `asr_final_ms`；
- `turn_decision_ms`（从 acoustic end 到 end_audio）；
- `agent_first_visible_delta_ms`；
- `tts_first_audio_ms`；
- `first_audio_from_acoustic_end_ms`；
- `pause_ms` / `resume_ms` / `flush_ms`；
- `played_ms` / `false_interruption` / `stale_delta_dropped` / `stale_pcm_dropped`；
- engine、routing、queue、cancel reason。

首声指标必须从**实际声学结束**计算；另保留 end_audio→首声作为管线诊断，不能替代端到端体验。

### 15.2 v1 体验门槛

以下是本项目目标，不冒充行业标准：

- 插话到本地 pause：p95 ≤150 ms。
- 首 ASR partial：p50 ≤300 ms；复用现有约 200 ms 实测基础。
- **agent 空闲**：实际说话结束到首段回答音频以 **1–2 秒可接受**为产品口径；不为压到亚秒换引擎。持续超过 3 秒需分段定位，而非隐藏等待。这里测“首段回答音频”，回答质量另由任务成功率评价，不用主观的“有用”代替计时定义。
- **agent 忙**：只要求确定性 queued 状态反馈按上述路径发声；真正回答不计入 1–2 秒门槛，另记 `queue_wait_ms` 与当前任务完成情况。
- backchannel 后可从断点续播；真实插话后无旧 PCM 串播。
- 安静室内与外放 fixture 分别统计误打断；外放误打断目标 ≤5%，不达标不得宣称支持免提全双工。
- 普通插话不调用 session abort；工具副作用不重复、不取消。
- 断线、cancel、切换会话后无迟到 final/delta/PCM 泄漏。

## 16. 测试策略

### 单元

- 协议 schema、turnId/generation、三种 cancel scope。
- TurnController：附和、短噪声、真实插话、决策超时、连续纠正。
- VoiceAgentBridge：idle/busy/queue/coalesce/cancelQueued；不切模型；确定性 busy ack。
- PromptCorrelationService：voice/文本交错、queue flush、多个 assistant steps、提交失败、cancel、runtime 无 turn.started 时 fail closed。
- SpeechProjector：markdown/code/tool/reasoning/synthetic、增量边界、duplex 独占发声与 legacy artifact 自动播放隔离。
- Playback ledger：完整 segment、句中停止、未知对齐、迟到 progress、一次性 synthetic context 的生命周期。
- worklet 与 WS 客户端队列：pause/resume/flush、应用层 backpressure、硬上限、overflow、游标权威。
- sidecar：owned/adopt/不兼容端口/健康失败/树杀/发布包存在性。

### 集成

- Fake ASR + fake agent + fake TTS 的完整 `/ws/voice` golden：
  `partial → final → queued/running → delta → PCM → progress → interrupt → resume/flush → next turn`。
- 断言 response cancel 不调用 runtime session abort。
- 断言 queue 中替换不重复 prompt，已开始任务不重复执行。
- 权限/提问、socket close、session switch、迟到事件。
- desktop VoiceClient 与 preload/IPC 接线；旧 voice API 兼容。

### 真实验收

- 中文、中英混说、代码标识符、长回答、工具执行中插话。
- “嗯/对/继续”、咳嗽、旁人短句、真实纠正“停，不是这个意思”。
- 耳机与扬声器外放；记录音频时间线，不只审查 transcript。
- 同一任务分别比较文本与语音完成结果，防止“聊得顺但任务做错”。

## 17. 实施切片（本设计批准后才进入 writing-plans）

| 切片 | 交付 | 验收 |
|---|---|---|
| A. ASR 产品化 | sidecar adopt/打包、真实 routing、desktop VoiceClient、partial/end_audio | desktop 真麦持续出字；不重开 Mic/VAD；P1 指标可复现 |
| B. 单脑语音闭环 | VoiceAgentBridge、当前 agent、delta→切句→TTS→WS PCM、连续聆听 | 说完约 1–2 秒开始回复；旧媒体 ASR 绕道退出新 flag 路径 |
| C. 对话级双工 | pause/resume/flush、backchannel、播放账本、generation、cancel scope | 附和不误切、真插话即时安静、无旧音频、工具不被误杀 |
| D. 硬化与兼容 | AEC 外放、权限提示、会话切换、发布包、指标与真实 fixture | 通过 §15；旧 TTS/artifact/chat 不回归 |

每切片独立 TDD、独立 commit，并报告新增与全量测试数。不得在一个不可审的大提交里同时重写 ASR、agent、TTS 和桌面。

## 18. 留给 builder 的普通实现选择

以下不改变产品行为，可由实施者按现有代码风格决定：

- 新模块的具体文件拆分、纯函数命名、测试 fixture 组织。
- Smart Turn 的具体调用封装与规则表初始文案，但必须可配置、可测试。
- SentenceChunker 的标点细节，只要不硬切标识符且覆盖增量边界。
- preload/SDK/IPC 的最薄接线方式，遵守 renderer→preload→main/gateway 边界。
- UI 字幕/状态徽标的具体摆放，不要求另起一套聊天界面。

## 19. 明确不在首版承诺内的事项

- 不承诺 Moshi 式模型内生的同时听说。
- 不承诺所有“嗯/旁聊/噪声”都达到商业语义模型水平；v1 用规则 + 实测迭代。
- 不承诺 opencode 能立即 mid-turn steer；busy 时使用真实 queue 语义。
- 不承诺句内字符级播放对齐；没有对齐数据时只报告句级位置与 playedMs。
- 不承诺 400–800 ms 首声；用户已允许 1–2 秒，正确性优先。

## 20. Builder check 的 9 项问题与收敛

builder check 由 fresh reviewer 完成；没有遗留只能由用户回答的技术问题。以下默认由设计者拍板，用户批准本文即一并确认：

1. **忙时口径**：1–2 秒仅约束 agent 空闲；忙时用确定性 queued 提示，真正回答可等当前任务结束。
2. **回合归属**：不猜 assistant，也不禁用文本输入；gateway 用 PromptCorrelationService 统一登记所有 prompt 的 FIFO，并以 canonical turn 生命周期绑定。无 turn.started 的 runtime 不支持 v1。
3. **WS 背压**：采用客户端有界 JS 队列 + `playback.backpressure` 应用层水位，gateway 暂停/恢复 TTS iterator；不采用实时限速推送。
4. **附和判定**：用 ASR partial；backchannel 不 end ASR、不发送 end_audio、不提交 agent。只有真实插话才提交新回合。
5. **文本/语音交错**：保留，经同一 PromptCorrelationService 区分 source；文本回答不朗读。
6. **播放上下文投递**：一次性 synthetic text part，仅随下一次 voice prompt；不进常驻 instructions、T1、UI 或 TTS。
7. **会话绑定**：必须已有打开的 chat session；`voiceSessionId` 与 `chatSessionId` 分离，Welcome 不隐式建会话。
8. **防双播**：duplex 时 VoiceRuntime 独占自动发声；禁止该路径的自动 artifact 播放，`mafw_media_speak` artifact 只供手动回放。
9. **首句与指标**：允许一次性 voice prompt 风格提示（首句短、不要 media_speak）；计时测首段回答音频，任务质量单独评估，不使用模糊“有用”指标。
