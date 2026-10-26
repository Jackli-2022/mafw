# Batch 6 — Thinking/Effort 控制面 + Signature 保真（Design）

> 日期：2026-10-26 · 状态：已实施（v4.34.0）
> 上游：Tier 1 #5（`06-gap-synthesis.md`）——thinking/effort 控制面 + signature 保真（收敛 6/6，MISSING/高）。

## 1. 意图与为什么

当前 MAFW：

- prompt 面只有 `variant` 在契约里（opencode adapter 已用于 model variant），但 HTTP/SDK/preload 不暴露，调用方无法按回合控制推理档位；
- Pi 原生支持 `thinkingLevel`（`off|minimal|low|medium|high|xhigh|max`）且 `AgentSession.prompt` 接受该选项，但 MAFW 不透传；
- Pi thinking block 的 `thinkingSignature` 在 `normalizePiMessages` 中**被丢弃**；严格校验模型（Gemini/Anthropic）多轮回放签名缺失会导致请求被拒或推理连续性丢失；
- 归一化 DTO 的 reasoning part 已有 `signature?`（canonical-types），但 SDK 的 `SessionMessagePart` 不暴露，历史消费方类型面对签名不可见。

本批把“推理档位”做成显式 prompt 选项、把 signature 做成 additive DTO 字段并在 Pi 历史归一化中保留。opencode 原生用 model `variant`，pi 原生用 `thinkingLevel`；MAFW 不负责把两者互译（runtime-specific 选项各走各的）。

## 2. 目标 / 非目标

**目标**

1. `SessionPromptOpts.thinkingLevel?`（Pi 原生七档）；`SessionPromptOpts.variant?` 已存在但补齐 HTTP/SDK/preload。
2. `POST /api/session/:id/promptAsync`（及 sync `prompt` 若适用）接受并透传 `thinkingLevel`/`variant`。
3. SDK/preload `promptAsync` body 增加 `thinkingLevel`/`variant`；队列 item 保存并在 flush 时透传。
4. Pi runtime：`setThinkingLevel` + prompt opts；busy/消息路径也生效。
5. Signature：
   - `MafwPartBase.signature?` / `native?` additive；
   - Pi `thinkingSignature` → reasoning part `signature`；
   - SDK `SessionMessagePart.signature?` / `native?`；
   - 历史/SSE 不被清洗（现有 raw part 透传已满足，补测试）。
6. 全量测试/build/部署。

**非目标**

- 不做 desktop/TUI 的 thinking 档位选择器（后续 UI）。
- 不做 opencode `thinkingLevel`→variant 自动映射（没有可靠通用映射；调用方选 variant）。
- 不做 thinking token budget 参数（Pi 有 budgets，但本批只做档位；避免范围膨胀）。
- 不改 reasoning 渲染；只保证字段可达。
- 不做 signature 生成/校验（由 runtime/provider 负责）。

## 3. 契约

```ts
type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface SessionPromptOpts {
  // existing
  variant?: string;
  thinkingLevel?: ThinkingLevel;
}
```

- Pi：`promptAsync`/`prompt` opts 增 `thinkingLevel`；`buildPiPromptOpts` 传入；进入前 `setThinkingLevel`（兼容 busy `sendUserMessage`）。
- OpenCode：`variant` 经现有 `switchModel` 路径；`thinkingLevel` 不映射（runtime-specific）。
- Queue：`QueuedItem.thinkingLevel/variant`；HTTP 入队、`interceptQueuePrompt`、flush 全链保留。
- Signature DTO：
  ```ts
  MafwPartBase { signature?: string; native?: Record<string, unknown> }
  SessionMessagePart { signature?: string; native?: Record<string, unknown> }
  ```
  `MafwPart` reasoning 已有 `signature`，移到 base；不改变 wire 形状。

## 4. 失败模式

- runtime 不支持 `thinkingLevel`：忽略（opencode）/ 传 pi 原生。
- 非法档位：HTTP 面校验 400（避免 runtime 报错）；队列同样拒绝。
- `variant` 为空字符串：忽略。
- Pi `setThinkingLevel` 抛错：fail-open，继续 prompt（记录 warn？仅 runtime 层）。
- signature 缺失：字段 optional，不影响渲染。
- queue flush 丢档位：用同一 `sendOpts` 对象透传；测试钉扎。
- 旧 SDK/客户端不带字段：additive，无破坏。

## 5. 验收

1. Pi unit：`thinkingLevel` 进入 prompt opts / `setThinkingLevel`；busy 路径也设置。
2. Pi history unit：`thinkingSignature` 出现在 reasoning part.signature。
3. Adapter unit：`promptAsync({variant:'high'})` 调 `/session/:id/model` body variant。
4. Gateway HTTP/SDK：promptAsync body 含 thinkingLevel/variant；queue item 保留并在 flush 发送。
5. SDK/desktop tsgo；全量 gateway/desktop/SDK/session-ui/TUI；根 build；本机部署。

## 6. 实施记录

- 契约/SDK/preload：`ThinkingLevel` + `thinkingLevel`/`variant` prompt 字段；`SessionMessagePart.signature/native`；队列 `QueueItem` 同步。
- Pi：`setThinkingLevel` + prompt opts；`thinkingSignature` → reasoning part.signature。
- Gateway：promptAsync/prompt 校验并透传；queue 入队/flush 保留；opencode 走既有 model `variant`，pi 走 `thinkingLevel`。
- Canonical：`MafwPartBase.signature/native` additive。
- 单测：gateway 2617、SDK 147、TUI 225（224 pass / 1 skip）、session-ui 89；desktop 全量 1445（共享工作区含并行 TerminalDock 用例）。
- 已知边界：本批不做 UI 档位选择器；opencode 的 `thinkingLevel` 不映射（用 variant）；signature 只做保真不做校验。
