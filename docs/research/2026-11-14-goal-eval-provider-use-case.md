# GoalEval LLM Provider 使用场景评估

- 日期：2026-11-14
- 状态：评估完成，provider 已改为 advisory 模式
- 样本：本仓库 `.mafw` 下真实 GoalEval 产物
- 相关：`docs/releases/2026-11-13-capability-kernel-phase5-goal-eval-llm.md`

## 1. 结论

**LLM GoalEval provider 适合做“第二意见 / 证据一致性复核”，不适合做独立验收器。**

- 可以：检查条件是否被 task 结果覆盖、证据是否自相矛盾、PASS 是否缺少支撑、条件与 mapping 是否脱节。
- 不可以：执行测试、查看 PNG、读取文件、验证 hash/commit、判断 DOM 是否真的存在。
- 因此 provider 采用 **advisory** 模式：只允许 provider 的 `fail` 覆盖 reviewer 的 PASS；`pass` / `skipped` 视为“不反对”，保留 reviewer 结果。
- 人类验收、review 结论、风险接受仍然不可代理。

## 2. 样本观察

本仓库 `.mafw` 下有 2 个真实 GoalEval：

| Goal | conditions | required | mapping | 对应 review |
|---|---|---|---|---|
| `goal-20261104-032632-7bd086` | 4 | 4 | g1–g4 → w1-t1/w2-t1 + artifacts | 有，2 tasks / 4 goalResults |
| `goal-20261105-010329-3722d8` | 3 | 3 | g1-1..g1-3 → w1-t1 | 无 |

样本特征：

- **100% 条件都是 required**（7/7）。
- 条件类型以“可核对证据”为主：
  - UI/DOM 点击与 tab 标题
  - 班底行文本
  - spec 条目对账表
  - 文件存在 / 内容 / hash
  - commit / 测试 / 截图引用
- review 报告已经非常详细：任务逐项 PASS、goalResults 逐条 PASS、证据含路径/commit/测试/SHA256。
- 这也说明：LLM provider 的价值不在“再写一遍证据”，而在**发现证据与结论不一致、漏项、过度乐观**。

## 3. LLM 能做什么 / 不能做什么

| 检查 | LLM 可做 | 说明 |
|---|---|---|
| condition 是否被 task 覆盖 | ✅ | 对照 `mapping.tasks` 与 taskResults |
| evidence 是否为空/自相矛盾 | ✅ | 文本层面 |
| PASS 是否有支撑 | ✅ | 可指出“只有结论没有证据” |
| 条件与 failureConditions 冲突 | ✅ | 文本层面 |
| 文件是否存在 | ❌ | provider 不读文件系统 |
| 测试是否真的通过 | ❌ | provider 不执行命令 |
| PNG/DOM 是否真实 | ❌ | provider 看不到图片/DOM |
| hash/commit 是否存在 | ❌ | 除非文本已给出可核对信息，否则无法验证 |
| 人类是否接受风险 | ❌ | 永远不做 |

**核心风险**：如果让 LLM 对“无法验证”的条件直接给 fail，会把合法 Goal 误杀；如果它总给 pass，又只是复读 reviewer。

## 4. 决策：advisory 模式

实现上增加：

```ts
interface GoalEvalProvider {
  mode?: 'replace' | 'advisory'
  ...
}
```

- `replace`：provider 结果替换 reviewer goalResults（默认；适合确定性 provider）。
- `advisory`：只有 provider 的 `fail` 覆盖 reviewer；`pass` / `skipped` 不改 reviewer。
- 第一方 LLM provider 固定 `mode: 'advisory'`。
- core 仍强制 required 覆盖、证据、漏项 FAIL；provider 的 fail 会强制 Goal FAIL。
- provider 抛错/非法 JSON/unknown condition → 保留 reviewer rubric。

这样 provider 只能“提出反对”，不能“替 reviewer 放行”。

## 5. 建议启用策略

默认 `goal.evalProvider=off`。建议只在以下情况开启：

1. **高风险 Goal**：schema/权限/数据迁移/UI 关键路径。
2. **reviewer PASS 但证据较薄**：例如只有一句“已测试”，没有路径/命令/输出。
3. **模型成本可接受**：每次 review 额外一次 completion；样本 review 约 13KB + GoalEval 约 5KB，成本较低但非零。
4. **先观察误报**：advisory fail 是否合理；如果误报高，收紧 prompt 或只在 T2/T3 使用。

不建议：

- 作为唯一 GoalEval 判官。
- 对“无法验证”的条件直接 fail。
- 替代 reviewer 或人类验收。

## 6. 下一步

- **确定性 verifier**：对 `artifact:` / `file:` / `command:` 类条件做真正的文件/命令校验（另立信任模型；命令执行需要沙箱/权限）。
- **LLM provider**：继续做证据一致性；用真实误 PASS/正确 PASS 样本评估 advisory fail 的 precision。
- **指标**：advisory fail 被人类确认为正确的比例、误杀率、额外成本、review 时长。
- **不改变**：human accept、planHash/evalHash、NodeDriver 状态机。

## 7. 相关代码

- `gateway/src/core/goal/goal-eval-provider.ts` — `applyGoalEvalResults` / `mode`
- `gateway/src/core/goal/goal-eval-llm-provider.ts` — first-party provider（`mode: 'advisory'`）
- `gateway/src/core/goal/driver.ts` — review 路径接入
- `gateway/src/kernel.ts` — `bindGoalEvalProvider`
- `gateway/src/config.ts` — `goal.evalProvider` / `evalModel`
