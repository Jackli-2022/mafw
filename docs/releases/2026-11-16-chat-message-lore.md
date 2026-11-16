# 2026-11-16 · Chat 消息内容里的 Lore 身份与双方时间

- **版本**：`v5.1.0`（视觉修订，不升版本号）
- **提交**：`66d241a8`
- **范围**：desktop 消息流 + `@mafw/session-ui` 通用回合时间 / 用户消息操作组；
  gateway / SDK / runtime 零改动
- **取代**：`docs/releases/2026-11-16-chat-header-lore.md`（Lore 不再放标题栏）

## 现状

- Chat 标题栏恢复「会话首字母 + 会话标题」；Lore 身份只出现在 assistant 回复内容里。
- 每个 assistant 回合上方一行 `[Lore 头像] Lore · 回合时间`：
  - 头像复用 `packages/desktop/src/renderer/mafw/assets/lore/lead-avatar-20.png`（16px）；
  - 正文不缩进，身份行绝对定位在回合顶部，只预留 22px 高度；
  - 身份行是桌面壳层 CSS 注入，session-ui 不感知 Lore。
- 用户消息气泡右下角常显时间；hover / focus 时，复制 / 回退 / 审阅 / fork 按钮在
  时间的位置出现并覆盖时间，不改变气泡或时间的布局位置。
- 只有附件、没有文字的用户消息也会显示时间（`copy-wrapper` 的渲染条件包含 `stamp()`）。

## 实现

- `packages/session-ui/src/components/session-turn.tsx`
  - 新增通用 `assistantTime` memo（第一条 assistant message 的 `time.created`，
    `timeStyle: "short"`）；
  - 在 `session-turn-assistant-content` 上输出 `data-turn-time`；品牌相关样式仍只在桌面壳层。
- `packages/session-ui/src/components/message-part.tsx`
  - 用户消息操作按钮收进 `data-slot="user-message-actions"`，让桌面壳层可以把
    整组按钮作为时间位置的覆盖层，而不影响时间排版；
  - `copy-wrapper` 在 `text() || stamp()` 时渲染，附件-only 消息也有时间。
- `packages/desktop/src/renderer/mafw/mafw.css`
  - assistant 身份行 `::before`：`content: "Lore · " attr(data-turn-time)`；
  - 首段清除 `text-part` 的 12px 顶距，身份行 18px + 4px 间距；
  - 用户时间常显、操作按钮绝对定位覆盖，全部走 `--dur-1` / `--ease` token。

## 真机验证

- assistant 头行实测：`::before` 内容为 `"Lore · 12:55 PM"`，顶部 0、高 18px，
  assistant 容器 `padding-top: 22px`。
- 用户时间实测：`user-message-meta-tail` 文本 `12:55 PM`，右缘与消息列右缘一致
  （764 == 764）；hover 时操作组覆盖同一位置（宽约 102px，高 24px），不产生横向位移。
- 12:55 PM 同时出现在用户气泡右下与 assistant 头行。

## 测试与门禁

- desktop 全量：**3896 / 3896** pass（738 suites）
- `chat-lore-mark.test`：5 → **7** 个用例（新增 assistant 头行 / 用户时间 & 操作覆盖契约）；
  删除已失效的 `chat-header-lore.test` 2 个用例
- `@mafw/session-ui` typecheck：rc=0
- desktop `npx electron-vite build`：rc=0
- desktop `tsgo`：被并行 memory episode / SDK 改动阻断
  （`EpisodeHit` / `MemoryEpisodesOptions` / `T1EpisodeRecord` 未导出）；
  本次涉及文件无类型错误
- 未 push、未合并远端

## 边界

- assistant 时间是回合内第一条 assistant message 的创建时间；同一回合内后续工具步骤不重复显示。
- 身份行时间由 CSS `attr()` 渲染，不进入文本选区；如果需要可复制的时间，可改成真实的
  `<time>` 节点（session-ui 已提供 `data-turn-time`，迁移成本很低）。
- 语音消息走 ChatPane 的独立 `mafw-voice-turn`，不在 `SessionTurn` 内，暂不显示该时间行。
