# T1 Backfill Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 T1 回填 heartbeat 报告真实 flush 落盘数，并修复 NULL observation_key 导致的潜在分页尾部跳过。

**Architecture:** backfill 纯逻辑分别报告 queued/indexed/failed；数据库分页的分母与 SELECT 使用同一 non-null 集合。只修控制逻辑，不触发真实回填。

**Tech Stack:** TypeScript、Jest、better-sqlite3/GatewayDatabase。

**Spec:** `docs/research/2026-11-18-memory-health-root-causes.md` §2。

## Global Constraints

- 实施者是 `gateway/volcengine/deepseek-v4.1-flash` 子代理；主 checkout，不建 worktree、不 push。
- 不运行 live backfill、decay、embed 或数据迁移；dense 仍保持 shadow。
- 在 vector-integrity 计划之后串行实施，避免并行修改共享 stats 文件。
- TDD RED→GREEN；子代理不 commit、不 build/restart。

## Review Focus

- flush 部分成功必须 indexed < queued → Task 1。
- flush reject 必须 indexed=0、failed=queued → Task 1。
- NULL key archive 行不得改变 non-null 全局 offset → Task 2。
- 现有 archive-first 顺序、limit=0、空内容与每日上限保持不变 → 全套既有测试。

---

### Task 1: 上报真实 flush 结果

**Files:**
- Modify: `gateway/src/memory/t1-backfill.ts`
- Test: `gateway/tests/unit/memory/t1-backfill.test.ts`

**Interfaces:**
- `T1BackfillResult` 增加 `queued: number`；`indexed` 只取 flush 确认数。
- 无 queued 时仍不调用 flush；失败时 fail-open。

- [ ] **Step 1: 修改/新增失败测试**

部分失败 fixture：2 rows queued，flush 返回 `{indexed:1, failed:1}`，期望 `{scanned:2,queued:2,indexed:1,missing:0,failed:1}`。flush reject fixture 期望 queued=1、indexed=0、failed=1。同步更新其它断言以包含 queued，但不得放宽原断言语义。

- [ ] **Step 2: 验证 RED**

Run: `cd gateway; npx jest tests/unit/memory/t1-backfill.test.ts --runInBand`

Expected: 当前 `indexed=queued` 与缺 queued 导致 FAIL。

- [ ] **Step 3: 最小实现**

初始化并返回 queued；flush 成功时采用其 indexed/failed，reject 时 indexed 保持 0、failed=queued。不改限流和遍历策略。

- [ ] **Step 4: 验证 GREEN**

Run: `cd gateway; npx jest tests/unit/memory/t1-backfill.test.ts --runInBand`

Expected: 文件内全部 PASS。

### Task 2: non-null archive 分页对齐

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts:2111-2140`
- Test: `gateway/tests/unit/memory/t1-backfill.test.ts`

**Interfaces:**
- `listT1RowsForBackfill({offset,limit})` 签名与返回形状不变。

- [ ] **Step 1: 写失败测试**

构造 archive non-null A、archive NULL、archive non-null B、active C；用临时 DB 现有 append/archive 后只对测试行 UPDATE observation_key=NULL。断言 offset=0/1/2 跨页返回 A/B/C，既不跳过 B，也不重复或读到 NULL 行。

- [ ] **Step 2: 验证 RED**

Run: `cd gateway; npx jest tests/unit/memory/t1-backfill.test.ts --runInBand`

Expected: 当前 archiveCount 包含 NULL，跨表 offset 错位而 FAIL。

- [ ] **Step 3: 最小实现**

archiveCount 查询改为与 SELECT 相同的 `WHERE observation_key IS NOT NULL`；不改 ORDER BY、archive-first 或调用方。

- [ ] **Step 4: 验证 GREEN 与类型**

Run: `cd gateway; npx jest tests/unit/memory/t1-backfill.test.ts tests/unit/memory/route-write.test.ts --runInBand; npx tsc --noEmit -p tsconfig.json`

Expected: PASS、类型门禁 exit 0。更新 `docs/architecture/memory.md`：真实缺口仍在，dense shadow，本轮没有提高实际覆盖率；记录新增测试数并交父会话全量验收。
