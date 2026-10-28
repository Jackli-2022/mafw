# 语音模型选型调研（STT / TTS / VAD / Turn）

> 日期：2026-10-28
> 范围：MAFW 连续语音对话（按下麦克风进入、可打断、连续多轮），本地/云端可切换，核显也能跑。
> 性质：纯调研，不写产品代码。许可证结论以仓库 LICENSE 实读为准；性能数字标注来源，未实测的明确写「unverified」。

## 0. 结论先行

### 推荐组合

| 档位 | ASR | TTS | 端点/轮次 | 集成方式 |
|---|---|---|---|---|
| **核显 / CPU（默认本地档）** | **sherpa-onnx streaming Zipformer bilingual zh-en int8**（真流式 partial）+ **Qwen3-ASR-0.6B int8** 终稿二次解码（离线，高准确） | **Kokoro multi-lang v1.1 zh_en**（103 音色，质量优先）；弱核显可退 **MeloTTS zh_en**（163 MB，速度优先） | **Silero VAD** + **Smart Turn v3.2** | `sherpa-onnx-node` 单依赖，进程内 N-API，Windows x64 免编译；`@micdrop/smart-turn` |
| **独显（RTX 4090 Laptop 16G）** | **Qwen3-ASR-1.7B via vLLM**（中文/方言最强，真流式）；备选 Fun-ASR-Nano via vLLM | **CosyVoice3-0.5B**（150 ms 双流式，中文 CER/SS 最好）；备选 **Qwen3-TTS-0.6B**（97 ms，3 秒克隆） | 同上 | Python/vLLM sidecar，HTTP/WS；复用现有 sidecar 生命周期 |
| **云端** | **阿里 Qwen3-ASR-Flash Realtime**（中文/方言、WS 实时，约 $0.0028/min）；备选火山 Doubao ASR 2.0 | **MiniMax Speech-02 Turbo**（中文原生、10 秒克隆，约 $0.06/1k 字符）；备选火山 Doubao TTS 2.0 / Azure Neural | 本地 Silero 负责即时打断，云端 endpoint 只作第二信号 | 内部统一 OpenAI 形状的音频接口，厂商适配器隔离 |

### 关键结论

1. **MiMo ASR 不能做实时对话**：当前接入是「整段 base64 上传 + SSE 文本」，没有音频 partial。它可以做离线/语音消息转写，但不能承担连续对话的 ASR。MiMo TTS 可以继续作为云端 TTS 候选（免费/促销期，SSE PCM 流式）。
2. **核显档的关键不是「找一个小模型」，而是「真流式 + 二次解码」**：Zipformer 负责低延迟 partial 和端点，Qwen3-ASR-0.6B 或 Fun-ASR-Nano 在回合结束后做一次高准确终稿。两者都在 CPU 上可跑，且 `sherpa-onnx-node` 一个依赖全包。
3. **TTS 核显档只有句级合成，没有原生 token 级流式**：Kokoro / MeloTTS / VITS 都是 utterance-level，靠句切分降低首包。CosyVoice3 / Qwen3-TTS 才是原生流式，但需要 GPU + Python sidecar。
4. **Smart Turn 只解决「说完了没有」，不解决「被打断」**：barge-in 必须由 Silero VAD 在播放期间持续监听，且必须有 AEC；否则 TTS 会触发自己的 VAD。
5. **许可证安全档**：Kokoro / MeloTTS / CosyVoice3 / Qwen3-ASR / Qwen3-TTS / Fun-ASR-Nano / Chatterbox / sherpa-onnx / Smart Turn 都是 Apache-2.0、MIT 或 BSD-2-Clause。**不要默认内置** Piper（GPL 引擎）、IndexTTS（自有许可 + MAU/营收门槛）、Supertonic 3（无中文且仓库归档）、PocketTTS（无中文、许可表述冲突）、Moonshine 中文权重（Community License 注册 + 营收上限）。

## 1. 约束与评分维度

| 维度 | 要求 |
|---|---|
| 交互 | 按一次麦克风进入连续对话；TTS 播放期间麦克风继续监听；用户开口立即停播并接住新话 |
| 语言 | 中文为主，允许中英混说、英文术语/产品名/代码标识符 |
| 硬件 | 核显/CPU 必须可用；RTX 4090 Laptop 16G 为高质量档；允许云端兜底 |
| 延迟 | 首包优先；ASR 需要 partial；TTS 首句尽快出声；打断不能等云端往返 |
| 部署 | Windows 10/11 x64；Electron + Node/TS gateway（CJS）；不能要求用户装 Python/编译器 |
| 许可 | 商用友好；模型权重单独核对；避免 GPL 引擎和非商用权重 |
| 集成 | 优先进程内 Node addon / ONNX；Python 只用于独显高质量档；本地 HTTP 作为插件形态 |

## 2. ASR 选型

### 2.1 本地候选

| 候选 | 许可 | 语言 | 模式 | 体积/内存 | CPU/核显 | 中文准确度证据 | Node/Windows | 结论 |
|---|---|---|---|---|---|---|---|---|
| **sherpa-onnx streaming Zipformer bilingual zh-en int8** | Apache-2.0 | 中英混说 | **真流式**（partial + endpoint） | ~190 MB int8 | RTF ~0.09–0.37（官方 + 独立 i7） | AISHELL-1 3.04；WenetSpeech 8.97/8.83（模型卡） | `sherpa-onnx-node`，Win x64 预编译 | **核显档主 ASR** |
| sherpa-onnx streaming Paraformer bilingual zh-en | Apache-2.0 | 中英 | 真流式，无时间戳 | ~226 MB int8 | RTF ~0.15（官方） | 流式 CER 未公开；离线 Paraformer 参考 1.95/6.74 | `sherpa-onnx-node` | 流式备选 |
| **Qwen3-ASR-0.6B int8（sherpa 导出）** | Apache-2.0 | 30 语言 + 22 中文方言 | 离线；VAD 模拟流式 | ~940 MB | RTF ~0.077–0.146（官方 2 线程）；N100 社区 0.84–1.36，边缘 | CV-zh 6.89；Fleurs-zh 4.39 | `sherpa-onnx-node` | **核显档终稿二次解码** |
| **Fun-ASR-Nano-2512 int8** | Apache-2.0 | 中英日 + 7 方言/26 口音 | 离线；vLLM 可 720 ms 流式 | ~949 MB | RTF ~0.16–0.19（官方 2 线程） | AISHELL-1 1.80；WenetSpeech 6.01/6.60 | sherpa-onnx-node 或 llama.cpp exe | 终稿备选；方言强 |
| Qwen3-ASR-1.7B | Apache-2.0 | 30 语言 + 22 方言 | 离线；vLLM 真流式 | ~4.4 GB | 无官方 CPU RTF；GPU RTF ~0.015 | CV-zh 5.35；Fleurs-zh 2.41 | Python/vLLM sidecar | **独显档主 ASR** |
| SenseVoiceSmall | 代码 MIT / 权重 Apache-2.0 | 中英日韩粤 | 离线；VAD 模拟流式 | ~228 MB int8 | RK3588 A76 RTF 0.099；A55 0.436 | AISHELL-1 2.96；WenetSpeech 7.84/7.44 | `sherpa-onnx-node` | 轻量终稿备选 |
| Whisper large-v3-turbo / faster-whisper | MIT | 99 语言 | 离线/分块伪流式 | ~1.6 GB int8 | CPU 可用但延迟高；GPU 才舒服 | CV-zh 12.91；WenetSpeech 11.89/18.39 | whisper.cpp / Python | 只作兼容兜底；中文弱于专用模型 |
| Parakeet TDT 0.6B v3 | Apache-2.0 / CC-BY-4.0 | 25 种欧洲语言，**无中文** | 离线 | 600M | — | — | NeMo / ONNX | **排除（无中文）** |
| Moonshine v2 | 代码 MIT；中文权重 Community License | 8 语言含中文 | 流式 encoder | tiny-zh 27M / base-zh 135 MB | base-en RTF 0.109 | tiny-zh Fleurs-zh 12.78；base-zh 未公开 | `sherpa-onnx-node` | 不推荐：精度落后 + 中文权重许可有门槛 |

### 2.2 选择逻辑

- **真流式 vs 离线**：只有 Zipformer / streaming Paraformer 在 CPU 上逐帧出 partial；Qwen3-ASR、Fun-ASR-Nano、SenseVoice、Whisper 都是「VAD 切段后整段解码」。连续对话的「说完立刻回应」必须靠真流式做端点，终稿可以用离线模型补准确度。
- **核显档推荐双通道**：
  1. Zipformer 持续出 partial，驱动 UI 字幕和 endpoint；
  2. VAD 判定回合结束后，用 Qwen3-ASR-0.6B 对整段重解码，替换 partial 作为最终文本。
  - 这样首字延迟低，最终准确度接近大模型；代价是终稿多一次 0.1–0.3 s 级解码（按 3–10 s 语音估算）。
- **独显档**：Qwen3-ASR-1.7B 的准确度和方言覆盖明显更好，但必须 vLLM sidecar；0.6B 是低显存/低延迟备选。
- **云端档**：Qwen3-ASR-Flash Realtime 与本地 Qwen3 同家族，迁移成本低；火山 Doubao 是国内价格/方言备选；Deepgram/ ElevenLabs 适合海外，但中文方言和代码混说不占优。

## 3. TTS 选型

### 3.1 本地候选

| 候选 | 许可 | 中文/中英混 | 流式 | 克隆 | 体积/CPU RTF | 中文质量证据 | Node/Windows | 结论 |
|---|---|---|---|---|---|---|---|---|
| **Kokoro multi-lang v1.1 zh_en** | Apache-2.0 | 中文 + 英文，103 音色 | 句级（sherpa offline-tts） | 否 | 311 MB；RPi4 v1.0 RTF 3.19（4 线程），笔记本未实测 | 无公开 CER；v1.1-zh 为早期中文，数字/日期需 FST | `sherpa-onnx-node` | **核显档质量首选** |
| **MeloTTS zh_en（sherpa 转换）** | MIT | 中文 + 英文混说，1 音色 | 句级 | 否 | 163 MB；RPi4 RTF 2.52（4 线程） | 无公开 CER；2023 年 VITS，自然度一般 | `sherpa-onnx-node` | **弱核显/低延迟首选** |
| sherpa VITS zh / Matcha zh | Apache-2.0（运行时）；模型各自许可 | 中文（部分中英） | 句级 | 否 | 115–163 MB；RPi4 RTF 1.59–2.5 | 老一代 VITS，质量低于 Kokoro/Melo | `sherpa-onnx-node` | 低资源兜底 |
| **CosyVoice3-0.5B** | Apache-2.0 | 9 语言 + 18 中文方言 | **原生双流式，150 ms** | 零样本 3–10 s | ~3.4 GB fp32；GPU 4–8 GB | Seed test-zh CER 1.21 / SS 78.0；CV3 0.5B 1.16 | Python FastAPI/gRPC sidecar | **独显档首选** |
| **Qwen3-TTS-0.6B / 1.7B** | Apache-2.0 | 10 语言，中英 | **原生流式，97 ms** | 3 秒 | 0.6B ~1.8 GB；CPU RTF ~4.5（Ryzen 9） | Seed test-zh CER 0.92 / 0.77 | Python `qwen-tts` / vLLM-Omni | **独显档备选；克隆强** |
| Chatterbox Multilingual | MIT | 25 语言含中文 | 无官方流式 | 5–10 s | 0.5B；GPU 8–16 GB | 厂商中文 CER 0.41–0.69（ASR 评估，非 MOS） | Python sidecar | 克隆备选；默认水印 |
| IndexTTS 2.5 | bilibili 自有许可 | 中英日西阿 | 无流式 | 单参考 + 情绪 | ~6 GB VRAM | CV3 zh WER 4.36 / SS 77.10 | Python/uv sidecar | **不默认内置**：许可门槛 + 无流式 |
| Supertonic 3 | 代码 MIT / 权重 OpenRAIL-M | **无中文** | 块级 | 否 | 99M；CPU RTF ~0.3 | — | npm/HTTP | 排除：无中文 + 仓库归档 |
| PocketTTS | 代码 MIT / 权重表述冲突 | **无官方中文** | 原生流式 ~200 ms | 5 s+ | 100M；CPU 实时 | — | Python/Rust/sherpa | 排除：无中文 + 许可不清 |
| Piper | 引擎 GPL-3.0 | 有 zh_CN 单音色 | 句级 | 否 | 63 MB；CPU 快 | 老一代，质量低 | 独立进程可规避 GPL | 不默认内置 |

### 3.2 选择逻辑

- **核显档**：TTS 没有「既原生流式又 CPU 实时又中文自然」的选项。现实方案是**句级合成 + 短首句**：
  - 质量优先：Kokoro v1.1 zh_en（103 音色，24 kHz，听感更自然）；
  - 速度/弱机优先：MeloTTS zh_en（163 MB，44.1 kHz，单音色，CPU 更快）；
  - 两者都通过 `sherpa-onnx-node` 的 `OfflineTts.generateAsync` 逐句/逐块产出，首句控制在 10–20 字以内。
- **独显档**：CosyVoice3 的中文自然度/方言最好，且 150 ms 双流式；Qwen3-TTS 的 97 ms 和 3 秒克隆更强，但生态更新、Windows 部署更重。建议 CosyVoice3 主、Qwen3-TTS 备。
- **云端档**：MiniMax Speech-02 Turbo 的中文原生度和 10 秒克隆最均衡；火山 Doubao TTS 是国内成本/延迟备选；Azure 是合规备选；MiMo TTS 可保留为现有免费通道，但要注意没有公开 list price。

## 4. VAD 与轮次判定

| 组件 | 许可 | 语言 | CPU/ONNX | 延迟证据 | 作用 | 结论 |
|---|---|---|---|---|---|---|
| **Silero VAD** | MIT | 语言无关 | 是，~2 MB | <1 ms / 30 ms chunk | 连续监听、即时 barge-in | **必选** |
| **Smart Turn v3.2** | 包 MIT；模型 BSD-2-Clause | 23 语言含中文 | 是，8.3 MB int8 | Node 1 核 37 ms / 4 核 14 ms；浏览器 WASM 68–194 ms | 判断「这句话说完了没有」 | **推荐**，通过 `@micdrop/smart-turn` 挂到现有 `TurnStopStrategy` |
| LiveKit turn detector v1 / v1-mini | 代码 Apache-2.0；模型 LiveKit Model License | 14 语言 | v1-mini 本地 CPU | v1-mini 300 ms 误切 27.8%；v1 9.9% | 语义端点 | 不推荐独立使用；只有整体采用 LiveKit Agents 才考虑 |

**关键分工**：

- barge-in 触发 = Silero VAD 的 `speech_started`（播放期间持续监听），不要等 ASR partial，更不要等云端。
- 回合结束 = VAD `speech_stopped` 后跑 Smart Turn；`complete` 才 end_turn，否则继续等。
- AEC 必须开启（Electron `getUserMedia({ echoCancellation: true })`）；扬声器外放场景要实测，必要时上 WebRTC AEC。

## 5. 云端候选

### 5.1 STT

| 提供商/模型 | 实时 | 中文 | 价格（2026-10-28 快照） | 协议 | 备注 |
|---|---|---|---|---|---|
| **阿里 Qwen3-ASR-Flash Realtime** | WS 实时 | 普通话/粤语/吴语/四川话等 | 约 **$0.0028/min**（¥0.00033/s） | DashScope WS + OpenAI 兼容 batch | **中文实时首选**；精度为厂商口径，需自测 |
| 火山 Doubao ASR 2.0 | WS 二进制 | 普通话/方言/混说 | 约 **$0.0023/min**（¥1/hr） |  proprietary WS | 国内价格/延迟备选；锁定高 |
| Deepgram Nova-3 | WS + REST | zh/zh-CN/zh-TW/zh-HK | $0.0048–0.0077/min | WS/REST | 便宜，但 Flux 端点不支持中文；需自建 endpoint |
| ElevenLabs Scribe v2 Realtime | WS | 90+ 语言，中文未公开 | $0.0065/min | WS/REST | 150 ms 主要针对欧洲语言；中文需实测 |
| Azure AI Speech | WS/SDK | zh-CN/zh-TW/zh-HK/yue/wuu/四川 | $0.0167/min | Speech SDK | 合规/企业备选；Azure China 独立 |
| OpenAI gpt-4o-transcribe / live | 文件/实时 WS | 90+，中文一般 | $0.003–0.017/min | OpenAI | 国内不可用；模型 2027-02 退役 |
| AssemblyAI Universal-3.5 Pro Realtime | WS | 19 语言含普通话 | $0.0075/min，按连接时长计费 | WS | 常开桌面会被静默计费，慎用 |
| **Xiaomi MiMo v2.5 ASR** | **否（整段上传）** | 中英混、吴语、粤语、歌词 | ¥0.5/hr ≈ $0.0012/min | OpenAI chat | **不能做实时对话**；可做离线/语音消息 |

### 5.2 TTS

| 提供商/模型 | 流式 | 中文 | 克隆 | 价格（2026-10-28 快照） | 备注 |
|---|---|---|---|---|---|
| **MiniMax Speech-02 Turbo** | HTTP + WS | 原生中文，24 语言 | 10 秒 | 约 **$0.06/1k 字符** | **中文低延迟首选**；延迟未公开，需实测 |
| 火山 Doubao TTS 2.0 | WS | 原生中文/方言/情绪 | 5 秒 | 约 **$0.042/1k 字符**（¥0.30） | 国内成本/延迟备选；锁定高 |
| Azure Neural TTS | WS/SDK | zh-CN 多音色/风格 | CNV 需申请 | $0.015/1k 字符（HD $0.022） | 合规备选；情感灵活度一般 |
| ElevenLabs Flash v2.5 / v4 Turbo | WS + HTTP | 32/90+ 语言 | IVC/PVC | $0.04/1k 字符 | 表现力强；中文口音需实测；贵 |
| Cartesia Sonic 3 | WS + HTTP | 42 语言含 zh-CN | 3 秒 | 约 $0.049/1k 字符 | 低延迟；中文证据少 |
| OpenAI gpt-4o-mini-tts | HTTP chunked | 50+，中文可用但不够 native | 否 | 约 $0.015/min | 协议最干净；国内不可用 |
| **Xiaomi MiMo v2.5 TTS** | SSE PCM | 原生中文/方言/风格/唱歌 | 秒级 | 当前免费/促销，无 list price | 现有通道；可保留为云 TTS 候选 |
| Deepgram Aura-2 | WS/REST | **无中文** | 否 | $0.030/1k 字符 | 排除 |

## 6. 推荐架构映射（只到选型层）

### 6.1 核显/CPU 档

```
麦克风
  → Silero VAD（持续，barge-in 即停播）
  → sherpa-onnx streaming Zipformer（partial + endpoint）
  → Smart Turn v3.2（确认回合结束）
  → Qwen3-ASR-0.6B int8（终稿二次解码）
  → LLM（流式）
  → Kokoro v1.1 zh_en 或 MeloTTS zh_en（句级 TTS，首句短）
  → AudioWorklet 播放
```

- 单依赖 `sherpa-onnx-node` 覆盖 ASR / TTS / VAD / 标点 / 说话人分离；Windows x64 预编译、N-API、不需要编译器/Python。
- 所有模型放 `~/.mafw/models/<engine>/`，懒加载，同一时间只驻留一个重模型。
- 新增 `AsrEngine` 注册表，镜像现有 `TtsEngineRegistry`：`capabilities { streaming, languages, punctuation, timestamps, sampleRate }` + `transcribeStream()` / `transcribe()`。
- `TurnStopStrategy` 已有接缝，新增 `SmartTurnStrategy` 即可。

### 6.2 独显档

```
sherpa-onnx Zipformer (partial/endpoint) 或 直接 vLLM Qwen3-ASR-1.7B 流式
  → CosyVoice3-0.5B（150 ms 双流式）或 Qwen3-TTS-0.6B（97 ms）
  → 现有 AudioWorklet / barge-in
```

- Python/vLLM sidecar 复用现有 `llamacpp-provider` 生命周期：健康检查、`windowsHide`、树杀、退避重启、懒启动。
- CosyVoice3 的 Windows 原生安装很重（pynini/WeTextProcessing/DeepSpeed），建议 WSL2/Docker 或独立 venv；Qwen3-TTS 用 vLLM-Omni 的 `/v1/audio/speech` 更干净。
- 显存预算：CosyVoice3 4–8 GB；Qwen3-TTS 0.6B ~2 GB；与 LLM 共享 16 GB 时要限流/排队。

### 6.3 云端档

- 内部定义 **OpenAI 形状的音频接口**（transcription session / speech request / cancel），厂商适配器隔离：
  - 阿里 DashScope：Qwen3-ASR-Flash Realtime + MiniMax/火山 TTS；
  - 海外：OpenAI live transcribe + gpt-4o-mini-tts，或 ElevenLabs/Deepgram；
  - 现有 MiMo TTS 保留为云端 TTS 适配器；MiMo ASR 只用于离线/语音消息。
- **barge-in 永远本地**：本地 Silero 检测到语音 → 立即 flush 播放缓冲 + abort 上游请求；不要等云端 VAD/endpoint 往返。

## 7. 许可证与风险

### 7.1 许可证（已实读 LICENSE）

| 组件 | 结论 |
|---|---|
| Qwen3-ASR / Qwen3-TTS / CosyVoice / Fun-ASR-Nano | Apache-2.0 |
| SenseVoice | 代码 MIT；权重 Apache-2.0（模型卡） |
| Kokoro | Apache-2.0（代码 + 权重） |
| MeloTTS | MIT（代码 + 权重） |
| Chatterbox | MIT |
| sherpa-onnx | Apache-2.0（运行时）；各模型单独许可 |
| Smart Turn | 包 MIT；模型 BSD-2-Clause |
| Silero VAD | MIT |
| Piper | 引擎 GPL-3.0；声音单独许可 → 不默认内置 |
| IndexTTS 2.5 | bilibili Model License（MAU/营收门槛）→ 不默认内置 |
| Supertonic 3 | 代码 MIT；权重 OpenRAIL-M；无中文 → 排除 |
| PocketTTS | 代码 MIT；权重 CC-BY-4.0 vs 非商用表述冲突 → 排除 |
| Moonshine 中文 | Community License（注册 + 营收上限）→ 不推荐 |

### 7.2 必须实测的风险

1. **核显 RTF 没有实测**：Kokoro/MeloTTS 的 RPi4 数字不能直接外推到 Intel Iris Xe / AMD Radeon 780M。必须在目标核显上用 30–50 句中文/中英混说测 RTF、首包、内存。
2. **Kokoro 中文是早期版本**：v1.1-zh 的听感、数字/日期/多音字需要 FIST/FST 和实际试听；MeloTTS 更老，可能更平。
3. **Qwen3-ASR-0.6B 的 sherpa JS 绑定**：`qwen3Asr` / `funasrNano` 配置在 JS API 文档里不完整，落地前读 `scripts/node-addon-api/lib/non-streaming-asr.js` 验证。
4. **Fun-ASR-Nano 的 llama.cpp Vulkan 路径很新**：iGPU 加速是唯一现实路径，但要验证 Windows 二进制、显存/内存和稳定性。
5. **Smart Turn 第三方包**：`@micdrop/smart-turn` 是 MIT 社区包，不是 Pipecat 官方 Node SDK；模型是 BSD-2，但包维护风险要评估。
6. **AEC 外放场景**：Electron 的 `echoCancellation: true` 在耳机下够用，扬声器外放可能仍会自触发；需要 WebRTC AEC 或降低 VAD 灵敏度 + 播放期间动态阈值。
7. **云端价格/可用性**：MiMo TTS 当前免费/促销且无 list price；Qwen3-ASR-Flash 价格和精度是厂商口径；OpenAI 国内不可用；火山/阿里区域锁定要按部署地选择。

## 8. 下一步验证清单

1. **造测试集**：30–50 条中文 + 中英混说 + 噪声 + 代码标识符；每条 3–10 秒；另做 10 条长句测终稿。
2. **核显基准**：Zipformer streaming vs Qwen3-ASR-0.6B vs Fun-ASR-Nano；记录首 partial、终稿延迟、RTF、峰值内存。
3. **TTS 基准**：Kokoro v1.1 zh_en vs MeloTTS zh_en vs VITS zh；记录首包、RTF、内存、MOS/偏好、数字/日期/中英混读。
4. **Smart Turn 实测**：真实停顿、犹豫、思考、被打断；统计误切率/等待时长。
5. **barge-in + AEC 实测**：耳机/外放两种；统计 TTS 自触发次数、打断成功率。
6. **薄 spike**：只加 `AsrEngine` 接口 + `SmartTurnStrategy`，不改 UI；验证进程内 sherpa-onnx-node 在 Electron/gateway 里的打包、`asarUnpack`、`enableExternalBuffer:false`。
7. **云端适配器**：先接 Qwen3-ASR-Flash Realtime + MiniMax TTS，跑同一测试集对比本地档。

## 9. 参考来源

### 本地 ASR
- sherpa-onnx 仓库：https://github.com/k2-fsa/sherpa-onnx
- sherpa-onnx Node 安装：https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html
- sherpa-onnx Zipformer 模型：https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html
- sherpa-onnx Qwen3-ASR：https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/pretrained.html
- sherpa-onnx FunASR-Nano：https://k2-fsa.github.io/sherpa/onnx/funasr-nano/index.html
- Qwen3-ASR：https://github.com/QwenLM/Qwen3-ASR
- Fun-ASR：https://github.com/QwenAudio/Fun-ASR
- SenseVoice：https://github.com/FunAudioLLM/SenseVoice
- Whisper：https://github.com/openai/whisper
- faster-whisper：https://github.com/SYSTRAN/faster-whisper
- Parakeet TDT v3：https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3

### 本地 TTS
- sherpa-onnx TTS 模型：https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html
- sherpa-onnx Kokoro：https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html
- sherpa-onnx VITS（含 MeloTTS zh_en）：https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html
- MeloTTS：https://github.com/myshell-ai/MeloTTS
- Kokoro：https://github.com/hexgrad/kokoro
- CosyVoice：https://github.com/FunAudioLLM/CosyVoice
- Qwen3-TTS：https://github.com/QwenLM/Qwen3-TTS
- Chatterbox：https://github.com/resemble-ai/chatterbox
- IndexTTS：https://github.com/index-tts/index-tts
- Piper：https://github.com/OHF-Voice/piper1-gpl

### VAD / Turn
- Silero VAD：https://github.com/snakers4/silero-vad
- Smart Turn：https://github.com/pipecat-ai/smart-turn
- `@micdrop/smart-turn`：https://www.npmjs.com/package/@micdrop/smart-turn
- LiveKit turn detector：https://docs.livekit.io/agents/logic/turns/turn-detector/

### 云端
- 小米 MiMo 定价：https://mimo.mi.com/docs/zh-CN/pricing
- 阿里 Qwen3-ASR-Flash Realtime：https://help.aliyun.com/zh/model-studio/qwen3-asr-flash-realtime
- 阿里 Qwen3-TTS-Flash：https://help.aliyun.com/zh/model-studio/qwen3-tts-flash
- MiniMax 定价：https://platform.minimax.io/docs/guides/pricing-paygo
- 火山 Doubao 计费：https://docs.volcengine.com/docs/DoubaoVoice/Billinginstructions-21
- Deepgram 定价：https://deepgram.com/pricing
- ElevenLabs 定价：https://elevenlabs.io/pricing/api
- Azure Speech 定价：https://azure.microsoft.com/en-us/pricing/details/speech
- OpenAI 定价：https://developers.openai.com/api/docs/pricing
- AssemblyAI 定价：https://www.assemblyai.com/pricing
