# MAFW 语音管道

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

### 语音管道（Voice Pipeline，2026-09-17 重构）

**Desktop 核心（`packages/desktop/src/renderer/mafw/voice/`，UI 无关纯 TS）**：
- **VadAnalyzer**（`silero.ts`）：Silero VAD v5 单实例 + 单 getUserMedia 流（echoCancellation/noiseSuppression/autoGainControl），事件 hub 多播 `speech_started/speech_stopped/misfire`——不再有 monitor/recording 模式切换；参数 `media.tts.vad.*`（confidence 0.5/stopSecs 1.2/minSpeechMs 500）可配，fail-open 默认值；`?url` 资产导入带 typeof 守卫（node --test 经 test-shim loader 可导入）
- **TurnStopStrategy**（`turn.ts`）：轮次边界与 VAD 分层（Pipecat 模式）；v1 `SilenceTimeoutStrategy` 直通（静音宽限已由 Silero redemptionMs 在引擎内），未来语义 turn detector 挂此接口
- **AudioWorkletPlayer**（`worklet-player.ts` + `public/voice/pcm-worklet.js`）：环形缓冲流式 PCM 播放，起步缓冲 200ms 抗抖动，`flush()` = 清缓冲即时静音（barge-in），`playCursorMs` 播放游标（v1 仅日志）；采样率取 SSE `x-tts-sample-rate` 响应头（不再硬编码 24kHz）；**无 BufferSource 回退**（Electron Chromium 必有 AudioWorklet，显式报错）
- **VoiceSession**（`session.ts`）：桌面语音唯一入口，显式状态机 `idle|recording|speaking|interrupted`；VAD 信号按状态路由（recording→分段/ speaking→barge-in）；barge-in = flush + `POST /api/tts/interrupt`（fire-and-forget）+ 状态 interrupted；`speakFromTool` djb2 hash TTL 去重（与 gateway media-speak 工具同实现）；`playUrl` artifact 短播放也走会话（互斥/barge-in 一致）；`speak` 流式失败回退整段 wav（barge-in abort 不回退）；ChatPane 只留绑定层（事件→UI 信号、segment→upload helper）

**Gateway TTS 插件化（`gateway/src/tts/`）**：
- **TtsEngine** 接口：`capabilities { streaming: 'native'|'none', voiceCloning, styleControl, languages, sampleRate }` + `synthesizeStream → AsyncIterable<PcmChunk>`（采样率随块走，不强写 24k）+ `synthesize → wav Buffer`（兜底）+ `TtsOpts { voice/style/speed/lang/refAudio? }`（refAudio 克隆预留）
- **TtsEngineRegistry**：优先级 包 > legacy（`~/.mafw/tts-plugins/*.js`）> 内置；未知名 fail-open 回退 mimo + warn
- **内置引擎**：`mimo`（MiMo-V2.5-TTS 云，native 流式，默认）；`kokoro`（kokoro-js 进程内 ONNX，Apache 2.0 含权重，optional dependency 不强装，模型 ~90MB 按需下载到 `~/.mafw/models/kokoro/`，`streaming:'none'`，ESM 桥 `new Function('spec','return import(spec)')`，加载失败 promise 缓存复位可重试）
- **句切分适配层**（`sentence-adapter.ts`）：`streaming:'none'` 引擎按句 synthesize 立即 yield，统一流式语义（中英标点切分 + 100 字符硬切）
- **插件接口**（legacy 形态）：`module.exports = { name, capabilities?, voices(), synthesize(text,opts,ctx)→wav Buffer, synthesizeStream? }`；统一插件包新增 `tts` 贡献类型（`TtsContributionSpec`，PluginHost bindTts 原子推送）
- **打断传播**：`POST /api/tts/interrupt { sessionId }` → abort 该 session 全部在途合成（`ttsInflight` Map 登记，stream 路由 close 时清理）；`/api/tts/stream` body 新增可选 `sessionId`，响应头带 `x-tts-sample-rate`
- **许可红线**（内置只从安全档选）：ChatTTS/F5-TTS/Fish S2（非商用/研究许可）、IndexTTS（商用需授权）、edge-tts（微软 ToS）、Piper（GPL）**不内置**，仅可作用户自装插件；CosyVoice/GPT-SoVITS 等经 tts-plugins 接入
- 测试：gateway jest 27 个 TTS 单测（registry/adapter/mimo/interrupt/loader/kokoro）；desktop 12 个 voice 单测（turn/silero hub/pcm-align/session 状态机）

- **句切分同源化（2026-11-03）**：`streamSentences()` 统一流式入口——native 引擎也按句串流（此前整段直发，>2000 字触发引擎文本上限、长回复整条播不出；切句后单次请求受控且首句即出声）；`/api/tts/stream` 统一走该入口
- **播放端背压（2026-11-03，修「极速乱读」）**：`voice/backpressure.ts` 水位（high 12s / low 4s / 250ms 轮询）+ `session.ts` 读 SSE 闸门——已投喂未播放超 high 暂停 `reader.read()`（流/TCP 蓄水一帧不丢），降到 low 恢复。实测小米流式 TTS 4.96x 实时吐音频，旧 worklet「满了静默丢弃」令 ~7.2s 后丢 ~49% 帧（时间压缩+爆音）；溢出现在上报 `overflow` + `console.warn`。调研：`docs/research/2026-11-03-moss-live-duplex-research.md`
- **Duplex ASR Plan 1（2026-11-03）**：`voice.duplexV1` 默认关；桌面 PTT 经 `/ws/voice` 持续发 16k PCM16、显示 partial/final；sidecar 支持 adopt；LLM/TTS 闭环不在本切片。
- **Voice Plan 2 语音回路（2026-11-04，spec `docs/superpowers/specs/2026-11-04-voice-plan2-voice-loop-design.md`，research `docs/research/2026-11-04-voice-plan2-loop-research.md`）**：desktop 渲染层 only（gateway/SDK 零改动）。① final → 输入栏：`useDuplexVoice` 新增 `onFinal` dep（每非空 final 恰一次，generation guard；空白 final 整体跳过）→ ChatPane 的 `duplex-auto-send.ts` 控制器追加进 composer（多段 `\n` 累积）。② 自动发送：final 后 1200ms 静默窗（`VOICE_AUTO_SEND_DELAY_MS`），取消条件 = 新 partial / 手动敲键盘 / 停止 / TTS 播放开始；`voice.duplexAutoSend`（缺省 **true**，`window.api.mafw.config.get` 读取，fail-open true；false = 只填输入栏）。③ 语音来源标记 `[语音输入]`（`voice-origin-marker.ts`，单行行首契约）：空闲路径 = `sendEnriched` parts 追加 synthetic part（「首个非 synthetic text part」展示规则保证气泡三阶段干净）；忙时 steer/网关队列 = 内联进 message（`busyQueuedText`，队列条经 `queueItemText` 剥离）；本地队列 = `QueuedTurn.voiceOrigin` flag，flushQueue 重放恢复。slash 命令与 Tech Lead 发送不标记。④ 语音回复：标记指令要求 agent 简短口语化回答并调 `mafw_media_speak`——完全复用既有 marker→自动播放 effect→AudioReply 卡链（零新增播放机制，双播红线不动）；agent 不调用时兜底 = 手动 Speak。**自动播放门槛（2026-11-04 修复）**：只有本面板正在跑的回合（`sending()===true`）才自动出声——进入会话加载的历史回复不再重播（此前仅靠 `playedVoiceArtifacts` 内存 Set + 60s hash，应用重启后会把历史语音当新回复重播）；`playUrl` 不再为 barge-in 启动 VAD（artifact 是 agent 自己的语音，外放自听会 speech_started → 自切，用户只能听到前几秒）；流式 `speak()` 的 barge-in 语义保留。⑤ 回声防线（硬性）：`ttsSpeaking` 期间 ASR final 丢弃（AEC 已开但外放不完美，防自言自语环）；⑥ 停止 duplex 唯一路径 `stopDuplexVoice()` = 停收音 + `stopActivePlayback()` + 取消挂起发送（文本保留）。**deferred minors 收口（2026-11-04）**：`onFinal` 经 `relayFinalToAutoSend` 显式转接（控制器依赖 sendMessage，消除前置引用）；`resolveDuplexAutoSend` 纯函数 + `duplexAutoSendEnabled` signal（解析完成前不自动发送，关闭启动竞态）；`insertQuote`/输入历史召回也调 `handleManualInput()`；`clearFinal()` 自动发送后清字幕条；`suppressTranscript`（TTS 播放期间 partial/final 都不进字幕）；`voice.duplexAutoSend:false` 真机验证（final 只填输入栏、3s 不发送、无 pending 提示）。诚实边界：语音回复延迟 = agent 全文 + 一次工具往返（秒级）；1–2s 首声属 v1 spec 切片 B（runtime 驱动 delta TTS），届时指令改为「不调用 mafw_media_speak」。desktop 2791/2791、tsgo/build rc=0。
