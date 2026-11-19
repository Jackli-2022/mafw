# 2026-11-19 · 上下文圆环：不在回合开始时掉 0，hover 只留三项

- **版本**：`v5.1.0`（桌面交互修复，不升版本号）
- **提交**：`0e5821f2a`
- **范围**：desktop renderer composer 上下文圆环；gateway / runtime 契约零改动
- **依据**：dev app live 验证 + desktop 全量测试

## 问题

- 新回合开始后，圆环会从上一轮的占用掉到 **0%**，整轮生成期间都显示 0%。
- hover tooltip 把上下文占用与会话累计（输入 / 输出 / 推理 / 缓存 / 费用 / 回合）拼在一起，
  信息过载。

## 根因

- `contextUsage` 取 `store.message[sid]` 最后一条 assistant 的 `tokens`；新回合的 assistant
  骨架只有 `id / role / model / time`，`tokens` 要到完成帧才回填。
  `computeContextUsage(undefined, window)` 得到 `used=0`，圆环与 tooltip 都变 0%。
- 会话累计与上下文占用是两个口径，之前共用一个 tooltip。

## 现状

- `latestContextTokens(messages)` 从后向前找最近一条 `used > 0` 的 assistant tokens：
  新回合期间保留上一轮占用，回合结束后再随 tokens 更新；全零 tokens 视为未测量。
- 圆环 tooltip 只显示一行：**`上下文占用：已用/容量(比率)`**，例如
  `上下文占用：206k/1M(20%)`；窗口未知时显示 `上下文占用：206k（容量未知）`。
- 标题栏的会话累计 badge 不变（仍是输入 + 输出 + 推理 + 缓存与费用）。

## 验证

- 新增 **5** 条单测：`latestContextTokens` 4 条（跳过流式骨架、取最近一条已测量、全零跳过、
  空输入 / 只有 user），以及 2^20 窗口格式化为 `1M` 而不是 `1.0M`；`formatContextUsage`
  的 tooltip 断言同步更新。
- desktop 全量：**4170 pass / 0 fail**（基线 4165）。
- `tsgo --noEmit -p tsconfig.json`：通过。
- `electron-vite build`：通过（46.6s）。
- live：Lead 会话圆环 **20%**（不再为 0）；hover 文本
  `上下文占用：206k/1M(20%)`。
