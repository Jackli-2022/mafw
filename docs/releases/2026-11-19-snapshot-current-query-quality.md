# 2026-11-19 · Snapshot 当前轮质量门

## 交付标识

- Gateway：**v5.1.0**
- 代码提交：**`9c8d9a367`**
- 计划：`f747b454a` / `docs/superpowers/plans/2026-11-19-snapshot-current-query-quality.md`
- 运行验证：Gateway v5.1.0，PID 56208，health `ok`
- 全部实施与 review 子代理：`gateway/volcengine/deepseek-v4.1-flash`
- 本地 main，未 push。

## 1. 修复的问题

用户给出的真实误召回中，当前任务是记忆召回性能优化，短指令“再分析一下”却服务了旧 snapshot：

- 子代理 DeepSeek 偏好；
- 一般流程偏好；
- 五家 Agent / Desktop UX 调研；
- bash 缓存路径错误；
- 3 条重复 DeepSeek T1。

根因不是 FOK 本身，而是：

> FOK 验证的是 snapshot 的滚动窗口 query；serve 时只有 containment，没有验证这些候选是否仍支持当前 query。

## 2. 实现

新增 `gateway/src/recall/snapshot-current-query.ts`：

1. 仅对 `decideSnapshotUse='use'` 且 FOK=`inject` 的 snapshot 生效；
2. 复用 `selectLexicallySupportedCandidates`，比较当前 query 与 Harmonic/T1 metadata；
3. 无 query units 或零当前支持：`snapshotDecision='current-query-filter'`，回 live fallback；
4. 实际过滤时：
   - 只保留受支持 anchor；
   - 邻居必须独立受支持且 anchor 保留；
   - 用 `formatRecallContext` / `renderT1Lines` 确定性重渲染；
   - T1 与**实际渲染的 Harmonic 标题**共享长度 ≥12 ASCII 标识短语时去重，未渲染 cue 不得删除 T1；
5. 未过滤任何内容：原 block 逐字保留，不丢失额外 anchor / gist hint；
6. legacy 无结构化 metadata 快照保持旧行为至 TTL；episodes snapshot 暂回 live；
7. filtered block/ids/memories/t1Hits 贯穿曝光、FOK sample 和 receipt。

snapshot metadata 增加 optional `cue_anchors`，旧快照无需迁移。FOK、live fallback、note-board、固定 40 条和 snapshot build 调度均未改。

## 3. 验证

- **新增测试：18 个**；
- 真实 RED→GREEN：
  - 初始模块缺失与 route 原样服务旧块；
  - 修复轮 cue-only T1 误删、配置预算、无过滤重渲染、legacy 引用等 4 个失败；
- 最终 focused：**77 suites / 606 tests，606 passed**；
- 额外 route-wide regression：89 suites / 767 tests 全通过；
- Gateway `npx tsc --noEmit -p tsconfig.json`：exit 0；
- `npm run build`：成功；
- 独立 review + scoped re-review：均 Approved。

## 4. 固定 40 条回归

部署后三次 live 测量均为：

| 指标 | 结果 |
|---|---:|
| AUTO hit | 17/30 |
| exact / current / implicit | 10/10 / 6/10 / 1/10 |
| false injection | 0/10 |
| stale injection | 0 |
| agreement | 25/30 |

固定 40 条不带 sessionID，因此只证明 live fallback 未回退；snapshot 行为由新增纯函数与 route 集成测试覆盖。

本切片不把延迟作为收益：重启后后台任务和冷启动导致三轮 AUTO p95 分别为 951/992/849ms，和此前 181ms 不可比。该现象应交给已定位的“边界请求 foreground 保护 / 后台构建隔离”切片处理，不能归因到当前 snapshot 质量门。

## 5. 残留

- 全量 suite 未在本切片重跑；共享 main 仍有此前记录的 runtime/transport/pod 非本切片失败。
- 当前轮过滤可能让语义改写但零词面支持的 snapshot 回 live，降低 serve 率，但不会展示错误块。
- episodes snapshot 尚不支持过滤，直接回 live。
- legacy 无结构化 metadata 快照在 TTL 内仍按旧逻辑服务。
- `graph/expansion` stage 仍未接线；metrics 读出口仍待补。
- 100ms 契约未达标，需单独处理后台并发与 foreground 保护。

## 6. 后续

1. 把用户这条误召回纳入 session-shaped 质量基准，统计 snapshot anchor/neighbor/T1 precision；
2. 为 snapshot serve 增加采样 shadow live 对比，防止过度过滤；
3. 补 `GET /api/recall/metrics` 读出口；
4. 先修边界请求 foreground 保护与 index scan scheduler 隔离，再提高 snapshot serve 率。
