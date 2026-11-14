# Capability Kernel Phase 5 / First-party LLM GoalEval Provider 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：第一方 LLM GoalEval provider（默认关闭）
- 前置：`docs/releases/2026-11-13-capability-kernel-phase5-goal-eval.md`

## 使用场景

reviewer 已经逐 task 给出 `pass/fail + evidence`，但 Goal 条件仍可能被 reviewer 过度乐观地判 pass。  
第一方 provider 用当前运行 runtime 的 completion 通道做一次**独立条件复核**：

```text
reviewer rubric（task evidence）
  → LLM GoalEval provider 逐 condition 复核
  → applyGoalEvalResults core 校验
  → required 条件缺失/失败 → 强制 FAIL
  → provider 失败/非法输出 → 保留 reviewer rubric
```

它不是第二个 reviewer，也不决定整体 verdict；只提供逐 condition 的结构化结果。

## 配置

```yaml
goal:
  evalProvider: llm          # off（默认）| llm
  evalModel:                 # 可选；缺省回退 goal.nodeModel / recall.judgeModel
    providerID: opencode
    modelID: your-review-model
  evalTimeoutMs: 60000       # 可选
  evalMaxTokens: 2048        # 可选
```

- 默认 `off`：不产生额外模型调用，行为与之前完全一致。
- `llm`：kernel 在创建 NodeDriver 后绑定 provider；completion thunk 每次读取当前 runtime，runtime 热切换安全。
- 没有可用 model / completion 通道时：provider 不绑定或 evaluate 抛错，driver 保留 reviewer rubric。

## 实现

- `gateway/src/core/goal/goal-eval-llm-provider.ts`
  - `buildGoalEvalPrompt()`：注入 GoalEval conditions、plan、task results、review feedback。
  - `createLlmGoalEvalProvider()`：调用 runtime `CompletionChannel.complete()`。
  - 解析 ```json fenced / 裸 JSON array；非法 JSON 抛错，不自动 PASS。
  - **`mode: 'advisory'`**：provider 只能提出 fail，不能替 reviewer 放行；pass/skipped 视为不反对，保留 reviewer 结果。
- `gateway/src/kernel.ts`
  - `bindGoalEvalProvider(driver)`：读取 `goal.evalProvider` / `evalModel` / `nodeModel` / `recall.judgeModel`。
- `gateway/src/boot.ts`
  - NodeDriver 创建后调用 `kernel.bindGoalEvalProvider(kernel.goalDriver)`。
- `gateway/src/config.ts`
  - 新增 `goal.evalProvider` / `evalModel` / `evalTimeoutMs` / `evalMaxTokens`。

## 行为保证

- provider 只返回 condition 结果，不能返回整体 verdict。
- core 仍强制：required 覆盖、evidence 非空、缺项 FAIL、pass 无证据降级 fail。
- provider 抛错、非法 JSON、unknown/duplicate condition → 保留 reviewer rubric。
- 人类验收、review 解决、风险接受、`planHash`/`evalHash`、NodeDriver 状态机均未改。

## 验证

- 新增 **5 个 provider 测试**：
  - structured JSON 解析 + prompt 内容
  - 非法 JSON 拒绝
  - 缺失 completion 通道拒绝
  - prompt 包含 conditions / task evidence / feedback
  - advisory：provider fail 可覆盖 PASS，pass/skipped 不改变 reviewer 结果
- 定向：goal eval provider / driver wiring / LLM provider **11 / 11 pass**。
- runtime architecture boundaries：**34 / 34 pass**（provider 使用 `channel` thunk，不直接读 runtime capability）。
- gateway typecheck：`npx tsc --noEmit -p tsconfig.json` 退出 0。
- gateway 全量：**7249 passed / 2 skipped / 7251 total**（923 suites，`--testTimeout=20000`）。
- 使用场景评估：`docs/research/2026-11-14-goal-eval-provider-use-case.md`。

## 明确未做

- 不做第三方 GoalEval provider loader。
- 不做 GoalNodeExecutor / 新节点名。
- provider 不执行命令、不读文件系统、不调工具；只做文本证据复核。
- 不改变 human-only 验收路由。

## Rollback

- `goal.evalProvider: off` 或删除配置 → provider 不绑定，行为回到 reviewer rubric。
- 删除 `bindGoalEvalProvider` 调用 → 同上。
- 无数据迁移。

## 关键 commit

- `718c6ea9` feat(goal): add first-party LLM goal eval provider
- `b30ab0d1` fix(goal): make llm goal eval advisory

## Next

GoalEval hook + 第一方 LLM provider 已交付。后续可按真实误 PASS 样本调 prompt/模型，或增加确定性 artifact/command verifier（另立信任模型）。
