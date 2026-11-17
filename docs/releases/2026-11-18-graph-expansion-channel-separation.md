# 2026-11-18 · Graph Expansion Channel Separation

- **分支**：`main`
- **代码提交**：`465a97926`
- **前序**：`docs/releases/2026-11-17-retrieval-path-parity.md`
- **实现与复核**：`gateway/volcengine/deepseek-v4.1-flash` 子代理实现；独立同模型 reviewer 审查；父会话复跑全量门禁并上线实测。

## 根因

Retrieval Path Parity 将 REST `/api/memory/search` 切到共享 `memoryService.harmonicIndex` 后，也启用了 boot 时挂载的 anchor/coactivation 图。此前每请求新建的 index 没有图状态，因此这不是单纯的路径等价替换。

`HarmonicIndexManager.searchScored` 的 PPR 与 legacy 图扩展把新增 graph-only 候选写成 `score: gs, graphScore: gs`。后续 `nbv=norm(score)` 与 `ngv=norm(graphScore)` 让同一个图分同时占用 BM25 与 graph 两个通道，graph-only 邻居可达到 `0.85×1 + 0.15×1 = 1.0`，压过真实字面命中。

只读 A/B 排除了索引字段漂移、配置差异与 REST enrichment：fresh index 挂 live 两张图时可复现 live REST 50/50 结果重合；禁图则得到磁盘直查排序。

## 修复

1. **核心通道分离**
   - PPR 与 legacy 的新增 graph-only 候选改为 `score: 0, graphScore: gs`。
   - graph-only 不再压过最强字面 seed，主要承担尾部补全；弱尾部 seed 仍可能被图候选超过，这是保留关联扩展的既定语义。
   - PPR 遇到 `scored` 中已有词面候选时只追加/更新 `graphScore`，不覆盖其 lexical `score`；包括未进入 `candidateCap` seed 窗口的候选。

2. **REST 原始索引面**
   - `/api/memory/search` 显式传 `graphExpand: false`，恢复 parity 前无图排序语义，结果不再依赖 boot 是否挂载图存储。
   - MCP / boundary recall 仍按各自路径消费图扩展；本次未改 FOK、top-k、recency、note-board 或记忆生产管线。

## 新增测试（6 个）

- PPR：graph-only 可尾部补全，但不能压过最强字面 seed。
- legacy：同上。
- PPR：已有词面候选即使超出 seed 窗口，也不被图分覆盖。
- REST：共享 index 显式使用 `graphExpand:false`（补既有用例断言）。
- REST：路由行为不会返回 graph-only 扩展项。

TDD 证据：

- 核心通道测试修复前 2 个排序用例 FAIL，修复后 4/4 PASS。
- cap 外词面候选用例修复前分数掉到 `0.15`，修复后高于 graph-only 档。
- REST 行为与契约断言修复前 FAIL，修复后 PASS。

独立 review 为 **APPROVE**，无 Critical；review 指出的 PPR 已有候选覆盖问题与测试/文档表述已在交付前补齐。

## 验证

- 父会话定向复跑：**6 suites / 35 tests，35 passed**。
- 子代理相关回归：**235 suites / 1655 tests，全部通过**。
- Gateway 全量：**1033 suites / 8209 tests；8207 passed，2 skipped，0 failed**。
- 相比上一版 8203 tests，正好新增 6 个。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- Build：通过；热重启 `pid 12360 → 45196`，health `ok`。
- 所有提交均未 push。

## 线上真实效果

运行：`node evaluation/mafw-identifier-probe.js 40`。

| 指标 | 修复前 live | 修复后 live |
|---|---:|---:|
| exact hit@1 | 3% | **53%** |
| exact hit@10 | 3% | **78%** |
| exact hit@50 | 13% | **78%** |
| split hit@1 | 0% | **35%** |
| split hit@10 | 3% | **75%** |
| split hit@50 | 10% | **75%** |

四个场景的修复后表现：

- `Proactive Topic Recall 主题工具设计`：相关目标进入 REST 第 4 / 第 10；MCP 从 `FOK=no-memory, top1prob≈0.0089` 变为 `FOK=inject, top1prob≈0.9930`。
- `检索路径 parity 修复上线与质量缺口`：REST 与 MCP 目标均为第 1，自动 recall 也把目标放在第一条。
- `5cd9885f5`：REST/MCP 返回两条相关记忆（新诊断记录第 1，原 parity 记忆第 2），MCP `FOK=inject`。
- 无答案冰岛消费查询：MCP 仍为 `no-memory`，自动 recall 正确显示“相关记忆：无”。

## 尚未解决

- 自动 recall 对旧精确标题与 `5cd9885f5` 仍显示“相关记忆：无”，即使 MCP 已 `FOK=inject`。这与图通道缺陷不同源；下一步应记录 snapshot query、`top1prob/zone` 与候选数，定位快照查询构造、verify/FOK 或 scan containment 的抑制来源。
- 新精确标题的自动 recall 虽已命中目标，但尾部仍夹带 flylink 等弱相关邻居；固定 40 条综合查询与 false-injection / stale-injection 评测仍需实施。
- 本切片证明图通道回归已修复，不宣称完整检索质量达标。
