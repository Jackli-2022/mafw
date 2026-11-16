# 2026-11-16 · Review artifact 双重编码导致 Goal ERROR

- **版本**：`v5.1.0`（修复，不升版本号）
- **提交**：`12892343`
- **范围**：gateway goal review 契约；desktop / SDK / runtime 零改动
- **触发**：`goal-20261115-122201-8a45c4`（Goal 清理能力）

## 根因

`goal-20261115-122201-8a45c4` 在 rev-2 / loop-1 复评时失败：

```text
artifact_invalid:
.../rev-2/reviews/loop1-fix.md:
mafw-review payload must be an object
```

`loop1-fix.md` 的机器块内容是一个 **JSON 字符串**，不是对象：

```text
```mafw-review
"{\"verdict\":\"PASS\",\"tasks\":[...]}"
```
```

`parseReviewRubric` 一次 `JSON.parse` 得到 `string`，`typeof payload !== 'object'`，
于是判 `artifact_invalid`。

复盘 reviewer session：

1. reviewer 先写了人读报告；
2. 它发现节点 prompt 要求机器块放**最前面**，于是用 `mafw_python` 重写；
3. 拼接时用了 `json.dumps(JSON.stringify(review))`，把对象二次编码成字符串；
4. 最终写入的块无法被解析为对象。

上游诱因是两处 prompt 矛盾：`IdentityRegistry` 的 `mafw-review` 身份写“末尾必须带”，
`node-prompts.ts` 的 review 节点写“第一段必须是”。reviewer 先写正文、再尝试前置块，
才走进了 ad-hoc 编码路径。

同 Goal 的上一轮 review 也曾因“没有机器块”失败，所以是同一类 artifact 契约问题的重复出现。

## 修复

- `gateway/src/runtime/identity-registry.ts`
  - `mafw-review` 系统 prompt 与节点 prompt 对齐：块放第一段、包含 `tasks` / `goalResults`、
    禁止二次 `JSON.stringify`、写后 `JSON.parse` 校验对象。
- `gateway/src/core/goal/review-rubric.ts`
  - `extractPayload` 对 `JSON.parse` 得到的字符串继续解码，最多 3 层；真正的非对象载荷
    仍由 `parseReviewRubric` 拒绝。
- `gateway/src/core/langgraph/review-parser.ts`
  - legacy LangGraph review parser 同步兼容双重编码。
- 测试：
  - `review-rubric.test.ts`：双重编码对象可解析；非对象字符串仍拒绝。
  - `review-parser.test.ts`：双重编码对象可解析。
  - `identity-registry.test.ts`：review prompt 必须是“第一段、禁止二次 stringify、
    含 tasks/goalResults”。

## 验证

- 定向：`tests/unit/goal` + `tests/unit/runtime/identity-registry.test.ts` = **57 suites / 460 tests** 全绿。
- 定向：`review-parser.test.ts` + `review-rubric.test.ts` + `identity-registry.test.ts` =
  **43 tests** 全绿。
- 回放实际失败产物 `loop1-fix.md`：修复后的解析器读到 **PASS / 11 tasks / 6 goalResults**
  （原文件无需修改）。
- gateway `npx tsc --noEmit -p tsconfig.json`：rc=0。
- gateway 全量：**984 / 984 suites**，**7865 passed / 2 skipped / 0 failed**
  （`npx jest --runInBand --forceExit`，清空 `OPENCODE_SERVER_PASSWORD`）。
- 未 push、未合并远端。

## 边界

- 这是解析器容错 + prompt 对齐；已经归档的 `goal-20261115-122201-8a45c4` 不会自动恢复。
  其实际 review 内容是 PASS（11/11 task、6/6 Goal 条件），代码在
  `mafw/goal-20261115-122201-8a45c4-r2` @ `2979667f`，worktree 干净。
- Goal 已 terminal，`goals.retry` / 节点级 retry 仍返回 409；恢复需要新建 Goal 或显式人工
  重开 state，不在本次修复范围。
- `.mafw/reports/goal-*.md` 的 `COMPLETED` 硬编码是独立问题，本次未改。
