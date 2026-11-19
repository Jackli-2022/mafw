# 2026-11-20 · Session Recall Quality P1 Shadow Pilot

## 交付标识

- 基线：`2eab90633`
- 代码提交：**`f36426e22`**（本地 main，未 push）
- 实施与 review：`gateway/volcengine/deepseek-v4.1-flash`
- 生产改动：**无**；未 build/restart，Gateway 行为不变
- 计划：`docs/superpowers/plans/2026-11-19-session-recall-quality-p1-shadow.md`
- 结果：`docs/research/2026-11-19-session-recall-p1-shadow-results.md`

## 1. 实现

新增四臂冻结对照：

- `snapshot-current`：真实 P0 snapshot decision + 当前轮 adapter；
- `current-query-off`：保留 decision/FOK，仅绕过当前轮 adapter；
- `live-frozen`：消费冻结的 live API block，不在 runner 中请求 Gateway；
- `topic-facet`：exact evidence 旁路，否则要求 TopicState entities/aliases/retrievalKeys 领域支持 AND raw query 支持。

同时加入：

- TopicState 填充率与陈旧风险审计；
- 无词元领域项不作证据；
- live 空 topic 壳不记作 memory serve；
- 缺失 live capture 不进入分母；
- 冻结 snapshotConfig、代码 fingerprint、未知顶层字段拒绝和 fixture→baseline 一致性门。

没有生产 route、FOK、lexical veto、containment 或 snapshot 准入改动。

## 2. Pilot 结果

| 臂 | useful anchor precision | answer coverage | false display | legitimate suppression | T1 repeat |
|---|---:|---:|---:|---:|---:|
| snapshot-current | 25.0%（2/8） | 1/1 | 2/2 | 0/2 | 3/3 |
| current-query-off | 25.0%（2/8） | 1/1 | 2/2 | 0/2 | 4/4 |
| live-frozen | 66.7%（2/3） | 1/1 | 0/2 | null | null |
| topic-facet | 33.3%（2/6） | 1/1 | 2/2 | 0/2 | 3/3 |

注意：

- 跨臂分母不同，不能把 25→33→66.7 直接当成同池排名改善；
- Topic/facet 的分子仍是同 2 个有用 anchor，只是少展示 `q15k2p`；
- 两个控制的 false display 仍为 **2/2**，残余 noise 来自真实领域词面重叠；
- live 两个控制没有展示任何指针，属于空判，不是质量胜利；
- live capture 是 later same-text，且未设置 topic，不是同 turn 反事实。

## 3. 判定：redesign，不上线

当前 Topic/facet 只减少噪声数量，没有证明有用性提升，也没有消除控制误展示。TopicState 的 summary 仍含旧“误注入已清零 / implicit 2/10”，不能作为当前事实源。

因此：

1. 不建议把当前 Topic/facet 规则接入生产；
2. 不以提高 serve 率为目标；
3. 下一次先重新设计 subject/predicate/task-link 与 same-turn capture，再决定是否扩样；
4. `live-frozen` 与 `falseDisplay` 的“未服务 vs 干净服务”口径需在下一轮拆分。

## 4. 验证

- **新增测试：50 个**（Task 1 32 + Task 2 18）；
- 父会话 focused：**81 suites / 703 tests，703 passed**；
- Gateway typecheck：exit 0；
- P0 baseline 同命令重跑：**byte-identical**，SHA `c56b4b02…`；
- P1 shadow baseline 同命令重跑：**byte-identical**，SHA `801fb6fd…`；
- 最终跨任务 review：Ready Yes，无数值/生产阻塞；
- 全量 suite 本轮在 15 分钟超时前未产生最终汇总，**不将其计作通过或失败**；上一份有效全量记录为 8651 passed / 7 failed / 2 skipped。

## 5. 当前状态

P0 四项数值与生产行为均未改变。本切片的价值是证伪“简单 Topic/facet 即可上线”并留下可复现的离线对照。

代码、fixture、计划、结果与本文档已提交；代码与测试提交为 `f36426e22`，未 push。
