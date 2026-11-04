# Voice Plan 2 — 语音回路（final→输入栏→自动发送→语音回复）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（或 subagent-driven-development）逐任务实施。步骤用 checkbox（`- [ ]`）跟踪。
> 每个 Task 严格 TDD：写失败测试 → 看预期失败 → 最小实现 → 目标测试绿 → 相关全量绿 → 独立 commit → 汇报新增用例数与当时全量数。

**Goal:** 让 duplex ASR 的 final 文本落入输入栏并自动发送；agent 感知语音输入并以 `mafw_media_speak` 语音回复（复用既有自动播放链），形成完整语音回路。

**Architecture:** 全部改动在 desktop 渲染层。`useDuplexVoice` 暴露 `onFinal` 恰一次回调 → ChatPane 的 auto-send 控制器（纯模块、注入 timer）追加文本进 composer 并计时发送 → `sendMessage` 新增 `voiceOrigin` 选项按路径附标记（空闲=synthetic part；steer/网关队列=内联文本；本地队列=flag）→ agent 调 `mafw_media_speak` → 既有 marker 自动播放。**gateway / SDK / preload 零改动。**

**Spec:** `docs/superpowers/specs/2026-11-04-voice-plan2-voice-loop-design.md`
**Research:** `docs/research/2026-11-04-voice-plan2-loop-research.md`

## Global Constraints

- 仅 desktop 渲染层；`voice.duplexV1: false` 时 legacy 录音→WAV→Media Agent 路径零回归。
- 标记文本必须单行、以 `[语音输入]` 开头（剥离正则依赖该前缀）。
- 不新增任何 TTS/播放路径；自动播放只走既有 `use-voice-binding` effect + `playedVoiceArtifacts`/`hasRecentSpeakHash` 双去重（双播教训 mem_j89qxs/6bd1j2/btrh60）。
- 回声防线是硬性要求：`ttsSpeaking` 期间 ASR final 丢弃；不得用调 VAD 阈值替代。
- 计时器必须可注入、可取消、无泄漏（stop/dispose/重复 final）。
- 自动发送默认开启（`voice.duplexAutoSend` 缺省 true，经 `window.api.mafw.config.get` 读，读不到 fail-open true）。
- 测试命令必须带 `--conditions=browser`（desktop AGENTS.md：否则 solid-js 解析到 server.cjs，effect 假绿）。
- 手跑单文件：`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test <file>`（在 `packages/desktop` 下）。

## Review Focus

- **标记泄漏**：桌面所有显示面（用户气泡、队列条、输入栏、字幕条）不得出现 `[语音输入]`；历史重载后气泡仍干净（首个非 synthetic part 规则 + content 顺序）。
- **回声环**：TTS 播放期间 final 被丢弃——若无此防线，外放时 agent 会听到自己并无限自言自语。
- **auto-send 误触**：用户手动敲键盘必须取消计时；停止保留文本不发送；partial 取消后续接。
- **双播**：不得给 duplex 回复另挂 autoplay/第二 effect；一切自动播放仍收敛在既有 effect。
- **legacy 回归**：flag 关闭时麦克风/语音消息/媒体指针链路行为不变。

## File Structure

- Create `packages/desktop/src/renderer/mafw/chat/voice-origin-marker.ts`（+ `.test.ts`）
- Create `packages/desktop/src/renderer/mafw/chat/duplex-auto-send.ts`（+ `.test.ts`）
- Modify `packages/desktop/src/renderer/mafw/chat/use-duplex-voice.ts`（+ `.test.ts`：`onFinal` dep）
- Modify `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`（+ `.test.ts`：`voiceOrigin` 各路径）
- Modify `packages/desktop/src/renderer/mafw/components/turn-queue.ts`（+ `.test.ts`：`voiceOrigin` flag）
- Modify `packages/desktop/src/renderer/mafw/queue-store.ts`（`queueItemText` 剥离标记）
- Modify `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（接线 + 停止停播放 + config）
- Modify `packages/desktop/src/renderer/mafw/components/DuplexVoiceBar.tsx`（`pendingSend` 提示）
- Modify `packages/desktop/src/renderer/mafw/mafw.css`（提示样式）
- Modify `packages/desktop/src/renderer/mafw/components/duplex-voice-wiring.test.ts`（源码契约）
- Modify `AGENTS.md` §5.21

---

### Task 1: 语音来源标记纯模块

**Files:** Create `chat/voice-origin-marker.ts` + `chat/voice-origin-marker.test.ts`

**Interfaces（Produces）:**
```ts
export const VOICE_ORIGIN_MARKER_TEXT: string   // 单行，[语音输入] 开头
export function hasVoiceOriginMarker(text: string): boolean
export function stripVoiceOriginMarker(text: string): string   // 去掉标记行 + 收尾空白
export function appendVoiceOriginMarker(text: string): string  // "\n\n" + 标记（幂等：已有则原样）
```

- [ ] **Step 1（失败测试）**：`strip` 去掉尾部标记行并 trim；纯标记 → 空串；无标记原样；多次/中间出现也剥离；`append` 幂等；`has` 前缀判存。约 6 用例。
- [ ] **Step 2** 跑单文件确认 FAIL。
- [ ] **Step 3** 最小实现（正则 `/\n*\[语音输入\][^\n]*/g`）。
- [ ] **Step 4** 单文件 PASS。
- [ ] **Step 5 Commit**: `feat(desktop): add voice-origin marker helpers`

### Task 2: duplex 自动发送控制器（纯模块，注入 timer）

**Files:** Create `chat/duplex-auto-send.ts` + `chat/duplex-auto-send.test.ts`

**Interfaces（Produces）:**
```ts
export const VOICE_AUTO_SEND_DELAY_MS = 1200
export interface DuplexAutoSendDeps {
  delayMs?: number                                   // 缺省 VOICE_AUTO_SEND_DELAY_MS
  autoSendEnabled: () => boolean                     // voice.duplexAutoSend（缺省 true）
  isSpeaking: () => boolean                          // ttsSpeaking()，回声防线
  appendFinal: (text: string) => void                // 追加进 composer
  send: () => void                                   // fire sendMessage({voiceOrigin:true})
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown
  clearTimeoutImpl?: (t: unknown) => void
  onArmedChange?: (armed: boolean) => void
}
export function createDuplexAutoSendController(deps): {
  handleFinal(text: string): void    // 空文本忽略；isSpeaking → 丢弃（echo 防线）；否则 appendFinal + arm
  handlePartial(): void             // 取消计时（文本保留）
  handleManualInput(): void         // 取消计时（用户在编辑）
  handleStop(): void                // 取消计时（停止收音；文本保留）
  armed(): boolean
  dispose(): void
}
```

- [ ] **Step 1（失败测试）** ≥10 用例：final→append+arm；到期→send 一次；partial/手动输入/停止取消；`isSpeaking` 时 final 丢弃且不 append；`autoSendEnabled:false` 时只 append 不 arm；新 final 重 arm（旧 timer 清）；空/空白 final 忽略；dispose 清 timer；`onArmedChange` 翻转。fake timer 数组实现。
- [ ] **Step 2** FAIL → **Step 3** 实现 → **Step 4** PASS。
- [ ] **Step 5 Commit**: `feat(desktop): add duplex voice auto-send controller`

### Task 3: `useDuplexVoice` 暴露 `onFinal`（每 final 恰一次）

**Files:** Modify `chat/use-duplex-voice.ts` + `chat/use-duplex-voice.test.ts`

**Interfaces:** `DuplexVoiceDeps.onFinal?: (text: string) => void` —— 在 `onFinal` 信号处理内、`setFinalText` 后调用；空文本跳过；generation guard 生效（旧代不回调）。向后兼容（可选 dep）。

- [ ] **Step 1（失败测试）** +2：final 触发一次且带原文；空文本不触发；stop 后旧代 final 不触发（复用既有 fake deps 模式）。
- [ ] **Step 2** FAIL → **Step 3** 实现（hook 内一行调用 + 空值守卫）→ **Step 4** PASS（单文件 + 既有 use-duplex-voice 全绿）。
- [ ] **Step 5 Commit**: `feat(desktop): expose duplex onFinal callback`

### Task 4: `sendMessage` 的 `voiceOrigin` 各路径 + 队列显示剥离

**Files:** Modify `chat/use-send-message.ts`（+ `.test.ts`）、`components/turn-queue.ts`（+ `.test.ts`）、`queue-store.ts`

**Interfaces（Produces）:**
```ts
sendMessage(mode?: "send" | "queue", opts?: { voiceOrigin?: boolean })
// 纯函数（可单测）：
export function composeVoiceOriginParts(ts: number): { type: "text"; id: string; text: string; synthetic: boolean }
export function busyQueuedText(text: string, voiceOrigin: boolean): string   // 追加内联标记（幂等）
```
- QueuedTurn 增 `voiceOrigin?: boolean`；`flushQueue` 命中时 `sendMessage("send", { voiceOrigin: true })`。
- 空闲路径：`voiceOrigin && !techLead && 非 slash` 时 parts 追加 synthetic 标记 part；`message`/`bodyMessage` 保持干净（不加内联）。
- busy 分支：steer/网关队列 `queuedText = busyQueuedText(...)`；local-queue `enqueueTurn({ ..., voiceOrigin })`。
- slash 命令路径忽略 voiceOrigin；Tech Lead 路径不标记（文本原样）。
- `queueItemText` 出口套 `stripVoiceOriginMarker`（网关队列条不显示标记行）。

- [ ] **Step 1（失败测试）** ≥7：`composeVoiceOriginParts` 形状/synthetic/单行；`busyQueuedText` 追加幂等；`queueItemText` 剥离；turn-queue `voiceOrigin` 透传（enqueue/flush 语义既有用例旁新增）。use-send-message 侧用源码断言（sendMessage 含 `opts?.voiceOrigin` 分支）+ 既有集成模式。
- [ ] **Step 2** FAIL → **Step 3** 实现 → **Step 4** 单文件 PASS。
- [ ] **Step 5 Commit**: `feat(desktop): carry voice-origin marker across send paths`

### Task 5: ChatPane 接线 + 字幕条提示 + 配置

**Files:** Modify `components/ChatPane.tsx`、`components/DuplexVoiceBar.tsx`、`mafw.css`、`components/duplex-voice-wiring.test.ts`

**接线（Produces）:**
- `useDuplexVoice` 第三参传入 `onFinal: (t) => controller.handleFinal(t)`；控制器 `appendFinal = (t) => setInput(prev => prev ? prev + "\n" + t : t)`；`send = () => void sendMessage("send", { voiceOrigin: true })`；`isSpeaking = () => ttsSpeaking()`。
- `autoSendEnabled`：mount 时 `window.api.mafw.config.get("voice.duplexAutoSend")`，非 `false` 即 true（fail-open）。
- `createEffect`：`duplexVoice.partial()` 非空 → `controller.handlePartial()`；textarea `onInput`（既有处理处）→ `controller.handleManualInput()`；`handleMicClick` 的 `stop_duplex` 分支加 `stopActivePlayback()`；`onCleanup(controller.dispose)`。
- `DuplexVoiceBar` 新 prop `pendingSend?: boolean` → 显示 `将自动发送…`（`role="status"` 内，无新组件体系）。

- [ ] **Step 1（失败测试）**：`duplex-voice-wiring.test.ts` 源码契约 +4：ChatPane 含 `createDuplexAutoSendController`/`handleFinal` 接线/`stopActivePlayback` 于 stop_duplex 分支/`voice.duplexAutoSend` 读取；DuplexVoiceBar 含 `pendingSend`。
- [ ] **Step 2** FAIL → **Step 3** 实现 → **Step 4** 目标 PASS + `npm test`（desktop 全量）+ `npx tsgo --noEmit -p tsconfig.json` + `npx electron-vite build` rc=0。
- [ ] **Step 5 Commit**: `feat(desktop): wire duplex auto-send voice loop`

### Task 6: 文档

- [ ] `AGENTS.md` §5.21 追加 Plan 2 段（ASCII 安全插入，避免历史替换字符坑）：final→输入栏→`voice.duplexAutoSend`（默认 true）→`[语音输入]` synthetic 标记→`mafw_media_speak` 自动回复→`ttsSpeaking` 回声防线；Tech Lead/slash 不标记；切片 B 落地后指令将改向。
- [ ] spec 状态改「已批准实施」（用户确认后）。
- [ ] Commit: `docs: record voice plan2 loop`

---

## Final Verification

- [ ] `cd packages/desktop && npm test` 全绿，记录新增用例数与全量数。
- [ ] `npx tsgo --noEmit -p tsconfig.json` rc=0；`npx electron-vite build` rc=0。
- [ ] `git diff --stat` 仅含本计划文件 + AGENTS.md。

### Real smoke（gateway 3000 + WSL sidecar 3911 + dev Desktop，必做后才算交付）

1. 打开会话点麦克风 → 说话 → final 文本**出现在输入栏**；字幕条正常。
2. 1.2s 静默后**自动发送**；用户气泡无 `[语音输入]` 字样；继续说话可取消（新 partial 覆盖计时）。
3. agent 简短口语化回答并调 `mafw_media_speak` → **自动播放**；`AudioReply` 卡出现在回复下方；无双播。
4. 播放期间说话 → 输入栏**无变化**（回声防线）；播放结束后说话恢复正常。
5. 播放中点麦克风 → 收音与播放**同时停**；未发送文本保留。
6. 手动敲键盘（计时窗口内）→ 取消自动发送，文本保留可手改。
7. `~/.mafw/config.yaml` 设 `voice.duplexAutoSend: false` 重启 → final 只填输入栏，不自动发送。
8. 重启 dev app 重载会话 → 历史用户气泡仍无标记。
9. agent 忙时语音（steer/队列）→ 队列条无标记行；回合结束后回复为文本（无语音，符合 D7 记录）。
10. `voice.duplexV1: false` → legacy 录音路径行为不变。
11. 全程 0 控制台错误（renderer-console.log 复查）。
