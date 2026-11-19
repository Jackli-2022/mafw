# 2026-11-20 · Chat 贴底 + Lead 外部事件过滤

- **分支**：`main`
- **实现 commit**：`5e209a9b2`

## 1. Chat 滚动条始终顶到底

**现象**：切换会话后聊天停在离底部几百 px 的位置（实测 965px），最后一次消息被 composer 挡住；
窗口被遮挡时更明显。

**根因**：

- 会话 pane 是 keyed remount，`createEffect(() => { if (props.focused) forceAnchor() })` 只在
  focused 变化时锚底，切换 session 不会重新锚定。
- 内容高度增长不只来自 store 文本变化：markdown、图片、工具卡、Lead 收件箱都在首帧后异步撑高，
  旧的 sticky effect 不会重跑。
- Electron 窗口被遮挡 / 最小化时 `requestAnimationFrame` 暂停，只靠 rAF 的贴底逻辑直接失效。

**修复**：

- `forceAnchor` 现在依赖 `[props.focused, sidProp()]`，切会话即回底。
- 新增 `MutationObserver`（childList/subtree/characterData）+ `ResizeObserver`，`pinned` 为真时
  任何 DOM/尺寸增长都重新贴底。
- `schedulePin` 同时排 rAF 与 32ms timer；遮挡窗口仍能贴底。用户向上滚仍会释放（`scrollPinDecision` 不变）。

**验证**：真实 dev app（Lead ↔ 短会话来回切）在 300ms / 700ms / 1.5s / 3s / 6s 采样均为
`scrollHeight - scrollTop - clientHeight = 0`；截图里最后一条消息贴在 composer 上方，滚动条到底。

## 2. Lead「外部事件 · 2 条待处理」实际是 internal 事件

**现象**：Lead 会话一直显示 2 条待处理外部事件，展开后是：

- `decision:dec_9eff1cd5…`「[SELF-TEST] Lead outbox drill 2026-11-16…」（已 shelved）
- `decision:dec_a78dc6ad…`「事件层自检（可忽略）：decision → Lead 播报是否已接通？」（已 shelved）

**根因**：系统 source（`internal` / `cron`）以 `project_dir='*'` 存储，
`events.sources({ projectDir })` 只返回项目 source；`buildLeadExternalInbox` 的 kind 回退成 `'event'`，
`kind === 'internal'` 的过滤失效。

**修复**：识别稳定的系统 source id —— `internal` 过滤，`cron` 保留并在缺行时仍显示 `Cron` 标签。
回归测试覆盖「source 列表为空但 thread.sourceId=internal → 不出现」与「cron → Cron」。

**验证**：reload 后 Lead 会话不再出现「外部事件」条；事件层数据仍在（只是不投影到外部收件箱）。

## 门禁

- desktop 全量：**4233 / 4233 pass，0 fail（803 suites）**（本批净 +4 用例）
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0，41.93s
