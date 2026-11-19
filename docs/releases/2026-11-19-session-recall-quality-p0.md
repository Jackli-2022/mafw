# 2026-11-19 · Session Recall Quality P0：FOK 样本修复与块级基线

## 交付标识

- Gateway：**v5.1.0**
- 基线：**`5b3e52275`**
- 代码提交：**`8e96278b0`**（本地 main，未 push）
- 运行验证：Gateway v5.1.0，PID 52060，instance `37bc83ea-9832-43c6-9034-3191048b74df`，health `ok`
- 实施与 review 子代理：`gateway/volcengine/deepseek-v4.1-flash`
- 计划：`docs/superpowers/plans/2026-11-19-session-recall-quality-p0.md`
- 研究：`docs/research/2026-11-19-recall-quality-improvement.md`

## 1. 生产改动

`filtered === true` 的 snapshot serve 不再把 rolling-window 原 `top1prob` 与过滤后的 ids 写入 serve 期 FOK 样本；未过滤 serve 和构建期样本不变。

曝光、T1 事件、receipt、返回块、FOK/lexical/containment 与 snapshot 当前轮准入均未改变。仅 T1 去重也会保守跳过样本，可能损失少量有效样本，但方向是不写错位数据。

## 2. Session-shaped 评测

新增：

- `gateway/src/recall/session-quality.ts`：真实 `decideSnapshotUse` + `adaptSnapshotToCurrentQuery` 的纯评测器；
- `evaluation/session-recall/fixtures.json`：冻结 3 个 bootstrap case 和 snapshotConfig；
- `evaluation/session-recall/run.ts`：可复现 runner、显式 config override、代码 fingerprint；
- `evaluation/session-recall/baseline.json`：冻结基线；
- `session-quality-runner.test.ts`：fixture→baseline 一致性回归门。

主/安全指标：

- useful anchor precision；
- answer coverage（只认 anchor，neighbor-only 不命中）；
- false display；
- legitimate suppression（只算 served case 的 pre-admission answer/context）。

另报 neighbor precision、T1 repeat、notServed、未标注展示和测量完整性。空分母为 null，不当作满分。

## 3. Bootstrap 基线

**只有 3 条 case，不是公共 benchmark，不能用于调生产阈值。**

| 指标 | 当前结果 |
|---|---:|
| useful anchor precision | **25.0%（2/8）** |
| answer coverage | 100.0%（1/1，只有一个 answerable case） |
| false display | **100.0%（2/2 controls）** |
| legitimate suppression | 0.0%（0/2，信号极弱） |
| neighbor precision | 0.0%（0/2） |
| T1 repeat | **100.0%（3/3）** |

- `quality-negative`：2 个 noise anchor 仍展示；
- `research-negative`：过滤后 3 个 noise anchor 仍展示；
- `model-preference`：2 个正确 anchor + 1 个 noise anchor + 2 个 noise neighbor + 3 条 repeat T1。

因此当前轮质量门能删部分内容，但仍不能证明展示块具备 answerability。`answerCoverage=100%` 仅表示一个 model-preference replay 的 1/1，不能外推。

## 4. 验证

- **新增测试：35 个**（1 + 26 + 8）；
- 父会话 focused：**80 suites / 659 tests，659 passed**；
- 父会话全量：**8651 passed / 7 failed / 2 skipped**；
- 全量剩余 4 个 suite 与上一切片相同：runtime validate-shape / architecture-boundaries / prompt-budget-wiring、architecture legacy-route-inventory，均属共享 main 其他改动；
- Gateway `npx tsc --noEmit -p tsconfig.json`：exit 0；
- `npm run build`：成功；
- runner 同命令、同 generatedAt：**byte-identical**；
- 最终 review 的指纹传递依赖声明残留已裁决：fingerprint 仅作 6 个直接模块的溯源提示，数值回归门才是正确性门。

## 5. 部署后固定 40 条

| 指标 | 结果 |
|---|---:|
| AUTO hit | 17/30 |
| exact / current-state / implicit | 10/10 / 6/10 / 1/10 |
| false injection | 0/10 |
| stale | 0 |
| agreement | 25/30 |

延迟：REST p50/p95 30/40ms，AUTO p50/p95 116/163ms。该轮只作回归，不宣称性能改善。

Artifact：Temp/opencode `personal-recall-session-quality-p0.json`。

## 6. 残留与下一步

1. 扩到 20–50 条 session-shaped case，补 context、stale/conflict、更多 answerable 与合法抑制样本；保持独立 held-out。
2. 新增 case 按协议双人独立盲标；当前 3 条是 bootstrap，单标注语义真值仍有限。
3. 先跑 lexical-veto-off 与 live-only 离线对照，再决定 Topic/facet 是否进入生产。
4. 不把当前 false display=100% 或 answer coverage=100% 外推到其他集合。
5. 生产质量尚未因本切片提升；本切片修复的是 FOK 数据污染和测量能力。
6. 代码、fixture、计划与研究已提交为 `8e96278b0`；未 push。
