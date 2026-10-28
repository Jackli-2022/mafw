# VoiceStudio 语音架构拆解（STT / TTS / 引擎运行时）

> 日期：2026-10-28
> 目的：回答「VoiceStudio 怎么做的」，给 MAFW 端到端语音重构提供可借鉴的架构模式。
> 来源：`debpalash/VoiceStudio` 主分支源码实读（`backend/services/tts_backend.py`、`tts_stream.py`、`asr_backend.py`、`sherpa_dictation.py`、`subprocess_asr.py`、`aec.py`、`engine_routing.py`、`model_catalogue.py`、`openai_compat.py`、`speech_platform.py`）与官方文档。不是凭 README 推测。

## 1. 一句话总结

VoiceStudio 把语音做成**独立的本地 FastAPI 服务**：桌面/移动/agent 都是客户端；TTS/ASR 是「引擎适配器 + 注册表 + 模型目录 + 路由/许可/显存管理」；真正的低延迟流式走 WebSocket 的**逐句合成**，不是让模型做 token 级流式。

## 2. 整体分层

```
Electron / 手机 / Agent
  │  HTTP /v1/audio/*   WS /ws/tts   WS /v1/audio/transcriptions/stream   MCP /mcp
  ▼
FastAPI backend（本地服务，默认 :3900）
  ├─ api/routers/tts_stream.py       逐句 TTS → PCM16 WebSocket
  ├─ api/routers/openai_compat.py    OpenAI 兼容 speech/transcriptions/translations
  ├─ api/routers/speech_platform.py  .well-known 能力发现
  ├─ services/tts_backend.py         TTS 引擎 ABC + 注册表 + 实例缓存
  ├─ services/asr_backend.py         ASR 引擎 ABC（Whisper 系）
  ├─ services/sherpa_dictation.py    实时听写（sherpa-onnx）
  ├─ services/subprocess_asr.py      崩溃隔离 ASR sidecar
  ├─ services/engine_routing.py      设备/显存/路由状态
  ├─ services/model_catalogue.py     YAML 模型目录 + 许可
  ├─ services/aec.py                 服务端回声消除
  └─ services/inference_cancellation.py  可杀 sidecar 的取消语义
```

关键点：**推理在 Python backend，桌面端只负责采集、播放和 UI**。这和 MAFW 的 Node/TS gateway + Electron renderer 不同，但分层方式可以直接借鉴。

## 3. TTS 怎么做的

### 3.1 引擎接口：一个 ABC，所有厂商同形

`backend/services/tts_backend.py` 定义 `TTSBackend(ABC)`：

- 必填：`id`、`display_name`、`sample_rate`、`supported_languages`、`is_available() -> (ok, reason)`。
- 能力声明：`supports_voice_design`、`supports_emotion`、`instruct_vocabulary`（`tags` / `freeform`）、`inline_tags`（`[laughter]` / `[breath]`）、`instruct_directs_delivery`、`gpu_compat`、`min_vram_gb`、`runs_out_of_process`。
- 生成：`generate(text, *, ref_audio, ref_text, instruct, language, duration, description, num_step, guidance_scale, speed, **extras) -> torch.Tensor`；`generate_batch()` 默认逐条调用。
- 生命周期：`ensure_ready()` 把「加载模型」和「生成」分开计时；`unload()` 释放显存。
- 语言强制：基类 `_check_language()` 在统一位置拒绝引擎不支持的语言，而不是每个适配器自己判断。
- 许可：`ensure_engine_licence(cls)` 在切引擎前检查模型许可，避免「切到未接受许可的引擎把正在工作的引擎卸掉」。
- 自动租约：`__init_subclass__` 把 `generate` / `generate_batch` / `_ensure_loaded` / `convert_voice` 包上 `_lease_render`，保证渲染期间引擎不被 idle sweeper 卸载，并把地区变体（如 `pt-PT`）归一成基础语言。

这是一套**能力真实、生命周期内置、语言/许可集中强制**的接口，比 MAFW 现有 `TtsEngine` 只声明 `streaming/voiceCloning/styleControl/languages/sampleRate` 更完整。

### 3.2 注册表与实例缓存

- `_REGISTRY` 按 engine id 注册；`get_backend_class()` 解析；`list_backends()` 输出每个引擎的 `available/reason/routing_status/effective_device/isolation_mode/supports_cloning/preset_voices/max_ref_seconds/ref_strategy` 等。
- `_ENGINE_INSTANCES` 按 class 缓存实例；`_ENGINE_LAST_USED` 用 monotonic clock；`_ENGINE_IN_USE` 计数防止「长任务看起来像 idle」；`_RETIRED_ENGINES` 延迟卸载。
- `get_active_tts_backend()` 切引擎时先 `unload()` 旧实例；`evict_other_tts_engines()` 在每次生成前把其他常驻 TTS 引擎卸掉（单引擎常驻纪律）。
- `release_idle_engines()` 按 idle 时间回收。

这套缓存/驱逐逻辑是 MAFW 目前没有的：MAFW 只做 `registry.resolve()`，没有实例级显存生命周期。

### 3.3 真正的流式：逐句合成 + WebSocket

`api/routers/tts_stream.py` 的 `/ws/tts`：

1. 接收 JSON `{text, voice, language, speed, instruct, engine, emo_*}`。
2. `_resolve_stream_backend(engine)` 选引擎；先查许可；再查设备路由。
3. `engine_in_use(backend)` 租约 + `evict_other_tts_engines()`。
4. `split_stream_sentences(text, language)`：
   - `normalize_for_tts()` 对整个文本只做一次归一化；
   - `SentenceChunker` 按中英标点、缩写、小数、CJK/阿拉伯/天城文终止符切句；
   - 第一句先合成，后续句子并行/继续排队，实现「首句先出声」。
5. 每句 `backend.generate()` 在 GPU pool 上跑，`run_on_gpu_pool_guarded()` 带长度缩放超时，避免卡死 GPU。
6. 每句后处理：`apply_mastering()`（引擎可 opt-out）、`normalize_audio(-2 dBFS)`、`mark_synthetic()` 水印。
7. 转 PCM16，按 4800 samples（24 kHz 下 200 ms）通过 `send_bytes()` 推给客户端；首块发出时记录 TTFA。
8. 结束发 JSON `{type:"done", duration_s, gen_time_s, ttfa_ms, rtf, samples, sample_rate, engine}`；错误发 `{type:"error", detail, code?, models?}`。

**重要区分**：`/v1/audio/speech` 的 `stream_format: "audio" | "sse"` 只是把**已经生成好的整段音频**分块/SSE 返回；真正的低延迟路径是 `/ws/tts` 的逐句合成。两者不要混为一谈。

### 3.4 文本/音频后处理

- `services/text_normalization.py`：数字→词、缩写、垃圾字符清理；`/generate`、`/ws/tts`、`/v1/audio/speech` 共用，且只归一化一次。
- `services/chunked_tts.py`：长文本按句/从句切块，CJK 按 2.5 倍语音密度缩小 chunk；`[tag]` 内不切；跨块 50 ms crossfade；空块会报告而不是静默丢句。
- `services/audio_dsp.py`：mastering / normalize / 水印；`watermark.py` 用 AudioSeal 类方案，流式也逐句打标。
- `services/sentence_chunker.py`：增量句切分，支持流式输入。

## 4. ASR 怎么做的

### 4.1 两条线：批处理 Whisper 系 + 实时 sherpa 听写

**批处理线**（`services/asr_backend.py`）：

- `ASRBackend(ABC)`：`is_available()`、`transcribe(audio_path, word_timestamps=True) -> dict`、`ensure_loaded()`、`unload()`、`supports_translation()`、`gpu_compat`。
- 实现：FasterWhisperBackend、MLXWhisperBackend、PyTorchWhisperBackend；WhisperX 负责 word-level forced alignment。
- 返回原始 Whisper dict，`services/segmentation.segment_transcript()` 统一消费；新引擎只要输出同形状即可接入。
- 超时：`ASR_TRANSCRIBE_TIMEOUT_S` 默认 300 s；超时后重置 pool / 标记 wedge；`run_transcribe_guarded()` 统一包装。
- 崩溃隔离：`services/subprocess_asr.py` 的 `SubprocessASRBackend` 复用 `SubprocessBackend` 的 spawn/ready/长度前缀 JSON/GPU slot/死进程重启协议；`IsolatedFasterWhisperBackend` 把 CTranslate2 的 GPU teardown segfault 变成「子进程失败」而不是整个 backend 崩溃。
- Sidecar：`backend/engines/_asr_sidecar/main.py` 是独立 Python 进程，读长度前缀 JSON，执行 `transcribe`，返回结果；父进程负责重启和超时。

**实时线**（`services/sherpa_dictation.py`）：

- 7 个模型：Parakeet TDT v2/v3（离线）、Zipformer bilingual zh-en（流式）、Paraformer bilingual zh-en（流式）、Zipformer EN 20M、Zipformer ZH 14M、Whisper Tiny（离线）。
- `OnlineRecognizer`（Zipformer/Paraformer）真流式：逐帧 partial，sherpa 内置 endpoint 检测；endpoint 规则默认 `rule1=1.0s`、`rule2=0.6s`、`rule3=20s`，可通过环境变量调。
- `OfflineRecognizer`（Parakeet/Whisper）没有真流式：用 VAD/增长 buffer 定期重转写，EOF/静音时 final。
- CPU-only 默认（`provider=cpu`，2 线程，重模型 4 线程），严格跨平台一致；GPU 需显式覆盖。
- 空转写自愈：模型能装能加载但返回空 token 时，标记为 `demoted`，不再自动选它。
- 模型文件走 HF cache，文件名逐项 pin，安装时按实测大小显示；不靠估算。

### 4.2 流式协议

`/.well-known/voicestudio-speech` 声明 `voicestudio.speech.v1`：

- 输入：WebM/Opus 或 PCM16 16 kHz，`?pcm=1&sr=16000`；结束控制 `{"type":"input_audio.end"}`。
- 输出事件：`session.started`、`status`、`partial`、`final`；`final_kind` 有 `utterance`（流式模型的句子级 final）和 `summary`（整段会话 final）。
- 同一个 WS 会话可以多次 utterance；`/ws/transcribe` 保留旧帧 + `EOF`。
- 批量：`POST /v1/audio/transcriptions`（OpenAI 兼容，json/text/verbose_json/srt/vtt）；翻译：`/v1/audio/translations`（Whisper 系多语种）。
- MCP：`transcribe` 工具 + `/mcp` Streamable HTTP / stdio shim。

### 4.3 AEC：服务端 NLMS，而不是只靠浏览器

`services/aec.py` 的 `NlmsEchoCanceller`：

- 16 kHz mono NLMS 自适应滤波器，512 taps（32 ms），Geigel double-talk detector（ρ=0.6），warm-up 0.5 s，leakage 0.9999。
- 每个 `/ws/transcribe` 会话一个实例；`push_far_end()` 喂即将播放的 PCM，`process_near_end()` 清洗麦克风 PCM 后再进 ASR。
- 动机写得很直接：浏览器 `echoCancellation:true` 的质量/可用性因平台而异，会导致「默认功能在不同平台行为不同」；服务端 AEC 跨平台一致。
- 官方也承认它不是生产级 DSP（WebRTC AEC3/Speex 才是），是 dependency-free 的「够用」方案。

## 5. 模型目录、许可、路由

### 5.1 模型目录是数据，不是代码

`backend/config/models.yaml` + `services/model_catalogue.py`：

- 每个条目：`id` / `repo_id` / `label` / `license` / `languages` / `size` / `files` / `requires` / `recommended` 等。
- `model_key()` 支持 `<repo_id>:<package>` 共享 repo 的多包条目。
- `model_manager.py` 负责下载、缓存、加载、超时、GPU pool；`model_licenses.py` / `model_acceptance.py` 负责许可接受与拒绝；`engine_disk_usage` 报告磁盘。
- 许可不是 README 装饰：`ensure_engine_licence()` 在切引擎/生成前拒绝未接受许可的模型；错误会带 `code` + `models` 让客户端弹接受框。

### 5.2 路由：不允许静默 CPU fallback

`services/engine_routing.py` 的 `resolve_routing()` 返回四态：

- `accelerated`：主机加速器在引擎 `gpu_compat` 内。
- `cpu_fallback`：主机有 GPU，但引擎没有对应 path，只能 CPU；**必须显式告知**（HTTP header 或 WS `routing` 帧）。
- `cpu_only`：引擎只声明 CPU，或主机本来就没有 GPU；中性，不告警。
- `unavailable`：引擎需要加速器且没有 CPU path；直接拒绝，不偷偷跑。

这套状态机解决了「绿色 GPU 徽标 + 实际 CPU 速度」的静默降级问题，比 MAFW 现在的 `fail-open 回退 mimo + warn` 更诚实。

## 6. 对 MAFW 的借鉴

### 应该借的

1. **引擎 ABC 的能力契约**：`AsrEngine` / `TtsEngine` 都要有 `is_available`、`languages`、`sample_rate`、`streaming`、`supports_*`、`gpu_compat`、`min_vram_gb`、`runs_out_of_process`；语言/许可/生命周期在基类集中强制。
2. **路由层做流式，不在引擎里假装流式**：引擎返回整段 tensor/WAV；route 做归一化 → 句切分 → 逐句合成 → PCM 分块。首句优先，TTFA/RTF 进日志和 done 帧。
3. **单引擎常驻 + 实例缓存 + idle 驱逐**：MAFW 目前没有显存生命周期；重模型必须可卸载，长任务用 in-use 计数保护。
4. **模型目录数据化 + 许可门**：把 `models.yaml` 当作单一事实源；许可拒绝要能到 UI，而不是只在日志。
5. **崩溃隔离**：ASR 的 native/GPU teardown 容易 segfault；用子进程 + 长度前缀 JSON + 死进程重启，复用 MAFW 现有 sidecar 生命周期。
6. **显式路由状态**：`accelerated / cpu_fallback / cpu_only / unavailable`，前端能显示「当前在 CPU 上跑」。
7. **AEC 做进服务端或至少做可选后端**：不能只依赖 `getUserMedia({echoCancellation:true})`；外放场景需要 NLMS/WebRTC AEC。
8. **OpenAI 兼容 + WS + MCP + `.well-known` 四件套**：外部 agent 接入成本最低；内部仍用统一音频接口，厂商适配器隔离。

### 不要照搬的

1. **Python/FastAPI 技术栈**：MAFW gateway 是 Node/TS；借模式，不借代码。
2. **21 个引擎的复杂度**：VoiceStudio 的引擎矩阵是产品卖点，MAFW 先做 3–4 个（iGPU 2 个 + dGPU 1–2 个 + 云端 1–2 个）即可。
3. **Whisper 系 ASR 作为默认**：VoiceStudio 默认 WhisperX/Faster-Whisper；中文场景我们调研推荐 Zipformer + Qwen3-ASR，不应该为了「和 VoiceStudio 一样」而选 Whisper。
4. **把 `/v1/audio/speech` 的 `stream_format` 当真实时**：它只是整段音频分块；真实时要用 `/ws/tts` 式逐句流。
5. **它的 NLMS AEC 当生产级**：官方自己说不是 WebRTC AEC3；外放/远场要评估更强方案。
6. **它的单句 chunk 大小直接照搬**：VoiceStudio 默认 800 字符（CJK 缩到 ~320），适合长文；连续对话首句应更短（10–20 字），否则首包仍然慢。

## 7. 关键源码索引

| 主题 | 文件 |
|---|---|
| TTS 引擎 ABC / 注册表 / 生命周期 | `backend/services/tts_backend.py` |
| TTS WebSocket 逐句流 | `backend/api/routers/tts_stream.py` |
| 长文本切块 / crossfade | `backend/services/chunked_tts.py` |
| 句子切分 | `backend/services/sentence_chunker.py` |
| 文本归一化 | `backend/services/text_normalization.py` |
| ASR 引擎 ABC / Whisper 系 | `backend/services/asr_backend.py` |
| 实时 sherpa 听写 | `backend/services/sherpa_dictation.py` |
| ASR 子进程隔离 | `backend/services/subprocess_asr.py`、`backend/engines/_asr_sidecar/main.py` |
| 服务端 AEC | `backend/services/aec.py` |
| 设备路由 | `backend/services/engine_routing.py` |
| 模型目录 / 许可 | `backend/services/model_catalogue.py`、`backend/config/models.yaml` |
| OpenAI 兼容 | `backend/api/routers/openai_compat.py` |
| 能力发现 | `backend/api/routers/speech_platform.py` |
| 项目结构 | `docs/STRUCTURE.md` |
