# Voice Plan 2 调研：final 进输入栏、自动发送与语音回复标记

- 日期：2026-11-04
- 触发：用户反馈「语音没有进入输入栏；只是发文字的话 agent 如何知道是语音输入、需要语音回复」，随后拍板直接开始 Plan 2（完整语音回路）。
- 方法：源码走读 + 对运行中 gateway（127.0.0.1:3000）的真实会话历史探针 + 外部 UX 检索。
- 前置：`2026-11-03-voice-duplex-v1-design.md`（已批准 v1 设计）、`2026-11-03-moss-live-duplex-research.md`（双工架构调研）、Plan 1 已合并（`f94141a7`）并真机启用。

## 1. 实测事实（对本设计有决定性影响）

### 1.1 synthetic part 的历史往返：flag 不存活，文本必外显

对 legacy 语音消息（`upload.ts` 以 `message:"" + parts:[{text: 指针, synthetic:true}]` 发送）探针
`GET /api/sessions/:id/messages`：

- user 消息 DTO keys = `id/time/text/type/role/content`，**没有 `parts` 字段**；
- `text` = 完整指针文本（`[媒体附件 taskID: …]`），`synthetic` 标记不在历史出口；
- 结论：**`synthetic` 只活在 renderer 本地乐观 parts**。服务端把 text parts 折进持久化消息文本，
  任何想让模型看到的文字都会出现在 flat `text` 里（TUI/导出可见）。

### 1.2 展示层「首个非 synthetic text part」规则是桌面端的天然屏障

`session-ui message-part.tsx:1263` 只渲染**第一个非 synthetic 的 text part**。因此：

- 发送形态 `parts=[{text: 用户文本}, {text: 标记, synthetic:true}]`（顺序由 `/api/chat/enriched`
  构造保证：`promptParts = [{text: enrichedMessage}, ...自定义 parts]`，gateway/src/index.ts:5866）——
  桌面气泡在**乐观显示、SSE 到达、历史重载**三个阶段都只显示用户文本，标记自动隐藏；
- 即使服务端往返丢掉 `synthetic` flag（content parts 顺序保留），第一个 text part 仍是用户文本，展示仍然干净。

### 1.3 steer/队列路径只承载 message 文本

W5a busy 分支：`promptAsync({ message: queuedText, delivery })` —— **没有 parts 通道**。
语音标记若只走 parts，忙时（steer/网关队列）会丢失；本地 turn-queue 是结构化对象，可带 flag。

### 1.4 语音回复链路已全部存在且生产验证过

- gateway `runtime/mafw-tools.ts` `mafw_media_speak`：合成 → 返回 `[语音回复 art:… 音色:… h:…]`
  标记，工具描述已要求 agent 原样写进回复文本；
- desktop `use-voice-binding.ts` 自动播放 effect：marker → `playedVoiceArtifacts`（artifactId）+
  `hasRecentSpeakHash`（djb2）双去重 → `voiceSession.playUrl`；
- `AudioReply` 卡渲染在 SessionTurn 之后、无 autoplay（双播教训 mem_j89qxs / mem_6bd1j2 / btrh60：
  **自动行为必须收敛在单一 effect + 中央去重，绝不挂载即触发**）。
- → Plan 2 复用整条链，**零新增播放机制**。

### 1.5 AEC 已开，但回声环路需要确定性防线

`silero.ts` getUserMedia 已带 `echoCancellation/noiseSuppression/autoGainControl`。但外放时 AEC
不完美：TTS 播放中 ASR 可能转写 agent 自己的声音 → final → 自动发送 → 无限自言自语环。
防线：**TTS speaking 期间丢弃 ASR final（不进输入栏、不自动发送）**。真 barge-in（边播边说、
打断续播）属 v1 spec 切片 C，不在本计划。

### 1.6 desktop 读 gateway 配置的现成通道

`use-voice-binding.ts` 已用 `window.api.mafw.config.get("media.tts.vad")` 读配置。
`voice.duplexAutoSend` 可走同一通道，**gateway 零改动**（键缺失 → desktop 默认 true）。

## 2. 外部 UX 检索（auto-send vs confirm-before-send）

- ChatGPT 语音模式：端点检测后自动发送（turn-based 会话）；
- OpenAI 社区存在「请恢复发送前可编辑」诉求帖（dictation 自动发送引发误发抱怨）；
  → 平衡点 = **自动发送 + 文本可见窗口（可取消）+ 配置开关**；
- 微信语音转文字：转写后需手动点发送（保守派参照）；
- 结论：默认自动发送（用户明确要求「说完自动发送」），`voice.duplexAutoSend: false`
  退化为「只填输入栏、手动发送」。

## 3. 方案对比

### 方案 A（选定）：agent 驱动 `mafw_media_speak` + synthetic 标记 part

- 空闲路径：标记作为第二个 text part（synthetic）随 sendEnriched 发送（vision 指针同款先例）；
- 忙时路径：steer/网关队列把标记内联进 queuedText；本地队列带 `voiceOrigin` flag；
- 语音回复 = 既有 marker→自动播放链；
- 优点：**零 gateway 改动、零新播放机制**（不触碰双播 bug 域）；桌面三个显示阶段天然干净；
- 缺点：模型服从性（不调用工具则无语音回复，兜底 = 手动 Speak 按钮）；延迟 = 全文 + 一次工具往返。

### 方案 B（未选）：desktop 确定性自动朗读

- turn 完成后 `voiceSession.speak(lastAssistantText())`；
- 优点：确定性、少一次工具往返、生成可回放的 artifact 缺失（无 AudioReply 卡）；
- 缺点：需要回合完成检测 + 新触发器；与双播记忆同域（新增风险面）；
- 留作 **Plan 2.1**：若真实使用中 agent 服从性差，改为系统自动朗读并撤掉指令。

### 与已批准 v1 spec 的关系

v1 spec §10.3/§11 的终局是「runtime 独占自动发声、delta 驱动 TTS」（切片 B，SpeechProjector）。
Plan 2 是产品增量：在切片 B 落地前用既有 `mafw_media_speak` 机制交付完整回路；切片 B 落地时
指令改为「不要调用 mafw_media_speak，语音由系统统一播报」（spec 原文语义）。

## 4. 决策清单（供 spec 引用）

| # | 决策 | 依据 |
|---|---|---|
| D1 | final 追加进 composer（多段 `\n` 连接），字幕条保留 | 用户核心诉求「进入输入栏」 |
| D2 | 自动发送：final 后 1200ms 静默窗；新 partial / 用户手动输入 / 停止 / TTS 播放 → 取消；`voice.duplexAutoSend` 默认 true | §2 平衡点；说话继续=还想补充 |
| D3 | 语音来源标记：空闲路径 synthetic part；忙时内联文本；本地队列 flag | §1.2/§1.3 |
| D4 | 语音回复：指令要求调用 `mafw_media_speak`，复用 marker 自动播放 | §1.4 |
| D5 | 回声防线：`ttsSpeaking` 期间丢弃 ASR final | §1.5 |
| D6 | 停止 duplex 同时停 TTS 播放 | 播放中点麦应全静音 |
| D7 | Tech Lead / slash 命令不加标记（v1 范围外，行为记录在案） | 范围纪律 |
| D8 | 桌面所有显示面剥离内联标记（queue 条），TUI/导出显示原文 | 与媒体指针同等待遇 |
