# Goal 阶段 × 角色深化：acceptance + 同轮复核

- 日期：2026-10-31
- 状态：待批准
- 前置：`docs/research/2026-10-31-pod-vs-codex-kimi-grok.md` §9、`docs/research/2026-10-31-pod-definition.md`

## 1. 问题

现在 loop 是「一阶段一角色、串行独占」，三处浪费（调研结论）：

1. **验收标准在执行后才出现**：review 自己拟证据，口径可事后调整——reviewer 说"不够好"时无法对照事前约定
2. **review 失败只能整轮重来**：rubric 已能精确指出 `w1-t2 fail`，但协议没有"就地补证/修复"动作，必须 `round+1` 从 plan 重写
3. **Lead 的常驻会话拿不到阶段决策**：plan 节点是新建会话，每轮靠注入重建上下文

## 2. 目标 / 非目标

**目标**
1. plan 阶段为每个任务产出**结构化验收标准**（acceptance），review 按它判定
2. review FAIL 时支持**一次同轮复核**（只修失败项，不重写计划、不重跑全部）
3. 归档时给 Pod 留一条**决策记录**（不是每节点刷屏）

**非目标**
- 不引入 execute 期间 Reviewer 并发抽检（单活跃 goal 模型不变）
- 不改 `maxRounds` / attempt / 预算语义
- 不改 Pod 三角色定义

## 3. 设计

### 3.1 waves 任务兼容扩展（acceptance）

保持 `taskId` 生成规则不变（`${wave.id}-t${index+1}`），tasks 元素允许两种形态：

```json
{"waves":[{"id":"w1","tasks":[
  "旧式字符串任务",
  {"title":"新式任务","acceptance":["npm test -- pod 全绿","receipts 含 artifact 路径"]}
]}]}
```

- **向后兼容**：字符串 = 无 acceptance（rubric 只校验覆盖度，行为同今天）
- plan prompt 要求：每个任务尽量给 `acceptance`（2–4 条、可验证、不要"看起来正确"）
- `PodTaskService.projectWaves` 的 title 取 `typeof t === 'string' ? t : t.title`

### 3.2 review 契约消化 acceptance

- 新纯函数 `taskAcceptanceFromWavePlan(plan): Map<taskId, string[]>`
- 拼 review prompt 时按任务列出 acceptance（无则标注"无显式标准，请自证"）
- rubric 校验加一条：`result !== 'skipped'` 时 `evidence` 不能为空

### 3.3 同轮复核（review_fix）

状态机不新增 phase，复用 execute + review，增加一个**每轮一次**的复核标记：

- state v3 增 `reviewFixRound?: number`（记录已用过复核的 round）
- `routeAfterReview` 增加输入 `reviewFixAvailable: boolean`，FAIL 时优先级：
  1. `lastError` → `archive_fail`（不变）
  2. PASS → `archive_success`（不变）
  3. **`reviewFixAvailable` → `'execute'`（复核模式）**
  4. `round >= maxRounds` → `archive_max_retries`
  5. `pendingQuestion` → `askUser`
  6. 否则 → `plan`
- 进入复核模式时 driver 写 `reviewFixRound = round`；**每 round 只用一次**
- execute 节点检测 `state.reviewFixRound === round && state.reviewVerdict === 'FAIL'` → 渲染**修复模式 prompt**：只列失败任务 + reviewer 证据 + 要求只改这些、更新回执
- 复核后 review 再跑一次；再 FAIL 则 `reviewFixAvailable=false` → 走原 `round+1`

### 3.4 归档决策记录

goal 归档（PASS/FAIL/CANCELLED）时，若有 Pod：写一条 `kind: decision` 的 Pod 消息（Lead 发出、广播），正文一行摘要：

```
[goal 摘要] <goalId> PASS · rounds=2 · 2 waves / 5 tasks · 失败项: 无
```

- 只归档时写一次，节点级不写（避免日志噪音）
- 复用 `PodTaskService`/`PodMessageService`，不改投递语义

## 4. 影响面

| 文件 | 改动 |
|---|---|
| `node-prompts.ts` | plan 契约（acceptance）；execute 修复模式；review 列出 acceptance |
| `review-rubric.ts` | evidence 非空校验；`taskAcceptanceFromWavePlan` |
| `driver.ts` | `reviewFixRound` 写入/读取；修复模式判定 |
| `routing.ts` | `reviewFixAvailable` 输入与分支 |
| `state-v3.ts` | 新字段 `reviewFixRound?` |
| `pod-task-service.ts` | `projectWaves` 兼容对象形任务 |
| `index.ts` | 归档时写 decision 消息 |
| 桌面 | 无需改（phase 不变；可选后续在时间线显示"复核"） |

## 5. 测试计划

- waves 兼容：字符串/对象混排 → taskId 与 title 正确
- acceptance 提取：对象任务 → Map；字符串 → 空
- rubric：fail 证据为空 → `invalid`
- routing：FAIL 且可用复核 → `execute`；已用过 → `plan`；maxRounds 边界优先 `archive_max_retries`
- driver：复核轮 execute prompt 含失败任务与证据；复核后 PASS → 归档；复核后再 FAIL → round+1
- 归档：有 Pod → 一条 decision 消息；无 Pod → 不写
- 回归：现有 goal e2e / rubric / pod 测试全绿

## 6. 风险

- **token 上升**：acceptance 让 plan/review 都更长；用"2–4 条"限制
- **复核可能被滥用**：每 round 限一次 + 复核只修失败项；若模型借机改范围，review rubric 会再次判 fail
- **状态兼容**：`reviewFixRound` 缺失视为未用过，旧 state 无需迁移

## 7. 验收

一次真实 goal：plan 产出 acceptance → execute 回执 → review 按 acceptance 判定 → 故意让一个任务失败 → 进入复核（不重写计划）→ 修复后 PASS 归档；归档后 Pod 邮箱出现一条 decision 记录。

## 8. 决议（Builder check 后）

| # | 问题 | 决议 | 理由 / 代价 |
|---|---|---|---|
| 1 | 复核算同一轮还是新一轮？ | **同一轮**（`round` 不变），但**产物换文件名**：`loop-N-fix-receipt.json` / `reviews/<goal>-loopN-fix.md`；`goal_node_runs.attempt=2` 区分 | 同轮更符合"同轮复核"语义；换文件名避免覆盖首轮产物，也避免 watchdog 的"产物优先"把首轮回执误判成复核完成 |
| 2 | 最后一轮（round=maxRounds）还给不给复核？ | **给**（复核不消耗 round，因此不受 maxRounds 限制） | maxRounds 计的是轮次不是遍数；否则最有价值的一次复核恰好在最后一轮失效 |
| 3 | 修复 prompt 的失败项与证据从哪来？ | **写进 state**：`reviewFix = { round, tasks:[{taskId,evidence}], feedback }`（可选字段，无需迁移） | 解析结果只活在一次 `completeNode` 里；落 state 后修复节点、归档摘要、桌面都能用，且不受"review 文件被重试覆盖"影响 |
| 4 | 复核回执写全量还是只写失败项？ | **写全量**：先读上一轮回执，已通过任务原样保留（`done` + files），失败任务按新结果更新，整份写到新路径 | rubric 要求覆盖每个 taskId，只写失败项会让其余任务被判 skipped，而 `skipped→failed` 会把已经通过的任务打回 |
| 5 | 对象形任务会不会让计划批准门空白？ | **在范围内**：`plan-render.ts` 兼容对象任务（标题 + acceptance 列表），并补测试 | 用户批准的是计划正文；看不到任务等于批准一个看不见的计划 |
| 6 | 归档 decision 消息是广播还是只记录？ | **定向发给 Lead**（`toMemberId = lead.id`），走既有 push/pull | 目标是"Lead 的常驻会话拿到阶段决策"，广播会污染 Builder/Reviewer 的 `[POD HANDOFF]` |

补充约定：
- `reviewFix` 每轮**只用一次**：`reviewFix.round === currentRound` 即视为已用
- 复核后仍 FAIL → 清空 `reviewFix`，按原逻辑 `round+1` 回 plan
- `rounds=` 摘要仍按 round 计（复核不增加轮数）
