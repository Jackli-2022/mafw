# Phase 5 — 前端 / View DTO 中性化

## Context

Phase 4 已完成运行时驱动与 gateway seam 的中性化。Phase 5 收口客户端面：
View DTO 只承载中性字段，业务 UI 不按 runtime 名/能力位分支，`runtimeName`
仅出现在 Config 诊断页。

## 审计结论（2026-11-11）

- `packages/gateway-sdk/src/view-dto.ts` 已是单一事实源：`VIEW_DTO_FIELD_INVENTORY`
  逐字段钉扎，`native` 被 `@ts-expect-error` 禁止，`view-dto.pin.ts` 编译期覆盖
  所有 DTO；`view-dto.test.ts` 已禁止原生字段。
- session-ui / TUI / desktop mafw 的边界守卫已禁止 `runtimeName` / `runtimeCaps`
  / wire 形状 / `@opencode-ai/sdk` 导入。
- 剩余实际缺口：desktop 乐观消息硬编码 `providerID: "opencode"` 与
  `agent: "general"`（use-send-message / use-voice-binding），属于 runtime 形状
  泄漏到客户端本地 DTO。

## 改动

1. `packages/desktop/src/renderer/mafw/chat/use-send-message.ts`：乐观用户消息
   不再写 `agent`/`model` 原生占位（真实发送仍走选中的 model）。
2. `packages/desktop/src/renderer/mafw/chat/use-voice-binding.ts`：语音乐观消息
   同样去掉 `agent`/`model` 占位。
3. `packages/desktop/src/renderer/mafw/experience-boundaries.test.ts`：新增
   mafw UI runtime 字面量扫描（Phase 4 G5 的 desktop 面）。
4. `packages/gateway-sdk/src/types.ts`：头部/命名空间注释改为 gateway wire
   surface，不再宣称对齐 opencode SDK。

## 门禁

- desktop `npx tsgo -b` 0
- `npm run test:tui`（含 runtime-literal 规则）
- gateway 全量 Jest（已在中性化前通过；本次仅客户端改动）
- `npm run test:desktop`（当前 worktree 的 esbuild 环境问题除外）

## 非目标

- 不删除 gateway-sdk 的 wire/namespace API（仍是客户端协议面，不是 View DTO）。
- 不引入新的 runtime 名白名单；desktop main 的 brand/migration 字符串保持在
  产品层，不进入 mafw 业务面扫描。
