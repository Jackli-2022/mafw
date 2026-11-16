# 2026-11-16 · Desktop `/` 指令运行时能力门

- **版本**：desktop `5.1.0`（未 bump）
- **Commit**：`6b8e96d3`
- **范围**：Desktop Chat `/` 菜单 + Experience contract

## 背景

`/` 菜单此前对所有 runtime 显示同一组命令。依赖 runtime surface 的命令在不支持的
runtime 上会返回 503、打开空面板或显示内部 surface 名。本批按 Experience 能力
置灰，而不是按 runtime 名分支。

## 交付

- `CommandItem` 增加 `disabled` / `disabledReason`；`CommandPicker` 渲染「不可用」
  行并阻止 Enter / 点击执行。
- 新增 `chat/command-availability.ts`：把命令映射到能力位，返回中性不可用原因。
- ChatPane 按 Experience 能力置灰：
  - `/compact` → `session.summarize`
  - `/fork` → `branch.fork`
  - `/diff` → `branch.diff`
  - `/undo` → `branch.revert` 或 `checkpoint.restore`
  - `/redo` → `branch.unrevert`
  - `/rename` → `session.rename`
  - `/plan` / `/build` → `MafwAgent.planning` / `default`
  - `/skills` → `session.discovery`
  - `/pause` → `run.control`
- Experience 尚未 ready 时不把未知状态当作“不支持”，避免切会话时 9 行全部闪灰。
- 会话右键 / tab 菜单的 rename 也按 `session.rename` 置灰；tab rename 改为成功后
  才写 entity/tab，失败不留下乐观标题。
- Experience contract 新增 `session.rename` action，映射 `session.update` surface；
  SDK、TUI 标题表、OpenAPI、experience JSON、projector 与契约测试同步。

## 运行时矩阵

| 命令 | opencode | pi | claude |
|---|---|---|---|
| `/compact` | 可用 | 可用 | 可用（adapter 的 summarize 仍是空实现） |
| `/fork` | 可用 | 可用 | 置灰 |
| `/diff` | 可用 | 置灰 | 置灰 |
| `/undo` | 可用 | 可用（无文件回滚） | 置灰 |
| `/redo` | 置灰 | 置灰 | 置灰 |
| `/rename` | 可用 | 可用 | 置灰 |
| `/plan` `/build` | 可用 | 置灰（无 planning/default 标记） | 置灰 |
| `/skills` | 可用 | 可用 | 可用 |

## 验证

- desktop 全量：**3891 / 3891**（738 suites）
- 本轮新增测试：**5**
  - `chat/command-availability.test.ts`：3
  - `tests/command-capability-wiring.test.ts`：2
- gateway 定向：experience contract / action binding / experience JSON **31/31**；
  api-contract **261/261**
- SDK：**239 / 239**
- `gateway tsc --noEmit -p tsconfig.json`：rc=0
- `tsgo --noEmit -p tsconfig.json`（desktop）：rc=0
- `electron-vite build`：rc=0

## 边界

- 未改 runtime adapter；能力门只消费既有 surface / Experience action。
- `/redo` 在三个内置 runtime 都不可用（opencode `revertUndoApi=false`、pi 无 unrevert、
  claude 无 branch API），现在显示为置灰而不是点击后才报错。
- claude 的 `session.summarize` 仍是 surface 存在但空实现；能力门无法仅凭 presence
  区分「实现了但 no-op」，后续应由 adapter 改为真实实现或移除 surface。
