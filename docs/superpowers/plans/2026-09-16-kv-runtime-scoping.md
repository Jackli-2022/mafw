# kv_store runtime 归属规范化实现计划（失效 + TTL 卫生）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** kv_store 语义规范为 runtime-scoped（切换统一失效）/ durable 两类；治 internal-session 5991 条膨胀（启动 TTL=7d）；registry 孤儿 scope 对齐。

**Architecture:** `GatewayDatabase` 新增 `kvClearScope`/`kvPruneOlderThan` 两个可单测方法；Scheduler 的 `invalidateManagerSessions` 扩展为 `invalidateRuntimeScopedKv`（三 scope + 内存 Map 清空，两条切换路径调用点不变）；启动恢复循环前 prune；migrate 的 registry scope 对齐 live。spec：`docs/superpowers/specs/2026-09-16-kv-store-runtime-scoping-design.md`；调研：`docs/research/2026-09-16-kv-runtime-scoping.md`。

**Tech Stack:** TypeScript（gateway，better-sqlite3）、Jest。

## Global Constraints

- prune 判定式：`now - at > ttlDays * 86_400_000`（**严格大于**才删）；无 `at` 的条目保守保留
- runtime-scoped scope 清单（逐字）：`manager-session`、`internal-session`、`reflect-cursor`；durable：`registry/snapshot`、`milestone-notified`——不动
- 切换失效必须同时清 `internalSessionRoles` 内存 Map（旧 runtime 角色映射全部失效，新 worker 注册时重建）
- 所有编辑用 Edit 工具精确替换；禁止 PowerShell 管道重写整文件（编码损坏前科）
- 提交直接 main；测试命令在 `gateway/` 目录：`npx jest <file>`；构建 `npm run build`

---

### Task 1: GatewayDatabase kvClearScope / kvPruneOlderThan（TDD）+ scope 规范注释

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts:407`（scope 规范注释）、`:434` 后（两个新方法）
- Create: `gateway/tests/unit/gateway-db-kv.test.ts`

**Interfaces:**
- Produces: `kvClearScope(scope: string): number`（删整 scope，返回删除数）、`kvPruneOlderThan(scope: string, ttlDays: number): number`（按 value.at 判龄，严格大于才删，无 at 保留）——Task 2 消费

- [ ] **Step 1: 写失败测试（新文件）**

```typescript
import { GatewayDatabase } from '../../src/memory/gateway-db';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('GatewayDatabase kvClearScope / kvPruneOlderThan', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwdb-kv-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  it('kvClearScope deletes every entry in the scope and returns the count', () => {
    const keep = { at: daysAgo(1) };
    db.kvSet('internal-session', 'a', { role: 'index-scan', at: daysAgo(1) });
    db.kvSet('internal-session', 'b', { role: 'extract', at: daysAgo(2) });
    db.kvSet('other', 'c', keep);
    expect(db.kvClearScope('internal-session')).toBe(2);
    expect(db.kvAll('internal-session')).toEqual([]);
    expect(db.kvGet('other', 'c')).toEqual(keep);
  });

  it('kvClearScope returns 0 for an empty or unknown scope', () => {
    expect(db.kvClearScope('nope')).toBe(0);
  });

  it('kvPruneOlderThan removes entries past the TTL and keeps fresh ones', () => {
    const oldAt = new Date(Date.now() - 7 * 86_400_000 - 60_000).toISOString();
    const freshAt = daysAgo(1);
    db.kvSet('internal-session', 'old', { role: 'index-scan', at: oldAt });
    db.kvSet('internal-session', 'fresh', { role: 'extract', at: freshAt });
    expect(db.kvPruneOlderThan('internal-session', 7)).toBe(1);
    expect(db.kvGet('internal-session', 'old')).toBeNull();
    expect(db.kvGet('internal-session', 'fresh')).toEqual({ role: 'extract', at: freshAt });
  });

  it('kvPruneOlderThan keeps entries just inside the TTL (strictly-greater rule)', () => {
    const at = new Date(Date.now() - 7 * 86_400_000 + 60_000).toISOString();
    db.kvSet('internal-session', 'edge', { role: 'reflect', at });
    expect(db.kvPruneOlderThan('internal-session', 7)).toBe(0);
    expect(db.kvGet('internal-session', 'edge')).not.toBeNull();
  });

  it('kvPruneOlderThan keeps entries without an `at` field (conservative)', () => {
    db.kvSet('internal-session', 'legacy', { role: 'manager' });
    expect(db.kvPruneOlderThan('internal-session', 7)).toBe(0);
    expect(db.kvGet('internal-session', 'legacy')).toEqual({ role: 'manager' });
  });

  it('pruned entries disappear from kvAll', () => {
    db.kvSet('internal-session', 'a', { role: 'extract', at: daysAgo(30) });
    db.kvPruneOlderThan('internal-session', 7);
    expect(db.kvAll('internal-session')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run（workdir `gateway/`）: `npx jest tests/unit/gateway-db-kv.test.ts`
Expected: 全部 FAIL（`kvClearScope is not a function` / `kvPruneOlderThan is not a function`）。

- [ ] **Step 3: 实现**

`gateway-db.ts:407` 的区块注释替换为：

```typescript
  // ── KV store (small critical state) ─────────────────────────────────────
  // Scope 归属规范（新增 scope 必须声明一类）：
  // - runtime-scoped：生命周期绑定当前 agent runtime（会话 id 属于 runtime 存储），
  //   切换时由 Scheduler.invalidateRuntimeScopedKv 统一失效——
  //   manager-session / internal-session / reflect-cursor
  // - durable：跨 runtime 有效——registry/snapshot / milestone-notified
  // runtime-scoped 条目的 value 必须携带 `at`（ISO 日期）供 TTL/审计。
```

`kvAll` 方法（:446 结束的 `}`）之后插入：

```typescript
  kvClearScope(scope: string): number {
    const info = this.db.prepare('DELETE FROM kv_store WHERE scope = ?').run(scope);
    return info.changes;
  }

  kvPruneOlderThan(scope: string, ttlDays: number): number {
    const now = Date.now();
    let removed = 0;
    for (const { key, value } of this.kvAll<Record<string, unknown>>(scope)) {
      const at = value && typeof value === 'object' ? (value as Record<string, unknown>).at : undefined;
      const ts = typeof at === 'string' ? Date.parse(at) : NaN;
      if (!isNaN(ts) && now - ts > ttlDays * 86_400_000) {
        this.kvDelete(scope, key);
        removed++;
      }
    }
    return removed;
  }
```

- [ ] **Step 4: 运行测试确认全绿**

Run（workdir `gateway/`）: `npx jest tests/unit/gateway-db-kv.test.ts`
Expected: 6 例全 PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-kv.test.ts
git commit -m "feat(gateway-db): kvClearScope + kvPruneOlderThan with scope ownership docs"
```

---

### Task 2: Scheduler 接线（invalidateRuntimeScopedKv + 启动 TTL + migrate 对齐）

**Files:**
- Modify: `gateway/src/index.ts`（invalidateManagerSessions 重写扩展；两处调用点改名；:1911 前插 TTL prune；:176 前加常量）
- Modify: `gateway/src/recall/gateway-db-migrate.ts:95-99`（registry scope 对齐）

**Interfaces:**
- Consumes: Task 1 的 `kvClearScope` / `kvPruneOlderThan`
- Produces: `invalidateRuntimeScopedKv(): void`（private，两条切换路径调用）

- [ ] **Step 1: 重写 invalidateManagerSessions → invalidateRuntimeScopedKv**

将现方法整体替换为：

```typescript
  // Runtime-scoped kv entries reference session ids in the ACTIVE runtime's
  // storage (opencode SQLite vs pi SessionManager). A runtime hot-switch
  // invalidates them: the ids do not exist under the new backend ("Pi session
  // not found"). Drop all three scopes so the next touch re-ensures sessions
  // in the new runtime. Called from BOTH switch paths (route onSwitched +
  // config hot-reload watcher). Scope classification: see gateway-db.ts kv API.
  private invalidateRuntimeScopedKv(): void {
    try {
      const db = this.getGatewayDb();
      const cleared = ['manager-session', 'internal-session', 'reflect-cursor']
        .map((scope) => `${scope}=${db.kvClearScope(scope)}`);
      this.internalSessionRoles.clear();
      log.info(`[Scheduler] runtime-scoped kv invalidated (runtime switch): ${cleared.join(', ')}`);
    } catch (err: any) {
      log.warn(`[Scheduler] runtime-scoped kv invalidation failed (non-fatal): ${err.message}`);
    }
  }
```

- [ ] **Step 2: 两处调用点改名**

`this.invalidateManagerSessions();`（onSwitched 与 config watcher 各一处）→ `this.invalidateRuntimeScopedKv();`（replaceAll）。

- [ ] **Step 3: 模块级常量 + 启动 TTL**

`gateway/src/index.ts:176`（`class MafwScheduler {`）之前插入：

```typescript
const INTERNAL_SESSION_TTL_DAYS = 7;
```

恢复循环前（`const restored = this.getGatewayDb().kvAll<{ role: string }>('internal-session');` 一行）替换为：

```typescript
      const pruned = this.getGatewayDb().kvPruneOlderThan('internal-session', INTERNAL_SESSION_TTL_DAYS);
      if (pruned > 0) log.info(`[Scheduler] pruned ${pruned} stale internal-session kv entries (> ${INTERNAL_SESSION_TTL_DAYS}d)`);
      const restored = this.getGatewayDb().kvAll<{ role: string }>('internal-session');
```

- [ ] **Step 4: migrate registry scope 对齐**

`gateway/src/recall/gateway-db-migrate.ts` 的 ④ 块替换为：

```typescript
    // ④ registry snapshot (refreshed every start) — scope/key aligned with the
    // live read/write path (index.ts 'registry/snapshot'/'default'); the legacy
    // 'registry' scope is removed idempotently.
    if (registrySnapshot !== null) {
      db.kvSet('registry/snapshot', 'default', registrySnapshot);
      db.kvDelete('registry', 'snapshot');
      result.registrySnapshot = true;
    }
```

- [ ] **Step 5: 构建 + 全量测试**

Run（workdir `gateway/`）: `npm run build; npx jest --silent`
Expected: build exit 0；全量 PASS（新增 6 例）。

- [ ] **Step 6: Commit**

```bash
git add gateway/src/index.ts gateway/src/recall/gateway-db-migrate.ts
git commit -m "feat(gateway): runtime-scoped kv invalidation + internal-session TTL + registry scope alignment"
```

---

### Task 3: 人工验证 + 交付汇报

- [ ] **Step 1: 验证点**（告知用户，需 gateway 重启生效——走 mafw-gateway-restart 流程）：①切换 runtime 后日志出现 `runtime-scoped kv invalidated: manager-session=n1, internal-session=n2, reflect-cursor=n3`；②DB 三 scope 归零；③重启后启动日志出现 prune 计数（首跑约删 5900+ 条）；④`registry` 孤儿 scope 消失
- [ ] **Step 2: 汇报**：新增测试数（6）+ 全量通过数 + commit 哈希 + gateway 重启（全局包 dist 覆盖 + restart 令牌，同 b0b0c043 流程）
