# Lead / Tech Lead P1：工作集与缺页实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lead 的上下文从「一条长 session」变成可换入换出的工作集：当前话题驻留、近期话题留摘要、旧话题按需召回、压缩不丢决策、旧话题可恢复继续。

**Architecture:** 在 P0 的 `lead_topic`（handoff provenance）上扩展 summary / state / token 元数据，新增 `topic_message_index` 作为可检索的换出页；纯函数负责工作集选择、召回打分、摘要/压缩与上下文块拼装；`LeadTopicService` 组合 store + index + recall，HTTP 暴露 topic index / resume / compact / context；opencode 宿主插件在每回合 `messages.transform` 里按 100ms 预算注入 `<topic-index>` / `<recalled-topic>`（fail-open）。不删除任何原始 transcript，不改 Tech Lead / NodeDriver 内核。

**Tech Stack:** TypeScript、better-sqlite3、jest（gateway）、node:test + `@mafw/test-shim`（desktop）、SolidJS、`@mafw/ui` v2、opencode 宿主插件 hooks。

**Spec:** `docs/superpowers/specs/2026-11-10-lead-techlead-p1-working-set-design.md`（父设计 `docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`）

> 测试片段里的 `msg()` / `topic()` / `baseTopic()` / `indexRow()` 是各测试文件内的 fixture helper，字段与本计划 Interfaces 一致；不要求跨文件共享。

## Global Constraints

- 用户永远看不到 session id / compaction 按钮 / working-set 术语。
- **不删除原始 transcript**：压缩只写 summary / state / index，原始消息与 `lead-handoff.md` 保留。
- 决策、未结事项、用户原话**永不裁剪**；预算不足先裁 recalled，再裁 topic-index，再截断当前话题的工具输出。
- 缺页召回默认 **最多 2 个 topic**、单次注入 ≤ **1200 tokens**；低于置信阈值不注入（fail-open，避免串味）。
- 首 token 不被阻塞：召回同步且 ≤ **100ms**（超时 fail-open）；摘要生成走后台，不占用户回合。
- 功能开关 `MAFW_LEAD_WORKING_SET=0` 关闭召回/上下文注入，回退 P0 行为；topic list/get/resume 仍可用。
- 旧 `lead_topic` 行迁移后 `state='warm'`、`summary=NULL`，后台逐步生成；不得回填伪造摘要。
- 所有新路由进 `gateway/src/routes/route-catalog.ts`；契约产物用 `emit:openapi` + SDK `gen:api` 重新生成。
- 桌面 UI 只用 `@mafw/ui` v2 组件；不新增裸 `<button>` / `<input>` / `title`；Tooltip `openDelay: 300`。

## Review Focus

- **低置信召回不得注入**：用户问「最近怎么样」这类泛化句时，`recallTopics` 必须返回空而不是最相近的 topic。
- **预算裁剪顺序**：recalled 先被裁、topic-index 其次，决策/未结/用户原话保留；测试要钉住裁剪后的块集合。
- **死 session resume 不改写旧 transcript**：新 session 只写新消息，旧 topic 行变 `warm`，`resumed_from` 指向旧 id。
- **P0 存量行兼容**：没有 summary/state 的 `lead_topic` 行参与 list/working-set 时不崩、不伪造内容。
- **每回合注入不拖慢首 token**：context 端点超时/非 200/非 Lead session 时插件静默跳过，合成 part 不进入持久历史。

---

### Task 1: `lead_topic` 扩展 + `topic_message_index` store

**Files:**
- Modify: `gateway/src/core/lead/lead-topic-store.ts`
- Create: `gateway/src/core/lead/topic-message-index.ts`
- Test: `gateway/tests/unit/lead/lead-topic-store.test.ts`、`gateway/tests/unit/lead/topic-message-index.test.ts`

**Interfaces:**
- Produces:
```ts
export type LeadTopicState = 'resident' | 'warm' | 'cold' | 'archived';
export interface LeadTopicRow {
  // P0 fields unchanged
  id: string; projectDir: string; leadSessionId: string; title: string;
  startMessageId: string; endMessageId: string; goalId: string;
  ownerRole: 'lead' | 'tech-lead'; ownerSessionId: string | null; createdAt: string;
  // P1
  summary: string | null;
  summaryHash: string | null;
  summaryUpdatedAt: string | null;
  state: LeadTopicState;
  lastActiveAt: string;
  residentTokens: number;
  resumedFrom: string | null;
}
export class LeadTopicStore {
  listByProject(projectDir: string, limit?: number): LeadTopicRow[];
  search(projectDir: string, query: string, limit?: number): LeadTopicRow[];
  updateSummary(id: string, input: { summary: string; summaryHash: string; now: string; residentTokens: number }): void;
  setState(id: string, state: LeadTopicState, now: string): void;
}
export interface TopicMessageIndexRow {
  topicId: string; messageId: string; role: 'user' | 'assistant';
  text: string; tokenEstimate: number; createdAt: string;
}
export class TopicMessageIndexStore {
  constructor(db: Database);
  replaceTopic(topicId: string, rows: TopicMessageIndexRow[]): void;
  listByTopic(topicId: string, limit?: number): TopicMessageIndexRow[];
  listByProject(projectDir: string, limit?: number): Array<TopicMessageIndexRow & { topicId: string }>;
}
```
- `insert()` keeps P0 signature but accepts optional P1 fields (`state`, `summary`, `lastActiveAt`, `residentTokens`, `resumedFrom`); defaults `warm` / `createdAt` / `null` / `0`.

- [ ] **Step 1: Write the failing tests**

```ts
test('legacy lead_topic rows migrate to warm with null summary defaults', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE lead_topic (
    id TEXT PRIMARY KEY, project_dir TEXT NOT NULL, lead_session_id TEXT NOT NULL,
    title TEXT NOT NULL, start_message_id TEXT NOT NULL, end_message_id TEXT NOT NULL,
    goal_id TEXT NOT NULL, owner_role TEXT NOT NULL, owner_session_id TEXT, created_at TEXT NOT NULL
  )`);
  db.prepare('INSERT INTO lead_topic VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('t1', '/p', 's1', 'old', 'm1', 'm2', 'g1', 'tech-lead', null, '2026-11-09T00:00:00.000Z');

  const store = new LeadTopicStore(db);
  const row = store.get('t1')!;
  expect(row.state).toBe('warm');
  expect(row.summary).toBeNull();
  expect(row.residentTokens).toBe(0);
  expect(row.resumedFrom).toBeNull();
  expect(row.lastActiveAt).toBe('2026-11-09T00:00:00.000Z');
});

test('search matches title/summary and replaces topic index rows atomically', () => {
  const db = new Database(':memory:');
  const store = new LeadTopicStore(db);
  store.insert({ ...baseTopic('t1'), summary: 'SQLite migration decision', state: 'warm' });
  expect(store.search('/p', 'migration').map((t) => t.id)).toEqual(['t1']);

  const index = new TopicMessageIndexStore(db);
  index.replaceTopic('t1', [indexRow('msg_1', 'user', 'use SQLite')]);
  index.replaceTopic('t1', [indexRow('msg_2', 'assistant', 'migration planned')]);
  expect(index.listByTopic('t1').map((r) => r.messageId)).toEqual(['msg_2']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-topic-store.test.ts tests/unit/lead/topic-message-index.test.ts --runInBand --forceExit`
Expected: FAIL（`TopicMessageIndexStore` 不存在 / `state` undefined）。

- [ ] **Step 3: Implement migration + stores**

`LeadTopicStore` 构造器用 `ensureColumn` 为旧表补 7 列；新表创建语句包含全部列。`listByProject` 按 `last_active_at DESC, created_at DESC, id DESC`；`search` 用 `title LIKE ? OR summary LIKE ?`（`%query%`，escape `%`/`_`），空 query 退回 `listByProject`。`TopicMessageIndexStore` 建表 + `(topic_id, created_at)` 索引；`replaceTopic` 在单事务里 `DELETE` + 批量 `INSERT`。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-topic-store.ts gateway/src/core/lead/topic-message-index.ts gateway/tests/unit/lead/lead-topic-store.test.ts gateway/tests/unit/lead/topic-message-index.test.ts
git commit -m "feat(lead): extend lead_topic working-set fields and message index"
```

---

### Task 2: 工作集预算与 `selectWorkingSet`

**Files:**
- Create: `gateway/src/core/lead/working-set.ts`
- Test: `gateway/tests/unit/lead/working-set.test.ts`

**Interfaces:**
- Consumes: `LeadTopicRow` / `LeadTopicState`（Task 1）。
- Produces:
```ts
export interface WorkingSetBudget {
  maxResidentTokens: number;   // default 60% of 128k = 76800
  warmTopicLimit: number;      // default 5
  warmTopicTokens: number;     // default 300
  recallMaxTopics: number;     // default 2
  recallMaxTokens: number;     // default 1200
}
export interface WorkingSetTopic {
  id: string; state: LeadTopicState; summary: string | null;
  lastActiveAt: string; goalId: string; residentTokens: number;
}
export interface WorkingSet {
  resident: string[];
  warm: string[];
  cold: string[];
  pinned: string[];
  evicted: string[];
}
export function estimateTopicTokens(text: string): number;
export function selectWorkingSet(input: {
  topics: WorkingSetTopic[];
  pinnedTopicIds?: string[];
  budget?: Partial<WorkingSetBudget>;
}): WorkingSet;
```
- 规则：`pinned` 永不进 `cold`；`resident` 状态优先；其余按 `lastActiveAt` 降序取前 `warmTopicLimit` 为 warm，剩余 cold；`evicted` = 因预算被移出 resident 的 id。

- [ ] **Step 1: Write the failing test**

```ts
test('selects resident/pinned/warm/cold by recency and budget', () => {
  const ws = selectWorkingSet({
    topics: [
      topic('r', 'resident', '2026-11-10T04:00:00.000Z'),
      topic('p', 'cold', '2026-11-09T00:00:00.000Z', 'g1'),
      topic('w1', 'warm', '2026-11-10T03:00:00.000Z'),
      topic('w2', 'warm', '2026-11-10T02:00:00.000Z'),
      topic('w3', 'warm', '2026-11-10T01:00:00.000Z'),
    ],
    pinnedTopicIds: ['p'],
    budget: { warmTopicLimit: 2 },
  });
  expect(ws.resident).toEqual(['r']);
  expect(ws.pinned).toEqual(['p']);
  expect(ws.warm).toEqual(['w1', 'w2']);
  expect(ws.cold).toEqual(['w3']);
  expect(ws.evicted).toEqual([]);
});

test('estimateTopicTokens keeps CJK/latin deterministic', () => {
  expect(estimateTopicTokens('hello world')).toBe(2);
  expect(estimateTopicTokens('你好世界')).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/lead/working-set.test.ts --runInBand --forceExit`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement `working-set.ts`**

Token estimate：latin 按空白/标点分词，CJK 每 2 字符 1 token，向上取整；空串 0。`selectWorkingSet` 先收集 pinned 并从候选移除，再按 state/时间排序；resident 超过 `maxResidentTokens` 时从最旧开始移入 `evicted`（保留至少 1 个）。

- [ ] **Step 4: Run test to verify it passes**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/working-set.ts gateway/tests/unit/lead/working-set.test.ts
git commit -m "feat(lead): add working-set budget and selection"
```

---

### Task 3: 摘要与压缩策略 `topic-summary.ts`

**Files:**
- Create: `gateway/src/core/lead/topic-summary.ts`
- Test: `gateway/tests/unit/lead/topic-summary.test.ts`

**Interfaces:**
- Consumes: `MafwMessage`、`estimateTopicTokens`（Task 2）。
- Produces:
```ts
export interface TopicSummary {
  summary: string;
  summaryHash: string;
  residentTokens: number;
}
export interface CompactTopicResult extends TopicSummary {
  beforeTokens: number;
  afterTokens: number;
  evictedMessageIds: string[];
}
export function summarizeTopic(messages: MafwMessage[], maxChars?: number): TopicSummary;
export function compactTopic(input: {
  topicId: string;
  messages: MafwMessage[];
  keepRecentTurns?: number; // default 6
  maxChars?: number;        // default 1200
}): CompactTopicResult;
```
- 摘要固定分段：`Decisions:` / `Open loops:` / `User words:`；决策行匹配 `决定|结论|decision|decided`，未结匹配 `待|未|TODO|open|pending|?`；用户原话取最近 3 条 user text。工具 part 截断到最近 10 行；system/synthetic 丢弃。

- [ ] **Step 1: Write the failing test**

```ts
test('summary keeps decisions, open loops and user words', () => {
  const result = compactTopic({
    topicId: 't1',
    messages: [
      msg('m1', 'user', '决定：使用 SQLite'),
      msg('m2', 'assistant', '好的'),
      msg('m3', 'user', '待办：补迁移测试'),
      msg('m4', 'assistant', '收到'),
      msg('m5', 'user', '继续'),
    ],
    keepRecentTurns: 1,
  });
  expect(result.summary).toContain('决定：使用 SQLite');
  expect(result.summary).toContain('待办：补迁移测试');
  expect(result.summary).toContain('User words:');
  expect(result.evictedMessageIds).not.toContain('m5');
  expect(result.afterTokens).toBeLessThan(result.beforeTokens);
});

test('tool output is truncated but failure lines stay', () => {
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\\n');
  const result = summarizeTopic([toolMsg('m1', long + '\\nERROR: boom')]);
  expect(result.summary).toContain('ERROR: boom');
  expect(result.summary.split('\\n').length).toBeLessThanOrEqual(12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/lead/topic-summary.test.ts --runInBand --forceExit`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement deterministic summary + compact**

`summaryHash` 用 `crypto.createHash('sha256').update(joinedText).digest('hex')`。`compactTopic` 对通话文本做上述分段，保留最近 `keepRecentTurns * 2` 条消息（user+assistant）为“未淘汰”，其余进入 `evictedMessageIds`；不修改输入 messages。

- [ ] **Step 4: Run test to verify it passes**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/topic-summary.ts gateway/tests/unit/lead/topic-summary.test.ts
git commit -m "feat(lead): add deterministic topic summary and compaction policy"
```

---

### Task 4: Handoff 索引 + 摘要调度

**Files:**
- Modify: `gateway/src/core/lead/lead-handoff-service.ts`
- Create: `gateway/src/core/lead/lead-topic-summary-service.ts`
- Modify: `gateway/src/index.ts`（wiring）
- Test: `gateway/tests/unit/lead/lead-handoff-service.test.ts`、`gateway/tests/unit/lead/lead-topic-summary-service.test.ts`

**Interfaces:**
- `LeadHandoffPrepared` 增加 `messages: MafwMessage[]`（scoped，原样）。
- `LeadHandoffDeps` 增加 `onCommitted?(prepared: LeadHandoffPrepared): void`；`commit()` 在 topic insert 后调用（fail-open）。
- Produces:
```ts
export class LeadTopicSummaryService {
  constructor(deps: {
    topics: LeadTopicStore;
    index: TopicMessageIndexStore;
    summarize: typeof summarizeTopic;
    now(): string;
    log?(message: string): void;
  });
  /** Index the handoff messages and write summary; never throws. */
  indexAndSummarize(prepared: { topicId: string; messages: MafwMessage[]; createdAt: string }): void;
}
```
- `indexAndSummarize` 用 `summarizeTopic` → `topics.updateSummary`；index rows 来自 user/assistant text part（`text` trim，`tokenEstimate = estimateTopicTokens`）。全流程 try/catch。

- [ ] **Step 1: Write the failing tests**

```ts
test('handoff commit indexes the topic and schedules a summary', async () => {
  const onCommitted = jest.fn();
  const prepared = await service.prepareForGoal({ projectDir: '/p', leadSessionId: 's1', goalId: 'g1', goalDir, title: 'T' });
  serviceDeps.onCommitted = onCommitted;
  service.commit(prepared!);
  expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({
    topicId: prepared!.topicId,
    messages: expect.arrayContaining([expect.objectContaining({ id: 'm1' })]),
  }));
});

test('summary service writes summary + index in one pass', () => {
  const svc = new LeadTopicSummaryService({ topics, index, summarize: summarizeTopic, now: () => NOW });
  svc.indexAndSummarize({ topicId: 't1', messages: [msg('m1', 'user', '决定：A')], createdAt: NOW });
  expect(topics.get('t1')?.summary).toContain('决定：A');
  expect(index.listByTopic('t1').map((r) => r.messageId)).toEqual(['m1']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-handoff-service.test.ts tests/unit/lead/lead-topic-summary-service.test.ts --runInBand --forceExit`
Expected: FAIL（`messages` 不在 prepared / service 不存在）。

- [ ] **Step 3: Implement indexing + wiring**

`prepareForGoal` 把 `keptMessages(scoped, previous?.endMessageId)` 的结果存进 `prepared.messages`（复用 `lead-handoff.ts` 导出的选择逻辑，避免重复过滤）；`commit` 末尾 `this.deps.onCommitted?.(prepared)` 包 try/catch。`index.ts` 构造两个 store + `LeadTopicSummaryService`，把 `onCommitted` 接到 `indexAndSummarize`。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-handoff-service.ts gateway/src/core/lead/lead-topic-summary-service.ts gateway/src/index.ts gateway/tests/unit/lead/lead-handoff-service.test.ts gateway/tests/unit/lead/lead-topic-summary-service.test.ts
git commit -m "feat(lead): index handoff messages and schedule topic summaries"
```

---

### Task 5: 召回打分 + `<recalled-topic>` 块

**Files:**
- Create: `gateway/src/core/lead/topic-recall.ts`
- Test: `gateway/tests/unit/lead/topic-recall.test.ts`

**Interfaces:**
- Consumes: `LeadTopicRow`（Task 1）、`TopicMessageIndexRow`（Task 1）。
- Produces:
```ts
export interface RecallTopicInput {
  id: string; title: string; summary: string | null;
  index: TopicMessageIndexRow[];
}
export interface RecallCandidate {
  topicId: string; title: string; score: number; matches: string[];
}
export function recallTopics(input: {
  query: string;
  topics: RecallTopicInput[];
  maxTopics?: number; // default 2
  minScore?: number;  // default 0.2
}): RecallCandidate[];
export function buildRecalledBlock(candidate: RecallCandidate, topic: RecallTopicInput): string;
```
- 打分：query 归一化 token（latin 小写；CJK 相邻 2 字 bigram）；title 命中 +0.6、summary +0.3、index text +0.1（同一 token 只计一次）；`score >= minScore` 才返回；排序 `score DESC, topicId ASC`。

- [ ] **Step 1: Write the failing tests**

```ts
test('scores title above summary and drops low confidence', () => {
  const topics = [
    { id: 't1', title: 'SQLite 迁移', summary: null, index: [] },
    { id: 't2', title: 'UI polish', summary: 'migration notes', index: [] },
  ];
  expect(recallTopics({ query: 'sqlite 迁移', topics })[0]).toMatchObject({ topicId: 't1' });
  expect(recallTopics({ query: 'weather tomorrow', topics })).toEqual([]);
});

test('recalled block names the source topic and keeps summary', () => {
  const block = buildRecalledBlock(
    { topicId: 't1', title: 'SQLite 迁移', score: 0.9, matches: ['sqlite'] },
    { id: 't1', title: 'SQLite 迁移', summary: '决定：使用 SQLite', index: [] },
  );
  expect(block).toContain('<recalled-topic');
  expect(block).toContain('SQLite 迁移');
  expect(block).toContain('决定：使用 SQLite');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/lead/topic-recall.test.ts --runInBand --forceExit`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement recall + block**

查询 token 化后，对每个 topic 分别检查 title/summary/index text 是否包含任一 token；`matches` 去重。`buildRecalledBlock` 只输出 summary + 最多 5 条 `index` 关键行（user 优先），带 `topicId`/`title` 属性；无 summary 时输出 `(no summary yet)`，不伪造。

- [ ] **Step 4: Run test to verify it passes**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/topic-recall.ts gateway/tests/unit/lead/topic-recall.test.ts
git commit -m "feat(lead): score topic recall and build recalled blocks"
```

---

### Task 6: Lead 上下文组装 + `GET /api/lead/context`

**Files:**
- Create: `gateway/src/core/lead/lead-context.ts`
- Create: `gateway/src/routes/lead-topics.ts`（本任务只加 context handler）
- Modify: `gateway/src/routes/route-catalog.ts`、`gateway/src/index.ts`
- Test: `gateway/tests/unit/lead/lead-context.test.ts`、`gateway/tests/unit/routes/lead-context-route.test.ts`

**Interfaces:**
- Consumes: `buildLeadGoalStatus`（P0）、`selectWorkingSet`、`recallTopics`、`buildRecalledBlock`。
- Produces:
```ts
export type LeadContextBlockKind = 'goal-status' | 'topic-index' | 'recalled-topic';
export interface LeadContextBlock { kind: LeadContextBlockKind; topicId?: string; title?: string; text: string; tokens: number; }
export interface LeadContext {
  blocks: LeadContextBlock[];
  totalTokens: number;
  recalledTopicIds: string[];
  trimmed: string[];
}
export function buildLeadContext(input: {
  goals: LeadGoalStatus[];
  topics: LeadTopicRow[];
  query: string;
  recalled?: Array<{ candidate: RecallCandidate; topic: RecallTopicInput }>;
  budget?: Partial<WorkingSetBudget>;
}): LeadContext;
```
- 组装顺序：`goal-status` → `topic-index`（warm，最多 5 行）→ `recalled-topic`；`trimmed` 记录被裁块 kind。预算：goal-status 不裁；topic-index 超 `warmTopicTokens * warmTopicLimit` 截断；recalled 超 `recallMaxTokens` 整块丢弃。
- Route: `GET /api/lead/context?sessionID=&query=` → 200 `{ blocks, totalTokens, recalledTopicIds, trimmed }`；非 Lead session → 200 空 `{ blocks: [], totalTokens: 0, ... }`；`MAFW_LEAD_WORKING_SET=0` → 同上。

- [ ] **Step 1: Write the failing tests**

```ts
test('assembles goal status, topic index and recalled blocks in order', () => {
  const ctx = buildLeadContext({
    goals: [status('g1', 'plan_approval')],
    topics: [topic('t1', 'SQLite 迁移', '决定：使用 SQLite')],
    query: 'sqlite',
    recalled: [{ candidate: { topicId: 't1', title: 'SQLite 迁移', score: 0.9, matches: ['sqlite'] }, topic: recallTopic('t1') }],
  });
  expect(ctx.blocks.map((b) => b.kind)).toEqual(['goal-status', 'topic-index', 'recalled-topic']);
  expect(ctx.recalledTopicIds).toEqual(['t1']);
});

test('drops recalled block before topic index when over budget', () => {
  const ctx = buildLeadContext({ ...base, budget: { recallMaxTokens: 0 } });
  expect(ctx.blocks.some((b) => b.kind === 'recalled-topic')).toBe(false);
  expect(ctx.trimmed).toContain('recalled-topic');
});

test('context route is empty for a non-Lead session', async () => {
  const out = await handleLeadContext({ sessionID: 'ses_worker', query: 'x' }, deps({ isLead: () => false }));
  expect(out.body).toMatchObject({ blocks: [], totalTokens: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-context.test.ts tests/unit/routes/lead-context-route.test.ts --runInBand --forceExit`
Expected: FAIL（module / handler not found）。

- [ ] **Step 3: Implement assembly + route**

`buildLeadContext` 只拼字符串，不发 IO；`lead-topics.ts` 导出 `handleLeadContext(args, deps)` 与 `attachLeadTopicRoutes(registry, gw)`。deps 最小面：`isLeadSession(sessionID)`, `projectDirForSession(sessionID)`, `topics`, `index`, `goals(projectDir)`, `workingSetEnabled()`. `index.ts` 在 `attachWave1Handlers` 之后调用 `attachLeadTopicRoutes`。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Regenerate contract + commit**

```bash
cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts
cd ../packages/gateway-sdk && npm run gen:api
git add gateway/src/core/lead/lead-context.ts gateway/src/routes/lead-topics.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/lead/lead-context.test.ts gateway/tests/unit/routes/lead-context-route.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(lead): assemble working-set context and expose lead context route"
```

---

### Task 7: Topic list / detail / working-set / recall APIs

**Files:**
- Modify: `gateway/src/routes/lead-topics.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Test: `gateway/tests/unit/routes/lead-topics-routes.test.ts`

**Interfaces:**
- Produces handlers:
```ts
GET /api/lead/topics?projectDir=&query=&limit=   → { items: LeadTopicView[] }
GET /api/lead/topics/:id                          → { topic: LeadTopicView; messages: TopicMessageIndexRow[] }
GET /api/lead/working-set?projectDir=             → WorkingSet & { topics: LeadTopicView[] }
GET /api/lead/recall?projectDir=&q=               → { candidates: RecallCandidate[] }
```
- `LeadTopicView { id, title, summary, state, lastActiveAt, goalId, resumedFrom }`（不返回 session id）。

- [ ] **Step 1: Write the failing tests**

```ts
test('topic list filters by query and never leaks session ids', async () => {
  const out = await handleListTopics({ projectDir: '/p', query: 'sqlite' }, depsWithTopics());
  expect(out.body.items.map((t: any) => t.id)).toEqual(['t1']);
  expect(JSON.stringify(out.body)).not.toContain('ses_');
});

test('working-set separates resident/warm/cold and recall is diagnostic only', async () => {
  const ws = await handleWorkingSet({ projectDir: '/p' }, depsWithTopics());
  expect(ws.body).toMatchObject({ warm: expect.arrayContaining(['t1']) });
  const recall = await handleRecall({ projectDir: '/p', q: 'sqlite' }, depsWithTopics());
  expect(recall.body.candidates[0].topicId).toBe('t1');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/routes/lead-topics-routes.test.ts --runInBand --forceExit`
Expected: FAIL（handlers not found）。

- [ ] **Step 3: Implement handlers + catalog**

复用 Task 1 stores、Task 2 `selectWorkingSet`、Task 5 `recallTopics`。`working-set` 的 topics 只投影用户字段；`recall` 不写库、不发事件。所有 handler 走统一 `ok/fail` 形状（与 `lead-goal-status.ts` 一致）。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Regenerate contract + commit**

```bash
cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts
cd ../packages/gateway-sdk && npm run gen:api
git add gateway/src/routes/lead-topics.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/routes/lead-topics-routes.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(lead): expose topic index, working-set and recall APIs"
```

---

### Task 8: 压缩 + `lead.compaction` 事件

**Files:**
- Modify: `gateway/src/routes/lead-topics.ts`
- Modify: `gateway/src/index.ts`（broadcast dep）
- Test: `gateway/tests/unit/routes/lead-compact-route.test.ts`

**Interfaces:**
- Produces `POST /api/lead/compact` body `{ topicId: string }` → `{ topicId, beforeTokens, afterTokens, evictedMessageIds }`；写 `topics.updateSummary` + `topics.setState(topicId, 'warm')`；`broadcast({ type: 'lead.compaction', properties: { topicId, beforeTokens, afterTokens } })`。

- [ ] **Step 1: Write the failing test**

```ts
test('compact rewrites summary, evicts old messages and emits one event', async () => {
  const out = await handleCompact({ topicId: 't1' }, depsWithMessages());
  expect(out.body).toMatchObject({ topicId: 't1', evictedMessageIds: expect.arrayContaining(['m1']) });
  expect(topics.get('t1')?.state).toBe('warm');
  expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'lead.compaction' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/routes/lead-compact-route.test.ts --runInBand --forceExit`
Expected: FAIL（handler not found）。

- [ ] **Step 3: Implement compact handler**

handler 读 topic + messages（`listMessages({ sessionID: topic.leadSessionId, limit: 200 })`），调 `compactTopic`；只更新 summary/state/index，不删除任何原始行。`MAFW_LEAD_WORKING_SET=0` 时返回 503 中性错误。

- [ ] **Step 4: Run test to verify it passes**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/lead-topics.ts gateway/src/index.ts gateway/tests/unit/routes/lead-compact-route.test.ts
git commit -m "feat(lead): compact topics without deleting transcripts"
```

---

### Task 9: 旧 topic resume 服务 + API

**Files:**
- Create: `gateway/src/core/lead/lead-topic-resume-service.ts`
- Modify: `gateway/src/routes/lead-topics.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Test: `gateway/tests/unit/lead/lead-topic-resume-service.test.ts`、`gateway/tests/unit/routes/lead-resume-route.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ResumeResult { sessionID: string; resumedFrom: string | null; }
export class LeadTopicResumeService {
  constructor(deps: {
    topics: LeadTopicStore;
    index: TopicMessageIndexStore;
    sessions: {
      current(projectDir: string): { sessionId: string } | null;
      isAlive(sessionID: string): Promise<boolean>;
      ensure(projectDir: string): Promise<{ sessionId: string }>;
    };
    promptAsync(input: { sessionID: string; parts: Array<{ type: 'text'; text: string }> }): Promise<void>;
    now(): string;
    newId(): string;
  });
  resume(topicId: string): Promise<ResumeResult>;
}
POST /api/lead/topics/:id/resume → ResumeResult
```
- 规则：`ownerSessionId ?? leadSessionId`；alive → 直接返回该 session（`resumedFrom: null`），topic 置 resident，其它 resident → warm。dead → `sessions.ensure(projectDir)` 拿新 session，`promptAsync` 注入 `<resumed-topic>`（summary + 最近 5 条 user 消息），插入新 topic 行 `resumedFrom=old.id`、`state='resident'`，旧行 `warm`；旧 transcript 不改。

- [ ] **Step 1: Write the failing tests**

```ts
test('alive session resumes in place', async () => {
  const result = await service.resume('t1');
  expect(result).toEqual({ sessionID: 'ses_old', resumedFrom: null });
  expect(promptAsync).not.toHaveBeenCalled();
});

test('dead session rebuilds with provenance and leaves the old transcript alone', async () => {
  const result = await service.resume('t1');
  expect(result.sessionID).toBe('ses_new');
  expect(result.resumedFrom).toBe('t1');
  expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({
    sessionID: 'ses_new',
    parts: [expect.objectContaining({ text: expect.stringContaining('<resumed-topic') })],
  }));
  expect(topics.get('t1')?.state).toBe('warm');
  expect(topics.listByProject('/p').some((t) => t.resumedFrom === 't1' && t.state === 'resident')).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-topic-resume-service.test.ts tests/unit/routes/lead-resume-route.test.ts --runInBand --forceExit`
Expected: FAIL（service not found）。

- [ ] **Step 3: Implement resume + route**

resume 串行化：服务内 `Map<topicId, Promise>` 复用 in-flight promise（同 topic 并发只跑一次）。`promptAsync` 失败不回滚 topic 行，返回 `sessionID` 并记录 `log`（fail-open）。route 返回 404（topic 不存在）/ 409（topic archived）。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Regenerate contract + commit**

```bash
cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts
cd ../packages/gateway-sdk && npm run gen:api
git add gateway/src/core/lead/lead-topic-resume-service.ts gateway/src/routes/lead-topics.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/lead/lead-topic-resume-service.test.ts gateway/tests/unit/routes/lead-resume-route.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(lead): resume old topics with provenance"
```

---

### Task 10: 宿主插件每回合注入

**Files:**
- Create: `src/hooks/lead-working-set.ts`
- Modify: `src/plugin.ts:240-273`
- Test: `tests/lead-working-set-hook.test.ts`

**Interfaces:**
- Produces `leadWorkingSetHook(input: { sessionID: string }, output: { messages: any[] }, deps?: { fetchImpl?: typeof fetch; now?(): number }): Promise<void>`。
- 行为：取最后一条 user 消息文本为 query；`fetch('/api/lead/context?sessionID=&query=', { signal: AbortSignal.timeout(100) })`；非 200/空 blocks/超时 → 直接返回；把 `blocks.map(b => b.text).join('\n\n')` push 为最后一条 user 消息的 `synthetic: true` text part；重复调用按 `sessionID + query` 去重（模块内 Map，最多 100 项）。

- [ ] **Step 1: Write the failing test**

```ts
test('injects one synthetic part and skips on timeout', async () => {
  const output = { messages: [{ info: { role: 'user', sessionID: 'ses_lead' }, parts: [{ type: 'text', text: '继续 SQLite 迁移' }] }] };
  await leadWorkingSetHook({ sessionID: 'ses_lead' }, output, { fetchImpl: async () => new Response(JSON.stringify({ blocks: [{ kind: 'recalled-topic', text: '<recalled-topic>…</recalled-topic>', tokens: 10 }] })) });
  expect(output.messages[0].parts.at(-1)).toMatchObject({ synthetic: true });
  expect(output.messages[0].parts.at(-1).text).toContain('<recalled-topic');

  const slow = { messages: [{ info: { role: 'user', sessionID: 'ses_lead' }, parts: [{ type: 'text', text: 'x' }] }] };
  await leadWorkingSetHook({ sessionID: 'ses_lead' }, slow, { fetchImpl: (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))) });
  expect(slow.messages[0].parts).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lead-working-set-hook.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement hook + wire**

`plugin.ts` 在 `sessionRecallHook` 之后、`voiceGuideMessagesHook` 之前调用 `leadWorkingSetHook({ sessionID }, out)`；整个 hook 内部 try/catch。`RECALL_URL`/gateway base 复用 `session-recall.ts` 的解析方式（抽 `gatewayBaseUrl()` 到共享模块，若已有则复用）。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/lead-working-set-hook.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/hooks/lead-working-set.ts src/plugin.ts tests/lead-working-set-hook.test.ts
git commit -m "feat(lead): inject working-set context per Lead turn"
```

---

### Task 11: SDK / preload / 桌面 Topic index

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts`、`packages/gateway-sdk/src/types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`、`mafw-types.ts`
- Create: `packages/desktop/src/renderer/mafw/lead-topics.ts`
- Create: `packages/desktop/src/renderer/mafw/components/TopicIndexPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`、`MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/lead-topics.test.ts`、`packages/desktop/tests/topic-index-wiring.test.ts`

**Interfaces:**
- SDK `lead` namespace:
```ts
topics: { list(input: { projectDir?: string; query?: string; limit?: number }): Promise<{ items: LeadTopicView[] }>;
          get(id: string): Promise<{ topic: LeadTopicView; messages: TopicIndexMessage[] }>;
          resume(id: string): Promise<{ sessionID: string; resumedFrom: string | null }> }
workingSet(input: { projectDir?: string }): Promise<LeadWorkingSet>
compact(input: { topicId: string }): Promise<LeadCompactResult>
recall(input: { projectDir?: string; q: string }): Promise<{ candidates: LeadRecallCandidate[] }>
```
- Desktop `ChatPane` header adds `ButtonV2 variant="ghost" size="small"` “话题”，**只在 `isLead()`** 时渲染；`TopicIndexPanel` 用 `For` 列表 + `ButtonV2` 行；点击 resume 后 `props.onOpenSession(sessionID)`。
- `TopicIndexPanel` 不显示 session id；空态「还没有可恢复的话题」。

- [ ] **Step 1: Write the failing tests**

```ts
test('Lead topic list model hides session ids and labels states', () => {
  const model = buildTopicList([{ id: 't1', title: 'SQLite', summary: '决定：A', state: 'warm', lastActiveAt: '2026-11-10T00:00:00.000Z', goalId: 'g1', resumedFrom: null }]);
  expect(model[0]).toMatchObject({ id: 't1', stateLabel: '近期' });
  expect(JSON.stringify(model)).not.toContain('ses_');
});
```

```ts
test('topic index is Lead-only and resumes through the shell', () => {
  assert.match(chat, /isLead\(\)/)
  assert.match(chat, /TopicIndexPanel/)
  assert.match(shell, /lead\.topics\.resume|topicIndexResume/)
  assert.doesNotMatch(panel, /ses_[a-zA-Z0-9]+/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-topics.test.ts ../tests/topic-index-wiring.test.ts`（在 `packages/desktop` 下）
Expected: FAIL（module/panel not found）。

- [ ] **Step 3: Implement SDK/preload/panel/wiring**

SDK 方法走 `this.request` 对应路径；preload 透传；`lead-topics.ts` 提供 `buildTopicList` 与 `leadTopicStateLabel`（resident/warm/cold/archived → 当前/近期/更早/已归档）。`MafwShell` 维护 `showTopics` signal + `resumeTopic(id)`（调 SDK → `openSessionTab(sessionID)` → 关闭面板），并把 `onOpenTopics` 传给 `ChatPane`；`ChatPane` 顶部只加按钮，`TopicIndexPanel` 由 shell 渲染在 composer 上方（与 Lead 状态卡同区域，二者互斥显示）。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/types.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/renderer/mafw/lead-topics.ts packages/desktop/src/renderer/mafw/components/TopicIndexPanel.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/lead-topics.test.ts packages/desktop/tests/topic-index-wiring.test.ts
git commit -m "feat(desktop): add Lead topic index and resume"
```

---

### Task 12: 集成、开关、文档与全量门禁

**Files:**
- Create: `gateway/tests/integration/lead-working-set.test.ts`
- Modify: `docs/architecture/pod.md`（现状段）
- Modify: `docs/reference/tools.md`（如新增诊断工具则登记；否则不改）
- Test: 全量

**Interfaces:**
- 场景 1：两个 handoff topic（t1 SQLite / t2 UI）→ `selectWorkingSet` warm 两条；query `SQLite` 召回 t1；低置信 query 不召回。
- 场景 2：compact t1 → summary 保留「决定/待办」；`topic_message_index` 原始行仍在；broadcast 一次。
- 场景 3：resume t2（session dead）→ 新 topic `resumedFrom=t2`；旧 t2 `warm`；新 session prompt 含 `<resumed-topic>`。

- [ ] **Step 1: Write the failing integration test**

```ts
test('multi-topic working set: recall, compact, resume', async () => {
  // seed two topics + index; query sqlite -> t1 only
  expect(recallTopics({ query: 'sqlite', topics: seeded }).map((c) => c.topicId)).toEqual(['t1']);
  expect(recallTopics({ query: '随便聊聊', topics: seeded })).toEqual([]);
  const compacted = compactTopic({ topicId: 't1', messages: t1Messages });
  expect(compacted.summary).toContain('决定：使用 SQLite');
  const resumed = await resumeService.resume('t2');
  expect(resumed.resumedFrom).toBe('t2');
  expect(topics.get('t2')?.state).toBe('warm');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix gateway -- tests/integration/lead-working-set.test.ts --runInBand --forceExit`
Expected: FAIL（services not wired / missing behavior）。

- [ ] **Step 3: Wire + document + kill switch**

`index.ts` 构造：`LeadTopicStore` + `TopicMessageIndexStore` + `LeadTopicSummaryService` + `LeadTopicResumeService`；`MAFW_LEAD_WORKING_SET=0` 时 context route 返回空、hook 不注入、compact 503。`docs/architecture/pod.md` 追加「P1 工作集与缺页」现状段（store、context 块顺序、100ms、开关、resume provenance）。

- [ ] **Step 4: Run full gates**

```bash
npm test --prefix gateway -- --runInBand --forceExit
npm test --prefix packages/desktop
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
cd ../../gateway && npx tsc --noEmit -p tsconfig.json
```
Expected: gateway 全绿；desktop 全绿；tsc/tsgo/build rc=0。

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration/lead-working-set.test.ts docs/architecture/pod.md
git commit -m "test(lead): cover working-set recall, compaction and resume"
```

---

## Self-Review

- **Spec coverage**：4.1 工作集（Task 2）、4.2 数据模型（Task 1）、4.3 上下文组装（Task 6）、4.4 缺页（Task 5/10）、4.5 压缩（Task 3/8）、4.6 resume（Task 9）、4.7 UI（Task 11）、API（Task 6/7/8/9）、事件（Task 8/9）、失败模式（Review Focus + 各任务 fail-open）、迁移/开关（Task 12）、评测（Task 12 集成；LongMemEval 子集留作后续独立评测任务）。
- **类型一致性**：`LeadTopicRow.state` / `WorkingSetBudget` / `RecallCandidate` / `LeadContextBlock` 在后续任务中名称一致；`resumedFrom` 统一 camelCase。
- **未决**：embedding 阈值 P1 不引入（用 token 命中），避免每次 LLM rerank；LongMemEval 评测单独排期，不阻塞 P1 实现。
