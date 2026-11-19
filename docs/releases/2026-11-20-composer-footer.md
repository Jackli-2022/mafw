# 2026-11-20 · 输入栏底部信息条（时间 + 会话脉搏）

- **分支**：`main`
- **实现 commit**：`392506b94`

## 布局

- 时间 / 城市 chip 从 composer 上方移到下方最左，composer 随之上移；`mafw-input-area` 总高 162 → 161。
- 底部条改为三段 grid：

  ```text
  [今天 00:47 · 深圳]        [缓存命中 93.9% · 8.0M tokens · 37 tok/s · 42 回合]        [空槽]
  ```

- 中段四项全部来自渲染层已有数据，不新增请求：
  - **缓存命中** = `cacheRead / (input + cacheRead)`，取 `sessionTokenSummary`。
  - **tokens** = 会话累计 `input + output + reasoning + cacheRead`。
  - **tok/s** = 最近一条已完成 assistant 的 `output / (time.completed - time.created)`；
    跳过无 `time.completed` 的骨架消息与 <50ms 的瞬时回合。
  - **回合** = 有 token 统计的 assistant 消息数（与标题栏 token badge tooltip 同源）。
- 指标缺失时整项不渲染，不显示占位 0；新会话只保留左侧时间 chip。
- 右段留空，作为后续「草稿已保存 / 只读 / 排队」等状态的位置。

## 窄栏

- `@container (max-width: 430px)` 隐藏左侧时间 chip，避免被裁成残字；脉搏仍按 grid 居中。
- 实测 696 / 560 / 500 / 440 px 宽度下四项完整、无横向溢出；380 px 时自动收起时间 chip。

## 验证

- Dev app（Lead）：metrics 组中心 **624** = footer 中心 **624**（逐像素对齐）。
- 实际显示：`今天 00:47 · 深圳` + `缓存命中 93.9% · 8.0M tokens · 37 tok/s · 42 回合`。
- 截图与 380 px 窄栏检查通过。

## 门禁

- desktop 全量：**4240 / 4240 pass，0 fail（803 suites）**；本批新增 4 个用例
  （`composer-footer-metrics` 3 + footer 结构 1）。
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0，42.13s
