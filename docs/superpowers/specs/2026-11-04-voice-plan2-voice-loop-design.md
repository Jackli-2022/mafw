# Voice Plan 2：语音回路（final→输入栏→自动发送→语音回复）设计

> 日期：2026-11-04
> 状态：已批准实施；Plan 2 六任务已交付（commits 5a79be58..44442a2a），真机冒烟见交付报告
> 范围：desktop 渲染层 only——**gateway / SDK / preload 零改动**
> 前置：`2026-11-03-voice-duplex-v1-design.md`（已批准）、Plan 1 已合并启用（`voice.duplexV1`）

## 1. 意图

Plan 1 只做实时字幕：final 停留在字幕条，不进输入栏，agent 也无从得知消息来自语音。Plan 2 打通
完整回路：

> 说 → partial 实时字幕 → 停顿后 final 落入**输入栏**（可见、可改）→ 静默窗口后**自动发送** →
> agent 知道这是语音输入，**简短口语化回答**并调用 `mafw_media_speak` → 回复**自动语音播放** →
> 麦克风继续听。

## 2. 目标体验

```text
[点麦克风] → listening（Plan 1 不变）
  说话 → partial 字幕
  停顿（VAD ≈1.2s）→ asr.final → 文本进输入栏（多段 \n 累积）→ 自动发送计时（1200ms）
    ├─ 计时窗口内又开口（新 partial）→ 取消发送，继续累积
    ├─ 用户手动敲键盘 → 取消发送（文本保留待手动发）
    └─ 静默到期 → 自动发送（携带语音来源标记，UI 不可见）
  agent → 简短口语化回答 + mafw_media_speak → [语音回复 art:…] → 自动播放（既有链路）
  播放期间 → ASR final 丢弃（回声防线）；播放结束 → 继续听
[再点麦克风] → 停止收音 + 停止播放；未发送文本保留在输入栏
```

## 3. 决策（依据见调研文档 §4）

- **D1 final 进输入栏**：`useDuplexVoice` 新增 `onFinal` dep（每 final 恰好回调一次）；
  ChatPane 追加到 `input` signal（空则置入，非空则 `\n` 连接）。字幕条行为保留。
- **D2 自动发送**：新纯模块 `duplex-auto-send.ts` 控制器（注入 timers 可测）。默认 1200ms；
  取消条件 = 新 partial / 用户手动输入 / 停止 / TTS speaking 出现。配置 `voice.duplexAutoSend`
  （gateway config，缺省 **true**；false = 只填输入栏、不自动发送）。停止（点麦/字幕条「停止」）
  不发送，文本保留。
- **D3 语音来源标记**（单行，模型可见、桌面不可见）：

  ```text
  [语音输入] 本消息来自用户的实时语音转写。请用简短、口语化的中文回答（避免表格与长代码），回答完成后调用 mafw_media_speak 工具把回答合成语音播报给用户。
  ```

  - 空闲路径（sendEnriched）：作为第二个 text part（`synthetic: true`）追加——「首个非 synthetic
    text part」展示规则保证气泡干净（乐观/SSE/历史三阶段一致，调研 §1.2）；
  - 忙时 steer / 网关队列：内联进 `queuedText`；队列条显示经 `stripVoiceOriginMarker` 剥离；
  - 本地 turn-queue：`QueuedTurn.voiceOrigin` flag，flush 时重新标记，存文本保持干净；
  - slash 命令与 Tech Lead 发送不标记（D7）。
- **D4 语音回复**：完全复用既有 `mafw_media_speak` → `[语音回复 art:…]` → 自动播放 effect →
  `AudioReply` 卡。**不新增任何播放路径**（双播教训：自动行为只在既有 effect + 中央去重）。
  **实时性门槛**：只有本面板正在跑的回合（`sending()`）才自动播放；进入会话加载的历史回复
  永不自动出声。**artifact 播放不启动 barge-in VAD**（自听自切回归），流式 speak 的 barge-in 保留。
- **D5 回声防线**：`ttsSpeaking`（VoiceSession speaking 态）期间，ASR final **丢弃**（不进输入栏、
  不计时）。AEC 已开但不可依赖（外放回声 → 自言自语环）。
- **D6 停止 duplex 同时 `stopActivePlayback()`**：播放中点麦 = 全静音。
- **D7 范围外**：Tech Lead/Pod 发送、slash 命令不加标记；TUI/mobile/导出显示标记原文（与媒体
  指针同等待遇）；barge-in 与 runtime 驱动 delta TTS 属 v1 spec 切片 B/C。

## 4. 诚实声明（不假装的能力）

- **延迟**：语音回复在 agent 写完回答 + 一次工具往返之后才开始播报（首音频 ≈ 数秒~十余秒，
  取决于回答长度）。用户此前接受的「1–2 秒」口径属切片 B（runtime 驱动 delta TTS），本计划
  不冒充达到。
- **服从性**：agent 可能不调用 `mafw_media_speak`（无语音回复）；兜底 = 消息行内 Speak 按钮 /
  TTS picker。若实际服从性差，Plan 2.1 改为系统确定性自动朗读。
- **误识别自动发送**：ASR 错字会直接成为消息——文本在输入栏可见 1.2s+，继续说话可取消，
  `voice.duplexAutoSend:false` 可整体关闭。

## 5. 测试策略

- 纯函数/控制器单测：marker 模块（追加/剥离/判存）、auto-send 控制器（注入 timer：到期触发、
  partial/手动输入/停止/播放取消、echo 丢 final、重复 final、无 timer 泄漏）、`onFinal` 恰一次、
  sendMessage voiceOrigin 各路径组合（含 busy steer/queue/local-queue）、queueItemText 剥离。
- 接线契约（源码字符串钉扎，`duplex-voice-wiring.test.ts` 同款）：ChatPane 消费控制器、
  `stop_duplex` 停播放、textarea 手动输入取消、bar 显示 pendingSend。
- 真机冒烟（清单见 plan 文档 Final Verification）：完整说→发送→语音回复回路、回声防线、
  历史重载无标记、legacy 路径零回归、0 控制台错误。

## 6. 明确反目标

- 把回声防线退化成「调高 VAD 阈值」（反模式，见记忆 pb5pxv）。
- 在 duplex 播放路径上新增第二套自动播放/autoplay（双播 bug 域，mem_j89qxs/6bd1j2）。
- 声称支持 barge-in / 亚秒首声 / 连续语义判停（属切片 B/C 与 MOSS 式模型侧判停）。
