# Pod 按 Revision 使用 Worktree + 用户验收后合并

日期：2026-11-09

## 1. 问题

当前 Pod 的代码执行没有隔离：

- Tech Lead 讨论会话在 `pod.projectDir`；
- NodeDriver 的 plan / execute / review 都在 `state.projectDir`；
- Probe 已有独立临时工作区，但正式实施直接修改主工作区。

结果是 Pod Goal 一启动就改主项目，Reviewer 看到的是主项目当前状态，多个 Goal 也无法安全并行。

## 2. 目标

1. 每个 Pod Goal revision 拥有独立 Git worktree 和分支。
2. 同一 revision 的 Tech Lead、plan、Builder、Reviewer 共用同一份代码。
3. 打回后的 revision N+1 从 revision N 的分支继续。
4. Reviewer PASS 不等于用户验收；PASS 后不自动修改主项目。
5. 用户在结果页点击一次“验收并合并”后，才把 revision 分支合并回项目主分支；不再弹二次确认。
6. 合并失败/冲突时不破坏主工作区，保留 worktree 和分支供处理。

## 3. 非目标

- 通用会话 worktree 重构（本次只接 Pod）。
- Probe 工作区改造；Probe 继续用独立临时目录。
- 自动解决 merge conflict。
- 自动 push / PR / 远端操作。
- VM/沙箱。

## 4. 核心模型

```text
Pod Goal
└─ revision N
   ├─ worktree: <project>-wt-<goalId>-r<N>
   ├─ branch:   mafw/<goalId>-r<N>
   ├─ base:     rev1 = project HEAD
   │            revN = revision N-1 branch（存在时）
   └─ sessions: discussion / plan / execute / review 全部 cwd = worktree
```

### 粒度

- **一个 revision 一个 worktree**，不是每个 node 一个。
- 同一 revision 的所有 Pod 角色共享它，避免 plan/execute/review 看到不同代码。
- Probe 例外：继续使用现有隔离临时工作区。

### 命名

- 目录：`<repoRoot sibling>/<repoName>-wt-<safeGoalId>-r<N>`
- 分支：`mafw/<safeGoalId>-r<N>`
- `safeGoalId` 只保留 `[A-Za-z0-9._-]`，避免路径与 ref 注入。
- 目录名包含 `-wt-`，沿用 Pod 折叠回父项目的现有规则。

## 5. 生命周期

### 创建

worktree 按需创建，单飞、幂等：

1. Pod 首次需要某个 revision 的会话目录时调用 `PodWorktreeService.ensure`。
2. 解析仓库根、当前分支/HEAD。
3. revision 1 从当前 HEAD 创建。
4. revision >1 优先从上一 revision 分支创建；上一分支不存在时回退当前 HEAD。
5. 创建成功写入 `pod_goal_worktrees`。
6. 失败必须显式返回错误，禁止静默回退主工作区。

Tech Lead 会话创建失败时沿用现有 `sessionError` 呈现；NodeDriver 节点无法取得 worktree 时节点失败，不回退主仓。

### 执行

- `NodeDriver` 创建 plan / execute / review 会话时使用 revision worktree。
- 复用 Tech Lead 讨论会话时天然处于同一 worktree。
- Agent 的 shell、文件读写、测试都在 worktree 内。
- Goal state、waves、receipt、review 等 `.mafw` 产物仍写项目 `.mafw` 绝对路径，不放进分支。
- 自动提交时排除 `.mafw`。

### Agent Review PASS

- 只表示 Pod Reviewer 通过。
- 不合并、不修改主分支。
- 结果进入 `resultReady`。
- 在结果可用时，Gateway 尝试把 worktree 未提交改动提交到 revision 分支；提交失败不回退 PASS，但 acceptance 会再次尝试并返回明确错误。

### 用户验收

新增显式动作：

```http
POST /api/pods/:podId/goals/:goalId/accept
{ "revision": N, "confirm": true }
```

条件：

- revision 已终态；
- verdict 为 `PASS` 或 `UNREVIEWED`；
- result 可信；
- worktree 状态为 active；
- 无未解决的 merge conflict。

合并规则：

1. 先把 worktree 内剩余改动提交到 revision 分支。
2. 主项目当前 checked-out 分支必须等于创建 worktree 时记录的 base branch。
3. 主项目不能有已跟踪文件的未提交改动；untracked 不阻止。
4. 使用 `git merge --no-ff` 合并 revision 分支。
5. 冲突时执行 `git merge --abort`，主项目恢复干净，返回 409，worktree 保留。
6. 成功后记录 `merge_commit` / `merged_at`，移除 worktree，保留已合并分支作为审计记录。
7. 重复 acceptance 幂等：已 merged 直接返回原 merge commit。

### 打回

- 用户拒绝结果不开新 revision 前，先把 worktree 剩余改动提交到当前分支。
- 新 revision 的 worktree 基于旧 revision 分支。
- 旧 revision 的 worktree/branch 不删除、不覆盖。

### 取消 / 丢弃

- 不自动强制删除含未提交改动的 worktree。
- 清理策略留后续；本轮只保证不丢数据。

## 6. 数据模型

新增 `pod_goal_worktrees`：

| 字段 | 含义 |
|---|---|
| `pod_id`, `goal_id`, `revision` | 主键 |
| `dir` | worktree 绝对路径 |
| `branch` | revision 分支 |
| `base_ref` | 创建时基线（branch 或 SHA） |
| `base_branch` | 可合并的目标分支；detached 时为 null |
| `status` | `active` / `merged` / `abandoned` / `missing` |
| `merge_commit` | 成功合并后的 commit |
| `created_at`, `updated_at`, `merged_at` | 时间 |

## 7. 结果与 UI

`PodGoalResult` 增加：

```ts
worktree?: {
  dir: string
  branch: string
  baseBranch: string | null
  status: 'active' | 'merged' | 'abandoned' | 'missing'
  mergeCommit: string | null
  mergedAt: string | null
}
acceptance?: 'pending' | 'accepted' | 'unavailable'
```

结果页必须保留当前已有的全部信息：

- revision + verdict + 是否独立评审；
- 版本历史（revision / 状态 / verdict / 打回反馈）；
- Goal 条件与验收（request.acceptance）；
- **Goal Eval 条件 + 逐条件判定结果（当前 DTO 已有但结果页未渲染，本次补显示）**；
- 逐任务证据（taskId / result / evidence）；
- Review feedback；
- 产物列表（basename）；
- 失败后的「基于失败反馈重新提交」；
- 打回给 Tech Lead 的输入框与按钮。

新增信息：

- 工作分支、基线分支、worktree 状态；
- 待用户验收 / 已验收 / 不可验收；
- PASS 且未验收时显示 `验收并合并到主分支`；
- 一次点击即执行；不再弹二次确认，按钮上方用常驻说明明确“会修改主项目当前分支”；
- 冲突/主项目脏时显示服务端中性错误，worktree 保留；
- 已验收/已合并后隐藏打回入口，显示 merge commit。

成功与失败状态：

- 成功（PASS / UNREVIEWED）：保留全部结果信息 + 代码结果卡 + 验收合并入口；
- 失败（FAIL / MAX_RETRIES / ERROR）：保留全部结果信息 + 代码结果卡，状态明确为“失败 · 不可验收”，**不显示验收合并入口**；
- 失败页仍显示查看差异、基于失败反馈重新提交、打回。

## 8. API / SDK

Gateway：

- `GET /api/pods/:podId/goals/:goalId/result` 增 worktree/acceptance。
- `POST /api/pods/:podId/goals/:goalId/accept`。
- 路由登记 `route-catalog.ts`，重新生成契约。

SDK / preload：

- `pod.acceptResult(podId, goalId, { revision, confirm: true })`。
- `PodGoalResult` 类型增量字段。

## 9. 兼容与前置条件

### 非 Git 项目

新 Pod Goal 要求项目是 Git 仓库：

- 创建 Goal / 首次 ensure worktree 时返回明确 409；
- 不静默使用主工作区；
- 存量无 worktree 的 Goal 仍可查看结果，但没有 acceptance merge。

### 子目录项目（实现按保守路线）

Pod 要求 `projectDir === repoRoot`：

- 子目录项目创建 Goal 返回 409 `pod worktree requires project root`；
- 原因：worktree 是仓库根的另一份 checkout，若把 Pod 注册在子目录，worktree 目录无法同时满足“会话 cwd 是子目录”和 Pod 目录折叠约定；
- 不静默退化为主工作区。

### 已在进行中的 Goal

升级时已存在的 in-flight Goal 继续在主工作区完成：

- **不 retrofit**，避免中途重建讨论/plan/execute/review 会话；
- 这类 Goal 的结果 `acceptance = unavailable`；
- 只有升级后新建的 Pod Goal 具备 worktree 与验收合并。

### 可验收 revision

只有 **当前 active revision** 可以验收：

- 历史 revision 一旦被打回，状态即为 rejected，不再提供合并；
- 若当前 revision 被取消/丢弃，历史版本也不会重新变成可验收；
- 避免用户误合并已被明确拒绝的代码。

### 验收权限

验收合并是 **人类动作**：

- 只允许不带 `actorSessionID` 的桌面/移动端请求；
- 携带 `actorSessionID` 的 Agent/Lead 请求一律 403；
- 不提供 MCP 验收工具；
- 这样可以阻止 Agent 自行把分支合入用户主工作区。

### 依赖与环境

不自动执行安装/构建：

- worktree 是全新 checkout，默认没有 `node_modules`、`.venv` 等；
- Builder 在需要时自行安装，Reviewer 在同一 worktree 复用这些依赖；
- 节点提示明确“这是新 worktree，测试前按项目需要安装依赖”；
- 自动安装会让 worktree 创建从毫秒级变成分钟级，并引入网络/脚本执行风险，本轮不做。

### 产物路径

未合并前，Pod 产物引用可能只存在于 worktree：

- `PodA2AArtifactStore` 的解析顺序：revision worktree → `pod.projectDir`；
- 合并成功后 worktree 被移除，解析自然回落到项目目录；
- 结果中的产物路径保持相对路径，不暴露宿主绝对路径。

### 验收后的工作桶

- `merged` 的 Goal 从 `result_ready` 移到 `ended`；
- 结果页仍可查看 merge commit 与历史 revision；
- 这是移动端 `work.overview` 和桌面工作面的共享语义，需同步 SDK 类型与测试。

### 自动提交细节

- `git add -A -- . :(exclude).mafw`（遵循 `.gitignore`）；
- commit 使用 `--no-verify`，避免用户仓库 hook 阻塞验收；
- 身份固定为 `MAFW <mafw@localhost>`，不依赖用户 git identity；
- 消息：`mafw(pod): <goalId> rev <N>`；
- 无改动时 no-op。

## 10. 失败边界

- worktree 创建失败：Goal 不执行，明确错误。
- session 创建失败：清理本次新建的 runtime session；worktree 保留以便重试（可能已有文件）。
- 自动提交失败：阻断 acceptance，不丢弃改动。
- merge 冲突：abort merge，主项目保持原状，worktree 保留。
- Gateway 重启：按 `(pod, goal, revision)` 从表恢复；目录存在即复用，不重复创建。
- 并发 ensure：进程内单飞 + DB 主键兜底。

## 11. 测试

Gateway：

- worktree ensure 幂等、rev2 基于 rev1 分支；
- 目录/分支命名与 Pod 折叠；
- Tech Lead / NodeDriver 会话 cwd 走 worktree；
- 自动提交排除 `.mafw`；
- acceptance 成功、幂等、dirty 主项目 409、冲突 abort、detached 409；
- 打回前提交并正确派生 rev2；
- 非 git 项目 409；
- 结果字段与路由契约。

SDK / Desktop：

- acceptResult 请求形状；
- 结果页 pending merge / merged / conflict 三态；
- 验收按钮单次点击、请求中禁用与成功后刷新。

## 12. 待用户确认后的实现顺序

1. Gateway worktree 数据表与服务；
2. Pod 会话目录接线；
3. 提交与打回派生；
4. acceptance API；
5. 结果 DTO / SDK / preload；
6. 桌面结果页；
7. TDD + 全量门禁。
