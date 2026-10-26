# T2-1 检查点自动化 + 三态 Restore（Design）

> 日期：2026-10-26 · 状态：草案（待 builder check）
> 上游：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` §3 Tier 2 第一项（P2 顺序首位）
> 地基：B3/B3.1（`2026-10-23-b3-checkpoint-rewind-design.md` / `2026-10-23-b31-per-turn-diff-design.md`）

## 1. 意图

我方 fork/revert/unrevert/diff/revertDiff 动词集已是业界最全档，但「检查点」对用户仍是两个分离的手工操作（对话回滚 / 代码回滚），且快照完全依赖 opencode runtime 的 turn 边界 tree——MAFW 自己不记录任何检查点状态，untracked 文件在所有回滚路径上都是盲区。

本批把「检查点」升格为服务端一等实体：自动记录 + 三态 restore（对话 / 代码 / 全部），复用 opencode snapshot 树，不自建影子 git。

## 2. 现状（2026-10-26 侦察结论）

- `session.fork/revert/unrevert`：`routes/session-branch.ts`，能力位 `sessionBranchApi`；opencode 2.1 revert = stage+commit 两段（`opencode-adapter.ts:457-466`，stage body 硬编码 `files:true`），commit 不可逆；`revertUndoApi=false`；pi revert 不回滚文件不可逆
- per-turn diff：`core/diff/turn-diff.ts` 从 assistant `message.snapshot.start/end`（40/64-hex tree id）在 `~/.local/share/opencode/snapshot/<projectID>/<repoDir>` 定位 repo、`git diff <start> <end>` 计算；hunk 反转纯函数 `core/diff/hunk-patch.ts`（`buildRevertPatch`）；`POST /diff/revert` 经 `vcs.apply` 落项目工作区
- 桌面 `CheckpointOverlay`：客户端从 user 回合自建检查点列表（`checkpoint-model.ts`），「对话回滚」「代码回滚」两个分离动作（`checkpoint-revert.ts` 的 `checkpointsToRewind` 逐回合循环 apply）
- **无任何 `session.checkpoint` API、无影子快照机制、无 untracked 处理**（全仓 `*.ts` grep 零命中）；现存 `checkpoint` 字样均为 goal 编排 legacy 或退役代码

## 3. 目标

1. `session_checkpoints` 服务端实体：自动（turn 完成）+ 手动创建，gateway.db 持久
2. 三态 restore：`session`（对话）/ `files`（代码）/ `both`（全部）
3. untracked 有限处理：checkpoint 记录清单，restore 报告残留（不自动删）
4. 桌面时间线升级：服务端检查点列表 + 三态恢复菜单 + 残留呈现
5. canonical 事件 `session.checkpoint`（创建时广播）

## 4. 非目标 / 反目标

- 不做 restore 后重提议原 tool call（研究原文承认这是锦上添花，明确放弃）
- 不自建影子 git（Gemini 式修改前快照——复用 opencode snapshot 树，避免双写与存储翻倍）
- 不自动删除 untracked 残留（只报告；删除是用户决策）
- pi 不支持（能力门 503；桌面保持现有客户端路径）
- 不做跨会话检查点、检查点导出、检查点命名/备注
- **反目标**：改变现有 `revert`/`revertDiff` 语义（additive only——现有调用方零迁移）

## 5. 设计

### 5.1 数据模型

gateway.db 新表 `session_checkpoints`：

```sql
id TEXT PRIMARY KEY,             -- ckpt_<uuid>
session_id TEXT NOT NULL,
project_dir TEXT NOT NULL,
anchor_message_id TEXT NOT NULL, -- 锚点：restore 后历史保留到该消息（含）为止
snapshot_tree TEXT,              -- checkpoint 工作区树（40/64-hex；null=该边界无文件改动）
untracked_json TEXT NOT NULL,    -- JSON string[]，创建时 untracked 清单
kind TEXT NOT NULL,              -- 'auto' | 'manual'
created_at TEXT NOT NULL
-- INDEX (session_id, created_at)
```

- 保留策略：auto 每会话上限 100（创建同事务修剪最老），manual 不限
- 会话删除路径（wave1 `session.delete` cleanup 链）增删该会话检查点

**锚点不变量**（builder check #1 修正）：`restore('session'/'both')` = 现有 revert(anchor) 语义——历史保留至 anchor（含）、截断其后；`snapshot_tree` = `restore('files')` 要回到的工作区树。三态因此指向**同一时刻**而非错开一轮：

- **auto**（turn N 完成时记录）＝「回到发送 user_N 的时刻」：anchor = user_N（该回合 user 消息），tree = `A_N.snapshot.start`（**pre-turn 树**——与 B3 `checkpointsToRewind`「目标+更新回合全撤」语义一致，`both` = 对话+代码叠加而非错位一轮）
- **manual**（空闲时手动）＝「回到现在」：anchor = 最后一条已持久化消息（通常 A_N，截断为空操作），tree = 最后已知 `snapshot.end`（当前工作区）

### 5.2 CheckpointService（`gateway/src/core/checkpoint/`）

纯核心 + deps 注入，可单测：

- `createCheckpoint(deps, {sessionID, projectDir, anchorMessageID, snapshotTree, untracked, kind})` → 落库 + 修剪 + 广播 `session.checkpoint`
- `listCheckpoints(sessionID)` → 倒序全量
- `restoreCheckpoint(deps, id, scope)` → 见 5.3
- snapshot repo 定位**复用** `turn-diff.ts` 的 `findSnapshotRepo()`（改为导出，零复制）

### 5.3 三态 restore 语义

| scope | 行为 | 失败语义 |
|---|---|---|
| `session`（对话） | opencode `revert/stage {messageID, files:false}` + commit——截断历史，**不动工作区** | stage 成功后 commit 失败 → `DELETE /revert` 清 stage，返回 502 |
| `files`（代码） | `git --git-dir <snapRepo> diff --binary <base> <ckptTree>`（**正向补丁** base→ckpt，免 hunk 反转）→ **gateway-side `git apply`**（`core/diff/apply-patch.ts`；serve 2.1 无 `/api/vcs/apply`，SDK 静默吞 404）——**不动历史** | apply 失败 502，历史与其余文件不受影响（预检 `--check` 通过才 apply） |
| `both`（全部） | `revert/stage {messageID, files:true}` + commit（= 现有 revert 全语义） | 同 session |

- **补丁基线** = 每会话记住的「当前工作区树」（`checkpoint-workspace` kv）：正常路径为最后一条带 `snapshot.end` 的 assistant 树的 end；files 恢复成功后更新为目标树；新回合完成或 session/both 恢复时清空。基线 === 目标树 → 真幂等成功（不 apply、不造 pre-restore）
- `files` restore 前记录 pre-restore `auto` checkpoint（anchor=最新消息、**tree=补丁基线**，即恢复前工作区）——撤销本次代码恢复的后悔药；`files` 不删任何 checkpoint
- `session`/`both` restore（历史截断）**删除创建时间晚于目标 checkpoint 的全部 checkpoint**——时间线随回退一起倒带（Claude Code 同款；留死条目比删更糟），也不为不可逆操作记录 pre-restore checkpoint
- 正向补丁由 git 直接生成新增/删除/二进制（GIT binary patch）的正确形态——**B3.1 桌面路径「新增/删除/二进制不可回退」的限制（`isInvertiblePatch` 排除）在本路径消失**
- `leftoverUntracked`：当前 `git status --porcelain` untracked − checkpoint.untracked → restore 响应字段（`files`/`both` scope 返回）
- 锚点语义跟随现有 `sessions.revert`（与桌面 `revertTo` 同一 messageID 口径，B3 行为为准）
- body 必须 `confirm:true`（destructive 门，对齐 goals retry 路由）

**实现期验证点**（已解决）：① opencode stage body 接受 `files:false`（活体 200，files:[] 零回滚）→ 三态成立。② serve 2.1 **没有** `/api/vcs/apply`（404，SDK `throwOnError=false` 静默吞掉）→ 改为 gateway 侧 `git apply`（`core/diff/apply-patch.ts`，`-C projectDir [--git-dir snapRepo]`，强制 autocrlf=false），B3.1 的 `revertDiff` 一并修复。

### 5.4 自动记录钩子

`handleOpencodeEvent` 的 `turn.completed` 分支：

- **门控**：opencode runtime + sessionStorageApi + **非隐藏会话**（复用 `core/session-visibility.ts` 的 `isHiddenSession`——turnCompress worker / curator / btw / media 等内部会话不记录，免 per-turn `git status` 与行膨胀；manager 等可见会话照常记录）
- **anchor 定位以 A_N 为基准**（builder check #5：immediate-delivery/queue flush 下 user_{N+1} 可能已持久化，「最后一条 user 消息」规则会错锚一轮）：`turn.completed` 载荷携带 A_N（含 `snapshot.start/end`）；user_N = `session.messages({limit:50})` 中 A_N 之前最近的 user 消息——**一次 messages 调用即主路径**，不新建消息缓存
- tree = `A_N.snapshot.start`（pre-turn 树，见 §5.1 锚点不变量）；无快照 → null 照记
- `git status --porcelain`（simpleGit @ projectDir）取 untracked
- fail-open：记录失败仅 warn，绝不影响回合本身

### 5.5 HTTP API

| 路由 | 语义 |
|---|---|
| `POST /api/sessions/:id/checkpoint` | 手动创建（body 可选 `{messageID}` 锚点，缺省最后一条已持久化消息；tree=最后已知 `snapshot.end`） |
| `GET /api/sessions/:id/checkpoints` | 列表（倒序） |
| `POST /api/sessions/:id/checkpoints/:cid/restore` | body `{scope, confirm:true}` |

- 新能力位 `checkpointApi?: boolean`（opencode true / pi false），缺 → 三路由 503
- 路由 `routes/session-checkpoints.ts`（deps 注入可单测；挂 wave1 dispatch，注册于 dashboard 兜底之前）

### 5.6 契约与 SDK

- `RuntimeClient.session.revert` 增可选 `files?: boolean`（缺省 true 向后兼容；opencode adapter 透传进 stage body）
- checkpoint 逻辑全部在 gateway 层（组合既有原语，runtime 不加新动词）；`checkpointApi` 能力位声明快照树可用性
- SDK：`session.checkpoint(id, body?)` / `session.checkpoints(id)` / `session.restoreCheckpoint(id, cid, body)` + `SessionCheckpoint` 类型；preload 三方法同步

### 5.7 事件

- canonical `session.checkpoint`：`{sessionID, checkpointId, kind}`，创建（auto/manual）时广播——flat-emit registry 登记
- restore **不发新事件**：session/both 触发既有 `session.revert.*` 族；files 由 restore HTTP 响应驱动桌面刷新
- 词汇链五处同步照惯例：SDK events union ↔ `mafw-vocabulary.ts` ↔ EVENT_FLOW_MATRIX ↔ TUI KNOWN_EVENTS ↔ desktop `assertShellEventCoverage`

### 5.8 Desktop

- `CheckpointOverlay`（opencode + `checkpointApi` 门）：列表改消费 SDK `session.checkpoints`（auto/manual 徽标、无树条目标注「仅对话」）；pi/旧 runtime 保持现客户端构建路径不变
- 每条目恢复菜单三选项（对话/代码/全部）+ 复用 runtime-aware `revertWarning`；`leftoverUntracked` 以 notice 列表呈现（无删除按钮）
- 时间线头部「立即检查点」手动按钮（能力门）

## 6. 测试

- gateway：CheckpointService（创建/修剪/三态 restore/幂等/leftoverUntracked 纯函数）；routes（能力门 503 / confirm 门 400 / 参数校验 / cid 404）；restore 组合（mock runtime + 临时 git fixture 两树）
- SDK：client 三方法 + `SessionCheckpoint` 类型钉扎
- desktop：overlay 服务端列表映射 / 三态菜单 / 残留呈现 / 能力门降级路径
- 全量回归 + 根 build + tsgo；真机 smoke：手动 checkpoint → files restore → 残留报告 → pre-restore 反转

## 7. 版本与部署

v4.37.0；本机全局安装 + gateway 重启验收；push/发布仍需用户确认。

## 8. 风险与开放点

| 风险 | 处置 |
|---|---|
| opencode stage 不支持 `files:false` | §5.3 验证点①（静态事实一次性验证）；降级二态（UI 隐藏对话选项），契约字段保留 |
| `vcs.apply` 不收整文件新增/删除/binary 补丁 | §5.3 验证点②；退化为仅 modified 文件 + 跳过清单（等价 B3.1 现状） |
| 工作区含 turn 外手工编辑 → files patch 上下文失配 | git apply 原子失败 502，文案提示「工作区有回合外改动」；不 fuzz |
| snapshot repo 被 opencode prune | `findSnapshotRepo` 失败 → 该 checkpoint 的 files scope 404（session scope 不受影响） |
| `turn.completed` 载荷缺 snapshot | 回退一次 `session.messages`；再缺则记 null 树 |

## 9. 我的裁量（builder check 后更新）

- **auto checkpoint 语义对齐 B3**：「回到发送该 prompt 的时刻」——anchor=user_N、tree=pre-turn 树（`A_N.snapshot.start`）。桌面现有两按钮行为不变，`both` = 两者叠加而非错位一轮；manual =「回到现在」（anchor=最后消息、tree=当前树）
- **files 用正向补丁**（`git diff <base> <ckpt>` 直接 apply），不用 `buildRevertPatch` 反转——新增/删除/二进制回退从不可变可
- **工作区树记忆**（冒烟推演发现的修正）：files 恢复后工作区不再等于历史最新树，第二次恢复（后悔药）必须用「上次恢复目标树」作基线；否则 `latest===target` 会误判幂等、撤销失效。新回合/全量恢复清空记忆
- pre-restore checkpoint 只救 files 恢复；session/both 改为删除更新 checkpoint（时间线随回退倒带），不为不可逆操作造假后悔药
- auto 上限 100/会话（对齐桌面 50 条抓取上限的量级余量）
- `session.checkpoint` 事件只覆盖创建，restore 靠既有事件族
- manual checkpoint 不设 DELETE/改名/备注（列表可忽略，减攻击面）
- untracked 残留不提供删除按钮（v1 报告即止）
- 内部会话（worker/curator/btw/media）不记录 auto checkpoint；manager 等可见会话记录
