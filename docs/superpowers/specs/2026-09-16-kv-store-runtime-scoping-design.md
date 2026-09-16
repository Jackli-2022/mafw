# kv_store runtime 归属规范化设计（槽位共存 + TTL 卫生）

日期：2026-09-16
状态：已批准（初版失效式 → 修订为槽位式，见下方「修订 2026-09-16」；对话中用户确认：manager 按 runtime 分槽、切回即恢复之前的 manager；internal-session/reflect-cursor 撤销切换失效）

## 修订 2026-09-16：槽位式取代失效式

初版的"切换统一失效"被用户质询推翻（"清空了我回到 opencode 还是之前的 manager 吗"）——失效有两个真实代价：①manager 话题切回后指针丢失、ensure 重开会话；②internal-session 清空后切回，旧 worker 角色映射丢失 → `isHiddenSession` 失效 → 垃圾会话在 Rail 重新可见（#mem-j1c03v 治理成果倒退）。

**修正：per-runtime 槽位共存，切换零失效。**

- **manager-session 值结构 v2**（key 不变 = projectDir，value 内分槽）：

```typescript
// v1（旧）：{ sessionId: string; createdAt?: string | null; runtime?: string }
// v2（新）：{ byRuntime: { [runtimeName: string]: { sessionId: string; createdAt: string } } }
```

  - **读**：`readManagerSlot(value, currentRuntime)`——v2 取 `byRuntime[currentRuntime]`；v1 旧格式按 `ses_*`/`pi_*` 前缀推断归属，匹配当前 runtime 才返回（**不删除**，切回后仍可恢复）
  - **写**：`writeManagerSlot(existing, currentRuntime, slot)`——v2 保留其余槽只写当前槽；v1 先迁移（旧条目进其前缀推断的槽）再写当前槽
  - rotate = writeManagerSlot 的当前槽替换语义（只动当前 runtime 的话题）
  - **不再有任何删除路径**（异 runtime 条目从"死数据"变为"休眠槽位"）
- **撤销切换失效**：`invalidateRuntimeScopedKv` 方法与两处调用移除（含 `internalSessionRoles.clear()`）——`internal-session`/`reflect-cursor` 的 key（会话 id）跨 runtime 天然唯一，两套共存互不冲突
- **保留**：启动 TTL=7d prune（internal-session 膨胀治理）、registry 孤儿对齐（已完成）、durable scope 不变、桌面端切换刷新不变
- **runtime 划分终表**：manager-session = 槽位式（指针类）；internal-session / reflect-cursor = 共存（key 自带 runtime 命名空间，附属数据类）；registry/snapshot、milestone-notified = durable（事实性/gateway 自有状态）；`gateway.db` 整体不做 per-runtime 划分（会话本体在各 runtime 自己的后端，kv 只存指针与元数据）
- 边界：runtime 插件卸载/改名后槽位残留，上界 = 用过的 runtime 数（2-3 个），无清理（YAGNI）

以下初版内容中与修订冲突的部分（invalidateRuntimeScopedKv、校验删除式读取）以上述修订为准。

---

## 初版：背景与问题

| scope | 条数 | key → value | 语义 | runtime 归属 |
|---|---|---|---|---|
| `internal-session` | **5991** | sessionId → `{role, at}` | 内部 worker 会话角色注册（index-scan/extract/reflect），`isHiddenSession` 与 SSE tiered policy 的权威数据源；启动时全量恢复进 `internalSessionRoles` 内存 Map（index.ts:1911） | **runtime-scoped**：实测混装 `ses_*` 4936 + `pi_*` 1055 |
| `reflect-cursor` | 74 | sessionId → mem_ids[] | 反思管线增量游标 | runtime-scoped（会话消失后成死数据） |
| `manager-session` | 6 | projectDir → `{sessionId, createdAt}` | per-project manager 会话 | runtime-scoped（切换 invalidate 已落地，commit b0b0c043） |
| `registry` | 1 | snapshot → entries | 项目注册表快照——**孤儿**：仅 migrate（gateway-db-migrate.ts:97）写入，无任何读者 | durable |
| `registry/snapshot` | 1 | default → entries | 同上（live 读写：index.ts:5201/:5239；权威仍在 `scheduler/registered-projects.json`） | durable |

另有 `milestone-notified`（key=goalId:phase:stateVersion，去重标记，durable）。

### 内部证据

- internal-session 年龄分布：**95%（5684 条）为 14-30 天前**；唯一删除点是 btw 一次性问答 finally（index.ts:6161），turnCompress worker 持久会话的条目从不清理 → 无限膨胀
- 违反既定规律（#mem-igpk6x）：无人看管的后台计算必须有**明确属主、TTL 与 kill-switch**——internal-session 缺 TTL
- 非 manager-session 的 runtime-scoped kv 在 runtime 切换时不失效（本次 manager 500 事故的同族缺口，只是消费方恰好无害）

### 业界调研

- **LangGraph checkpointer**（docs.langchain.com/oss/python/langgraph/persistence）：thread 概念上属于具体 checkpointer backend（PostgresSaver/SqliteSaver 的 thread 互不可见）；官方 Troubleshooting 承认 "Checkpoints growing unboundedly"，官方建议 = 定期 prune / retention policy
- **Temporal Namespace**（docs.temporal.io/namespaces）：标识符唯一性以隔离单元为界；**Retention 是 per-namespace 配置**
- Docker/kubectl context、Chrome profile = 并存隔离派（per-backend 数据 + current 指针），前提是"切回常见且数据有持续访问价值"——MAFW 的 runtime-scoped kv（manager 话题重开成本≈0、worker role 只对可达会话有意义）不满足该前提 → **per-runtime 命名空间方案排除**

## 目标

kv 语义规范化为两类，并在运行时强制：

- **runtime-scoped**：`manager-session`、`internal-session`、`reflect-cursor`——生命周期绑定当前 runtime，切换时统一失效
- **durable**：`registry/snapshot`、`milestone-notified`——跨 runtime 有效

## 实现

**1. `GatewayDatabase` 新增两个方法（TDD，`gateway/tests/unit/gateway-db-outcome.test.ts` 同文件或新建 `gateway-db-kv.test.ts`）**：

```typescript
/** Delete every entry in a scope; returns the number of removed keys. */
kvClearScope(scope: string): number

/** Delete entries in a scope older than ttlDays (entry value.at ISO date; entries without value.at are kept). Returns removed count. */
kvPruneOlderThan(scope: string, ttlDays: number): number
```

语义细节：`kvPruneOlderThan` 以 value JSON 里的 `at` 字段判龄（internal-session 条目均含 `at`）；判定式 `now - at > ttlDays * 86_400_000`（**严格大于**才删，正好 7 天保留）；无 `at` 的条目保守保留。

**2. Scheduler：`invalidateManagerSessions` → `invalidateRuntimeScopedKv`**（index.ts）：

```typescript
private invalidateRuntimeScopedKv(): void {
  try {
    const db = this.getGatewayDb();
    const cleared = ['manager-session', 'internal-session', 'reflect-cursor']
      .map((scope) => ({ scope, n: db.kvClearScope(scope) }));
    this.internalSessionRoles.clear();
    log.info(`[Scheduler] runtime-scoped kv invalidated: ${cleared.map((c) => `${c.scope}=${c.n}`).join(', ')}`);
  } catch (err: any) {
    log.warn(`[Scheduler] runtime-scoped kv invalidation failed (non-fatal): ${err.message}`);
  }
}
```

- 同时 `internalSessionRoles` 内存 Map 清空（旧 runtime 的角色映射全部失效；新 worker 注册时重建）
- 调用点不变：路由 `onSwitched` 与 config watcher 两条切换路径（均已挂 invalidateManagerSessions，改名替换）

**3. 启动 TTL 清理**（index.ts :1911 恢复循环之前）：

```typescript
const pruned = this.getGatewayDb().kvPruneOlderThan('internal-session', INTERNAL_SESSION_TTL_DAYS);
if (pruned > 0) log.info(`[Scheduler] pruned ${pruned} stale internal-session kv entries (> ${INTERNAL_SESSION_TTL_DAYS}d)`);
```

常量 `INTERNAL_SESSION_TTL_DAYS = 7`（模块级，与 #mem-igpk6x 的 TTL 规律一致）。恢复循环只恢复存活条目。

**4. registry 孤儿对齐**（gateway-db-migrate.ts :95-99）：

```typescript
// ④ registry snapshot (refreshed every start) — scope/key aligned with the
// live read/write path (index.ts), legacy 'registry' scope removed.
if (registrySnapshot !== null) {
  db.kvSet('registry/snapshot', 'default', registrySnapshot);
  db.kvDelete('registry', 'snapshot');
  result.registrySnapshot = true;
}
```

**5. kv scope 规范文档**（gateway-db.ts kv API 注释）：

```
kv_store scope 归属规范（新增 scope 必须声明一类）：
- runtime-scoped：生命周期绑定当前 agent runtime（会话 id 属于 runtime 存储），切换时由
  invalidateRuntimeScopedKv 统一失效——manager-session / internal-session / reflect-cursor
- durable：跨 runtime 有效——registry/snapshot / milestone-notified
runtime-scoped 条目的 value 必须携带 `at`（ISO 日期）供 TTL/审计。
```

## 非目标

- 不做 per-runtime 命名空间（调研排除）
- 不动 runtime-scoped kv 的 API 形状（kvGet/kvSet 签名不变，调用点不拼前缀）
- reflect-cursor 的会话级惰性清理（会话删除时顺手清游标）——现有 trim 已控量，切换失效覆盖主要场景，YAGNI
- internal-session 在切换之外的上游限流（worker 复用机制不变）

## 验证

- **TDD**：`kvClearScope` / `kvPruneOlderThan` 单测（GatewayDatabase 内存/临时 DB 实例，对齐 gateway-db-outcome.test.ts 先例）——约 6 例：clearScope 返回计数且清空、clearScope 空 scope 0、prune 按 at 删旧留新、prune 无 at 保留、prune 边界（正好 7 天保留、超过 7 天删除）、prune 后 kvAll 为空
- gateway 构建 + 全量 jest
- 人工验证：切换 runtime 后日志出现 `runtime-scoped kv invalidated: manager-session=n1, internal-session=n2, reflect-cursor=n3`；DB 中三个 scope 归零；重启后启动日志出现 prune 计数
