# MOSS-Live 实时双全工语音调研 + xiaomi TTS「极速乱读」根因实测

- 日期：2026-11-03
- 触发问题：调研 MOSS-Live 的实时双全工语音怎么做的；同时 xiaomi（MiMo-V2.5-TTS）语音播报"一会儿就开始极速乱读"。
- 结论先行：
  1. **MAFW 桌面端"极速乱读"不是小米服务的锅，是自家 worklet 播放器的缓冲溢出 bug**——实测小米流式 TTS 以 ~5x 实时速率吐音频，`pcm-worklet.js` 的 30s 环形缓冲"满了丢弃"，长播报 ~7.2s 后开始丢帧（实测 98s 音频被丢 49.3%），听感即"时间压缩 + 爆音跳读"。修复 = 播放端背压（读 SSE 暂停在 high-water 之下）。
  2. MOSS-Live 的双全工 = **模型内语义 turn-taking + 连续音频流 + 播放确认回环**，客户端不上 VAD 判停、不判打断；协议上通过 `playback.chunk.completed` / `playback.stopped(played_audio_ms)` 让服务端知道"用户实际听到了哪"，这是与 MAFW 现管线最大的架构差异。

## 1. MOSS-Live 系统架构（官方发布）

来源：机器之心 2026-11-02 发布稿（sohu/163 转载）、模思智能官网、platform.moss.cn。

- **前后台协同架构**：前台交互模型持续接收语音/画面/环境声，跟踪对话状态，决定何时倾听/回应/等待/接受打断；后台模型负责复杂推理与长程任务，前台把任务+上下文异步移交，不暂停对话，结果返回后主动反馈。前后台通过记忆、上下文与任务状态管理协同。→ 与 MAFW「语音前台 + goal/pod 后台」形态同构。
- **语义判停取代静音判停**：不用"静音 N 秒=说完了"的机械规则；模型结合语义与对话状态判断继续说/沉默/接受打断/忽略无关声音（导航音、他人附和）。
- **主动交互**：用户可设规则（背错时纠正、会议留意特定事项），满足条件主动开口。
- **流式同声传译**：持续收源语言语音、实时出目标语言。
- Benchmark（对比 GPT Realtime 2.1 / GPT-Live-1 / Doubao SeedDuplex / Qwen Audio 3.0，FDB v1/v1.5/v2/v3 + τ-Voice）：
  - 停顿抢话率（不含附和）1.44%（对手 3.83–14.29%）
  - 无关语音误接话 2.00%（对手 68–88%）；无关打断拒识率 68% 最高
  - 附和抗干扰 98.17%、口头禅 82.16%、无关语音 78.90% 均第一
  - 打断后回答质量 4.88/5 第一；工具调用成功率 FDB v3 51% 并列最高
- API：`wss://api.mosi.cn/v1/realtime?model=moss-live-1.0`，限时免费（2026-11 发布期）。浏览器原生 WebSocket 不能设 Authorization 头，需服务端代理。

## 2. MOSS-Live WSS 双工协议（怎么落地的）

来源：platform.moss.cn/en/docs/reference/moss-live（2026-11-03 抓取）。

**连接与会话**：
- 握手后 `attach_session`（新会话省略 session_id；重连传原 session_id + 同 user；`memory_scope: session|user`——user 级跨会话共享长期记忆，租户内按 user 隔离）→ `session.update`（persona.name/aliases/prompt ≤8000 字 + instructions；**turn-taking/打断/工具规则是模型内置，不随这些字段替换**）。
- 按在线时长计费（session_attached 起）。

**上行（客户端 → 服务端，同一 WebSocket，JSON 控制 + 二进制媒体混跑）**：
- 音频：**16kHz mono PCM S16LE 裸流，每 20ms 640 字节**，无 WAV 头；开 tagged-v1 后加 `0x00` 前缀（641 字节/20ms，关视频后前缀保留）。
- **停说话后继续发静音**——没有客户端 VAD 门控，音频是连续不断的。
- 视频/屏幕共享：JPEG 帧二进制（camera `0x01` / screen `0x02`），一帧一条消息；默认 1 FPS、质量 0.8、camera 长边 640px / screen 1024px；**高负载服务端丢旧帧只保最新**（不保证逐帧分析）。
- `mic_state` 开关麦、`video.state` 开关帧源、`video.stream_focus` 选主源（camera/screen/auto）。

**下行（服务端 → 客户端）**：
- `input.transcript.updated/done`（用户转写，**全量替换非追加**）、`output.transcript.updated/done`（模型回答文本，带 run_id/turn_id）。
- `response.audio.context`（先发 chunk 上下文：chunk_id/run_id/turn_id）→ 紧跟 **48kHz mono PCM S16LE 二进制**，按序与 context 配对。
- `response.audio.stop`：服务端要求停播（被打断时）；客户端停播后回 `playback.stopped { played_audio_ms }`。
- `response.interrupted`：按 run_id/turn_id 标记该回答被打断，附打断瞬间的文本。
- `response.ended`：turn 终态 completed/aborted/failed，**会话可继续**。

**播放确认回环（协议精髓）**：
- 每个音频块**真正播完**后客户端回 `playback.chunk.completed { chunk_id, run_id, turn_id }`；整轮播完回 `playback.completed`；被打断停播回 `playback.stopped { played_audio_ms }`。
- → 服务端因此知道**用户实际听到了哪一句**，打断后模型从"听到一半的地方"继续，这是"打断后回答质量 4.88/5"的协议基础。文档明确："Acknowledge only audio that has actually finished playing"。

**对 MAFW 的启示**：
1. **判停/打断的决策权在模型侧**，客户端只管连续推流（含静音）+ 播放 + 回 ack。MAFW 现在是客户端 Silero VAD 判停/判 barge-in——对"附和/停顿思考/导航音"的误判率天然高于语义判停（这正是 MOSS 抢话率 1.44% vs 其他 3.8-14.3% 的差距来源）。
2. **播放位置回环**：MAFW barge-in 只在本地 flush + gateway abort TTS，agent 不知道用户听到了哪；补一个 played_audio_ms 上行就能让续话模型从断点续。
3. 上行 16k / 下行 48k 分离；视频走同一条 WS 的 tagged 二进制（对比 OpenAI Realtime 的 base64 JSON 事件，二进制省 33% 带宽且免编解码）。

## 3. MOSS-TTS 家族（可替换引擎盘点）

来源：github.com/OpenMOSS/MOSS-TTS、MOSS-TTS-Nano README、HF model cards、LMSYS/SGLang-Omni 博客。

| 模型 | 参数 | 定位 | 对 MAFW 的适用性 |
|---|---|---|---|
| MOSS-TTS-Realtime | 1.7B | 面向语音 agent 的流式 TTS，条件于多轮对话历史（文本+先前用户声学），音色跨轮一致 | **替换 xiaomi 云引擎的首选**（同为"对话式流式 TTS"） |
| MOSS-TTS-Local-Transformer | 1.7B | 轻量版旗舰；SGLang-Omni 提供 OpenAI 兼容 `/v1/audio/speech` + 流式 | 自托管选项；时长控制 `${token:150}`、`[pause 0.5s]` 标记 |
| MOSS-TTS-Nano | 0.1B | CPU 实时（4 核）、ONNX、48kHz 立体声、20 语种、克隆；100ms 出声 | 离线兜底引擎（对标 kokoro，质量更新） |
| MOSS-TTSD v1.0 | 8B | 高表现力多人对话生成 | 长对话配音场景，非实时链路 |
| 平台 API | - | `api.mosi.cn/v1/audio/speech`（moss-tts-1.5-flash 等，voice_id 体系，mp3/url） | 云端 API 替换（注意 delivery_method=url 是异步任务式） |

统一底座：MOSS-Audio-Tokenizer（因果 Transformer 无 CNN，48kHz 立体声，12.5Hz token，RVQ 16 码本，0.125-2kbps）。家族 Apache-2.0 开源（Nano 3 天 star 破千）。

## 4. xiaomi TTS「极速乱读」根因实测（本仓库 bug，已实锤）

### 4.1 症状与链路

桌面语音播报长文本：开头正常，"一会儿"（约 7-30s）后变成极速乱读。链路：xiaimo SSE (`delta.audio.data` base64 pcm16 24kHz) → gateway `/api/tts/stream` SSE → desktop `session.ts` atob + `alignPcmChunks`（2 字节对齐）→ `pcm-worklet.js` 环形缓冲播放。

### 4.2 排除项（实测）

探针脚本（见下）直连 `api.xiaomimimo.com/v1/chat/completions`（mimo-v2.5-tts，pcm16 流式，600 字中文）：

- **base64 分块碎片假设：排除**。307 个 chunk 长度 %4 全为 0；逐块解码字节总和 == 整串拼接解码（4,723,200 字节，差 0）。`mimo-engine.ts` 逐块 `Buffer.from(b64)` 解码安全。
- 桌面 `alignPcmChunks` 的半样本对齐链路正确（有单测钉扎）。

### 4.3 根因：环形缓冲溢出丢帧

- **实测生成速率 4.96x 实时**（98.4s 音频 19.8s 生成完；首块 1.09s）。
- `pcm-worklet.js`：`capacity = sampleRate * 30`（30s），feed 循环 `if (this.buffered >= this.capacity) break`——**满了静默丢弃**，注释断言"30s 不可能吃满"，被 4.96x 速率证伪。
- 模拟 1x 播放 + 30s 环形缓冲：**49.3% 帧被丢弃，首次丢弃在流开始后 7.2s**（= 30s ÷ (4.96−1) ≈ 7.6s，与实测吻合）。
- 听感机理：丢约一半 PCM 帧 → 时间压缩 ~2x + 每个丢弃点爆音 → "极速乱读"；短句（音频 <30s）缓冲吃不满 → 正常，故症状呈"一会儿才开始"。

### 4.4 修复（已实施 2026-11-03）

- **正解：播放端背压**。`session.ts` 读 SSE 循环里，当本地已投喂未播完的帧数超过 high-water（12s）就暂停 `reader.read()`，播掉降到 low-water（4s）再继续。TCP/SSE 天然背压，服务端 4.96x 也无害。worklet 的丢弃分支退化为最后防线（现在会上报 `overflow` 事件 + console.warn，不再静默）。
- 不建议只调大 capacity（2000 字上限 ≈ 4-8 分钟音频，任何有限容量都会满）。
- gateway 侧节流 SSE 可行但加无谓延迟，客户端背压是流式播放器的标准做法。
- 落地：`packages/desktop/src/renderer/mafw/voice/backpressure.ts`（水位纯函数）+ `session.ts` 读流闸门 + `pcm-worklet.js` 溢出上报；测试 `backpressure.test.ts`（4）+ `session.test.ts` 背压集成（1）。同批修了 native 流式引擎长文本无切句（>2000 字整条播不出）——`gateway/src/tts/sentence-adapter.ts` 新增 `streamSentences()`。

### 4.5 探针脚本

`C:\Users\15524\AppData\Local\Temp\opencode\tts-probe.mjs`（临时；要点：直连小米流式端点，统计 chunk %4 分布、逐块 vs 整串解码字节差、生成速率、环形缓冲模拟丢帧率与首丢时刻）。

## 5. 后续可选动作（供决策）

1. ~~修 worklet 背压~~（§4.4，已实施 2026-11-03）。
2. TTS 引擎替换实验：MOSS-TTS-Realtime（自托管/vLLM-Omni）或 moss-tts-1.5-flash 云 API，接入现有 `TtsEngineRegistry` 插件形态。
3. 语音链路对标 MOSS-Live 的两个协议特性：播放进度回环（played_audio_ms 上行）、语义判停（需要端到端 realtime 模型，非拼装管线能获得——远期）。
