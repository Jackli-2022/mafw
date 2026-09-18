# Gateway Approval Policy Service — 设计文档

日期：2026-09-18
状态：已批准（设计对话逐节确认）

## 1. 背景与动机

三块现实缺口（2026-09-18 两轮调研结论，记忆 mem_1789714046592 / mem_1789714754583）：

1. **auto 模式只活在 desktop renderer**：`MafwShell.tsx:1398-1405` 收到 `permission.asked` 后由 renderer 自动 `permReply("once")`。TUI 无 auto 模式、headless 会话无 auto 模式——同一会话跨客户端行为不一致。
2. **headless 无人应答**：严格权限配置（`"*": "ask"`）下，turnCompress worker / btw / milestone 等内部会话的 `permission.asked` 无人回复（pi ApprovalBridge 5min 超时自动拒；opencode 挂到 worker prompt 120s 超时）→ 回合静默丢失。
3. **always 不落盘 + 事件不对齐**：两个 runtime 的 'always' 都仅 session 级；opencode 的 asked 携带 `patterns`/`metadata`，pi 的 asked 由 extension 手搓（`risk` 恒 'medium'、无 patterns），下游无法统一判定。

同时存在的 UX 问题（本设计的起点问题）：desktop auto 模式下权限卡先弹后自动 resolve（闪现 + 进串行队列抢首位 + 误导性 OS 通知）。

**契约层结论**（调研定案）：runtime 契约**不**新增 permission mode 能力位。现有原语（`nativeApprovals` + asked/replied 事件 + 三值 `permissionReply` + `permissionList` + agent-definition permissions）已可合成任何 mode 语义；缺口全部在 gateway 层解决。Claude 把 mode 放核心是因为 mode 参与评估管线需 runtime 配合，MAFW 的 auto 语义外部自动回复等价且更可观测。

## 2. 目标 / 非目标

**目标（全家桶，用户确认范围）：**
- ① per-session mode（manual/auto，含 25 次预算）下沉 gateway，成为单一真相源
- ② 内部会话 headless fail-safe（deny instead of prompt，对标 Claude `dontAsk`）
- ③ desktop 迁移：renderer 逻辑改调 gateway API，卡片渲染按策略结果分流
- ④ TUI 接入 auto 模式（/perm 命令 + 状态栏徽标 + overlay 门控）
- ⑤ always 跨会话持久化：MAFW 自有白名单（`~/.mafw/config.yaml` approval 段）+ Config 页编辑器

**非目标：**
- runtime 契约改动（零能力位、零方法）
- sandbox / 环境抽象（YAGNI 清单既有项）
- 自动写回用户 opencode.json / pi approvalPolicy（MAFW 自有白名单替代，两 runtime 统一）
- TUI 键位绑定（keymap 已密）
- 持久白名单的 glob/正则语法（v1 仅工具名 + 命令前缀字面匹配）

## 3. 决策记录（设计对话确认）

| 决策点 | 结论 |
|---|---|
| 范围 | 全家桶（①-⑤ 一次立项，分四批实施） |
| 架构 | 方案 B：EventFacets 加 approval 切面 + 独立 `core/approval/` 模块 |
| auto 安全判定 | 白名单 + 危险正则：只读类白名单直接放行；写类按危险正则拦下弹卡；其余放行 + 25 次预算 |
| headless fail-safe | 内部会话 asked 一律拒绝 + warn 日志 |
| mode 持久化 | per-session 存 gateway kv_store（survive 重启），新会话恒 manual |
| always 写回 | MAFW 自有白名单；卡片「始终允许」默认 session 级，显式「持久允许」才写回 |

## 4. 架构总览

```
runtime 事件流（opencode serve / pi 进程内）
  └─ normalizeOpencodeEvent ── EventFacets + approval 切面（双 runtime 形状对齐）
       └─ handleOpencodeEvent（index.ts:919）
            ├─ 钩子（Mode A 广播之前）：
            │    ApprovalPolicyService.evaluate(sessionID, facet)   ← 同步，纯状态机
            │      1. 内部会话 → auto-deny + warn
            │      2. MAFW 持久白名单命中 → auto-approve
            │      3. mode=manual → human
            │      4. classifySafety=dangerous → human
            │      5. 预算耗尽 → 回落 manual + 广播 permission_mode → human
            │      6. 其余 → auto-approve（计数 +1）
            │    → 广播的 asked 事件附加 properties.mafwPolicy = { action, verdict, reason }
            │    → auto 路径 fire-and-forget runtime.session.permissionReply
            └─ Mode A 广播（enriched）→ SSE → desktop / TUI
HTTP 面：/api/sessions/:id/permission-mode（GET/POST）
         /api/approvals/allowlist（GET/POST/DELETE）
         /api/permissions/:id/reply 扩展 persist
状态：kv_store `perm-mode/<sessionID>`（持久）+ 预算计数（内存）
配置：~/.mafw/config.yaml `approval.allowlist`（懒读热生效）
```

## 5. 数据模型

### 5.1 EventFacets approval 切面（`gateway/src/runtime/normalize.ts`）

```typescript
export interface EventFacets {
  // ...现有字段...
  /** 非 null = permission.asked 事件（喂 approval policy）。双 runtime 形状在切面层对齐。 */
  approval?: {
    requestId: string;    // opencode: properties.id / pi: properties.requestId
    toolName: string;     // opencode: properties.permission / pi: properties.toolName
    patterns: string[];   // opencode: 工具建议的放行 patterns（如 "git status*"）；pi: []
    metadata?: Record<string, unknown>;  // opencode: metadata / pi: { args, risk }
  } | null;
}
```

- 对齐 compaction 切面先例（raw type 字符串匹配在 normalize 内收敛，调度器只见切面）
- 分类器与策略服务只消费切面，不碰原始 props——修掉事件不对齐缺口

### 5.2 kv_store（gateway.db）

- key `perm-mode/<sessionID>` → `'manual' | 'auto'`（写失败 fail-open 内存态兜底）
- 预算计数：内存 Map，重启清零（与 desktop 现状等价，可接受）

### 5.3 config.yaml approval 段

```yaml
approval:
  allowlist:        # 持久白名单
    - read          # 裸工具名：该工具全部放行
    - "bash:git status"  # tool:prefix：bash 且命令以 "git status" 开头
```

- 条目语义 v1：裸工具名（整工具）或 `tool:prefix`（命令前缀字面匹配，忽略尾部 `*`）
- evaluate 每次经 config 对象懒读（复用现有 config watcher，热生效）

## 6. 核心模块（`gateway/src/core/approval/`）

### 6.1 safety-classifier.ts（纯函数）

```typescript
export interface ApprovalCandidate {
  toolName: string;
  patterns: string[];
  metadata?: { args?: unknown; risk?: string; [k: string]: unknown };
}
export type SafetyVerdict = 'safe' | 'dangerous';
export function classifySafety(candidate: ApprovalCandidate): SafetyVerdict;
```

- 只读白名单：`read / grep / glob / ls / find` → safe
- 危险正则（写类工具的命令/参数匹配）：`rm -rf`、`git push --force` / `git push -f`、`git reset --hard`、`drop table|database`、`mkfs`、fork bomb `:(){ :|:& };:`、`shutdown|reboot` 等 → dangerous
- 其余 → safe

### 6.2 policy-service.ts（状态机，评估顺序固定逐条短路）

```typescript
export type SessionPermissionMode = 'manual' | 'auto';
export const AUTO_APPROVE_BUDGET = 25;  // 承接 desktop permission-mode.ts 语义

export interface PolicyDecision {
  action: 'auto-approve' | 'auto-deny' | 'human';
  verdict: SafetyVerdict;   // human 态供三端危险徽标
  reason: string;           // 审计/日志
}

export interface ApprovalPolicyServiceDeps {
  getInternalRole(sessionID: string): string | undefined;  // internalSessionRoles
  isAllowlisted(toolName: string, candidate: ApprovalCandidate): boolean;  // allowlist-store
  getMode(sessionID: string): Promise<SessionPermissionMode>;
  setMode(sessionID: string, mode: SessionPermissionMode): Promise<void>;  // kv + 内存
  onBudgetExhausted(sessionID: string): void;  // 广播 permission_mode
}
```

- 内部会话判定源：`internalSessionRoles`（manager/btw/index-scan/extract/reflect 已登记；goal execute 等 goal 会话按现有登记面覆盖）
- mode set 时同步广播 `permission_mode` 扁平事件（wire 契约：顶层无 `data` 键）

### 6.3 allowlist-store.ts

- 读：`listAllowlist(): Array<{ tool: string; prefix?: string }>`（懒读 config）
- 写：`addAllowlist(entry)` / `removeAllowlist(entry)`（`config.persistOverrides` 落盘，去重）
- 匹配：`matches(toolName, candidate)`——条目无 prefix → toolName 相等；有 prefix → toolName 相等且候选 patterns 任一 / `metadata.args.command` 以 prefix 开头

### 6.4 handleOpencodeEvent 钩子与事件富化（index.ts）

- 位置：`handleOpencodeEvent` 内、Mode A 广播（~line 1043）之前；仅 `f.approval` 非空时进入
- 同步计算决策 → 广播事件 `properties` 附加 `mafwPolicy: { action, verdict, reason }`
- auto 路径：`void runtime.session.permissionReply?.(sessionID, requestId, 'once'|'reject', reason).catch(warn)`——**不阻塞广播、不重试**
- 整钩子 try/catch：评估抛错 → 按 `human` 广播（宁多问不误放行）+ warn

## 7. HTTP API（`routes/permission-mode.ts` + allowlist 路由，deps 注入可单测）

| 端点 | 语义 |
|---|---|
| `GET /api/sessions/:sessionID/permission-mode` | `{ mode, autoApprovals, budget }` |
| `POST /api/sessions/:sessionID/permission-mode` | body `{ mode }` 枚举校验 → kv 持久 → 广播 `permission_mode` |
| `GET /api/approvals/allowlist` | `{ entries: [{ tool, prefix? }] }` |
| `POST /api/approvals/allowlist` | body `{ tool, prefix? }` 校验（tool 非空、prefix 可选）→ 增（去重） |
| `DELETE /api/approvals/allowlist` | body `{ tool, prefix? }` → 删 |
| `POST /api/permissions/:id/reply` 扩展 | body 增可选 `persist?: true`：`reply:'always'` 时照常 runtime reply，再把 tool/prefix 写白名单（patterns 从 `permissionList` 反查） |

- **路由注册顺序**：具体路径（`/api/sessions/:sessionID/permission-mode`、`/api/approvals/allowlist`）必须注册在 `/api/permissions/:id` 通配匹配之前（triage 路由吞噬教训）
- 不新增能力位门控：policy 评估在事件层（无 asked 事件 = 不触发）；HTTP 面沿用现有 `nativeApprovals` 门（reply/allowlist 涉及审批面）

## 8. SDK（`packages/gateway-sdk`）

`permissions` 命名空间：
- `getMode(sessionID)` / `setMode(sessionID, mode)`
- `listAllowlist()` / `addAllowlist({ tool, prefix? })` / `removeAllowlist({ tool, prefix? })`
- reply 扩展 `persist?: boolean` 参数

## 9. 三端接入

### 9.1 Desktop

- mode 状态：`permissionModes` createStore 保留为本地缓存；驱动源 = 开 tab 时 `permissions.getMode()` 拉取 + SSE `permission_mode` 事件更新；🛡 toggle 调 `setMode()`（乐观更新，失败回滚 + ToastV2）
- **删除**：`MafwShell.tsx:1398-1405` renderer auto-approve 块、`shouldAutoApprove` 调用、`permission-mode.ts` 本地判定逻辑（纯函数测试随语义迁 gateway，desktop 文件删除）
- 卡片渲染读 `properties.mafwPolicy`：
  - `action: 'auto-approve'` → 直接 resolved 非交互卡「已自动放行 (auto)」——不进串行队列、不发 notifyIfHidden
  - `action: 'auto-deny'` → resolved「已自动拒绝（内部会话）」
  - `action: 'human'` → 现有交互流程；`verdict: 'dangerous'` 显示高危徽标（双击 arm 类）
  - **兜底**：auto 决策发出后 5s 内未见 `permission.replied` 事件 → 卡片回退 pending 态渲染（reply 调用失败时用户仍可手动答复；`mafwPolicy` 是建议语义）
- `mapPermissionCard` 本地 risk 启发式废弃，改读 `mafwPolicy.verdict`
- PermissionCard 第三动作「持久允许」（TooltipV2：“跨会话记住”）→ reply `persist: true`

### 9.2 TUI

- 状态栏 `🛡` 徽标（mode=auto 时显示；初始 `getMode` + `permission_mode` SSE 驱动）
- 新 slash 命令 `/permissions`（alias `/perm`，immediate 类，COMMAND_REGISTRY 注册）切换 manual/auto
- asked overlay 门控：`mafwPolicy.action !== 'human'` 不弹 overlay（transcript 渲染一行 dim 结果记录）；human 照旧弹 once/always/reject + 第四项「持久允许」

### 9.3 Config 页「审批 Approvals」区块

- allowlist 表格：tool / prefix / 删除按钮（ButtonV2 + TooltipV2）
- 添加行：TextInputV2 tool + TextInputV2 prefix（可选）+ 添加
- CRUD 后本地刷新（不轮询）；空态文案说明条目在评估顺序（§6.2）中的位置

## 10. 错误处理

| 场景 | 行为 |
|---|---|
| 评估器同步抛错 | try/catch → 按 `human` 广播 + warn（宁多问不误放行） |
| `permissionReply` 异步失败 | warn + 不重试；pi bridge 5min 超时自然拒绝；desktop 5s 兜底回退 pending |
| kv 写失败 | mode 变更内存态生效 + warn |
| allowlist 读写失败 | 评估时当空表（fail-open）；CRUD 端点 500 + Toast |
| runtime 热切换 | policy-service 无 runtime 耦合（只消费切面 + 当前 runtime 句柄），零处理 |

## 11. 测试策略（TDD）

- **gateway jest（~50 例）**：safety-classifier 危险正则与白名单边界（~15）；policy-service 六分支 + 预算回落 + 内部会话 deny（~12）；allowlist-store CRUD + 坏配置 + 匹配（~6）；normalize approval 切面双 runtime 形状（~4）；HTTP 路由含 `:id` 前置顺序（~8）；事件富化集成 fake runtime（~5）
- **desktop bun test（~10 例）**：mafwPolicy 渲染分流（auto/deny/human/5s 兜底回退）、mode store 迁移、持久允许按钮
- **TUI node --test（~6 例）**：`/perm` 命令、overlay 门控、状态栏徽标
- 每批交付汇报新增测试数与全量通过数（含版本号 + commit 哈希，用户惯例）

## 12. 分批实施

| 批 | 内容 | 解锁 |
|---|---|---|
| 1 | approval 切面 + safety-classifier + policy-service + kv 持久 + handleOpencodeEvent 钩子 + 事件富化 | gateway 单一真相源成型 |
| 2 | HTTP 路由 + SDK + allowlist-store + reply persist 扩展 | 接口面可用 |
| 3 | Desktop 迁移（删 renderer auto 块、mafwPolicy 渲染分流、持久允许按钮、Config 页编辑器） | 三端一致 |
| 4 | TUI `/perm` + 徽标 + overlay 门控 | 收尾 |

- 每批 TDD 全绿后直接提交 main（项目惯例），附版本号 + commit + 测试数汇报
- 风险最大点：批 3 删 renderer 逻辑的桌面回归——用 bun test 渲染分流用例兜住

## 13. 关键代码参照

| 事项 | 位置 |
|---|---|
| 切面先例 | `gateway/src/runtime/normalize.ts`（compaction 切面） |
| 事件钩子点 | `gateway/src/index.ts:919` handleOpencodeEvent；Mode A 广播 ~1043 |
| per-session guard 参照 | `gateway/src/core/budget-guard.ts` + index.ts budgetGuards map |
| 内部会话登记 | `index.ts` registerInternalSession / internalSessionRoles |
| pi asked 形状 | `gateway/src/runtime/pi/pi-approval-extension.ts:40-51`（requestId/toolName/args/risk） |
| opencode asked 形状 | SDK v2 types：id/permission/patterns/metadata/always |
| 待删 renderer 逻辑 | `MafwShell.tsx:1398-1405`、`components/permission-mode.ts` |
| 现有 reply 路由 | `routes/permission.ts` + `index.ts:4165`（persist 扩展点） |
| 广播 wire 契约 | `runtime/event-broadcast.ts`（扁平无 data 键） |
| kv 先例 | gateway.db kv_store（manager-session） |
| 配置落盘 | `config.persistOverrides`（embedding-config 等路由先例） |
