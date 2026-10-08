# Phase 3: HostAdapter 认知面契约形式化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把认知面（observe / injectContext / injectSystem / tools）从"两个实现各自为政"形式化为显式契约：提取共享核心 `host-adapter.ts`（契约常量 + CognitionClient + 工具 HTTP 核心），pi 扩展降为薄事件映射层，并新增 **runtime 无关的认知一致性场景（S3/S4）**——任何未来宿主适配器（v2 插件）跑一次 conformance 即可自证四动词实现正确。

**Architecture:** 编排面契约（RuntimeClient）覆盖"gateway→runtime"；HostAdapter 覆盖"runtime 宿主→gateway 认知面"，**协议 = loopback HTTP 到固定端点**（与宿主语言/进程无关）。共享核心只落在 gateway 内（pi 扩展消费）；v1 插件**不重构**（原生实现同语义，生产宿主不动，v2 迁移时以本核心为核重写——build-to-delete 决策）。S3/S4 复用 conformance 基建（deps 注入 + 纯函数评估器 + 路由驱动）。

**Tech Stack:** TypeScript (gateway CJS)、jest、既有 conformance 基建（`conformance-scenarios.ts` + `routes/conformance.ts`）。

## Global Constraints

- TDD：每任务先写失败测试再实现；Task 2 重构的验收 = **现有 19 个 pi 扩展测试零修改全绿**（行为等价证明）。
- `git add` 路径 repo 根相对；中文内容只经 write/edit 工具。
- jest 不 typecheck index.ts —— 改 index.ts 后必须 `cd gateway && npm run build`。
- 基线：234 suites / 1533 tests（v4.18.0）。
- 发版流程同前（build → jest → pack → mafw stop → install -g → daemon → health）。

## 背景事实（执行者必读）

1. **conformance 基建**：`runtime/conformance-scenarios.ts`（ScenarioDef id 联合类型 + SCENARIOS 数组 + `evaluateScenario(id, events, apiResult?)` 纯函数）；`routes/conformance.ts`（ConformanceDeps：runtimeName/caps/createSession/promptAsync/deleteSession/listSessions/registerEventTap + collectUntilTerminal 驱动）；测试 `tests/unit/runtime/conformance-scenarios.test.ts` + `tests/unit/routes/conformance.test.ts`。index.ts ~1358 行组装 deps。
2. **gateway-db**：t1_observations 已有按 session+turn 查询（gateway-db.ts:332），**缺**按 session 全量查询——需补 `getObservationsBySession`。
3. **pi 扩展现状**（Phase 2 刚交付，`runtime/pi/pi-mafw-host-extension.ts`）：要提取的内容全在此文件——MEMORY_GUIDE、contentToText、hashText、MEDIA_EXT_MIME、MAX_BYTES、buildRecallQuery、mediaDataFromSource、a2aRequest、taskAnswer、makeMediaPointer、postToolJson、postJson/getJson/postObs、buildIncrement/appendRecall（游标）、registerMafwTools（工具 glue）。
4. **S4 注入验证手法**（v2 spike 已验证有效）：让模型复述 `<memory-guide>` 首行（`## 记忆`）——端到端证明 system 注入到达模型；recall 触达用 gateway 侧 per-session 时间戳记录。
5. **两个宿主的注入可见性差异**：v1 插件的 recall 注入持久进 opencode 会话存储（transform 原地改 parts）；pi 的 context 注入只影响 LLM 调用（深拷贝）不落存储——所以 S4 验证必须走"模型复述"而非检查消息内容。

---

### Task 1: host-adapter.ts——契约 + CognitionClient + 工具核心

**Files:**
- Create: `gateway/src/runtime/host-adapter.ts`
- Test: `gateway/tests/unit/runtime/host-adapter.test.ts`

**Interfaces:**
- Produces（全部从 pi-mafw-host-extension.ts 迁移或提炼，签名不变）: `COGNITION_CONTRACT`（常量对象）、`MEMORY_GUIDE`、`contentToText`、`hashText`、`MEDIA_EXT_MIME`、`buildRecallQuery`、`mediaDataFromSource`、`a2aRequest`、`taskAnswer`、`makeMediaPointer`、`postToolJson`、`createCognitionClient({sessionId, baseUrl, fetchImpl})` → `{ observe, fetchRecallPointers, fetchPinnedProfile, postJson, getJson }`、`createRecallCursor()` → `{ next(real), advance(real) }`

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime/host-adapter.test.ts
import {
  COGNITION_CONTRACT, MEMORY_GUIDE, contentToText, hashText, buildRecallQuery,
  createCognitionClient, createRecallCursor,
} from '../../../src/runtime/host-adapter';

describe('host-adapter contract', () => {
  it('时序契约常量与认知面文档一致', () => {
    expect(COGNITION_CONTRACT.recallTimeoutMs).toBe(100);
    expect(COGNITION_CONTRACT.pinnedTimeoutMs).toBe(150);
    expect(COGNITION_CONTRACT.shortIncrementMin).toBe(50);
    expect(COGNITION_CONTRACT.assistantTailMax).toBe(300);
    expect(MEMORY_GUIDE).toContain('<memory-guide>');
    expect(MEMORY_GUIDE).toContain('## 记忆');
  });

  it('contentToText 跳过 synthetic 部件', () => {
    expect(contentToText('plain')).toBe('plain');
    expect(contentToText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b', synthetic: true }])).toBe('a');
  });

  it('hashText 输出 8 位 hex', () => {
    expect(hashText('x')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('buildRecallQuery：长增量直用 / 短增量并入 assistant 尾部', () => {
    const real = [
      { id: 'a', role: 'user', content: 'q' + 'x'.repeat(60) },
      { id: 'b', role: 'assistant', content: [{ type: 'text', text: '答案尾部' + 'y'.repeat(60) }] },
    ];
    expect(buildRecallQuery(real, [real[0]])).toContain('xxx');
    expect(buildRecallQuery(real, [{ id: 'c', role: 'user', content: '好的' }])).toContain('答案尾部');
  });
});

describe('createCognitionClient', () => {
  it('observe → POST /api/obs/capture；空内容跳过', async () => {
    const calls: any[] = [];
    const fetchImpl: any = async (url: string, init?: any) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    };
    const c = createCognitionClient({ sessionId: 's1', baseUrl: 'http://gw', fetchImpl });
    c.observe('user_input', 'hello');
    c.observe('user_input', '   ');
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ sessionID: 's1', source: 'user_input', content: 'hello' });
  });

  it('fetchRecallPointers / fetchPinnedProfile fail-open 返回 null', async () => {
    const fetchImpl: any = async () => { throw new Error('down'); };
    const c = createCognitionClient({ sessionId: 's1', baseUrl: 'http://gw', fetchImpl });
    expect(await c.fetchRecallPointers('q')).toBeNull();
    expect(await c.fetchPinnedProfile()).toBeNull();
  });

  it('fetchRecallPointers 命中返回 pointers', async () => {
    const fetchImpl: any = async () => ({ ok: true, json: async () => ({ pointers: '<recall>x</recall>' }) });
    const c = createCognitionClient({ sessionId: 's1', baseUrl: 'http://gw', fetchImpl });
    expect(await c.fetchRecallPointers('q')).toBe('<recall>x</recall>');
  });
});

describe('createRecallCursor', () => {
  it('id 游标：next 只返回新增；compaction 丢游标回尾部 8 条', () => {
    const cur = createRecallCursor();
    const m1 = [{ id: 'a', role: 'user', content: 'one' }];
    expect(cur.next(m1)).toHaveLength(1);
    cur.advance(m1);
    const m2 = [...m1, { id: 'b', role: 'user', content: 'two' }];
    expect(cur.next(m2).map((m: any) => m.id)).toEqual(['b']);
    cur.advance(m2);
    // 游标 id 消失（历史被截）→ 回尾部 8
    const fresh = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, role: 'user', content: `m${i}` }));
    expect(cur.next(fresh)).toHaveLength(8);
  });

  it('count 退化：无 id 消息按计数增量', () => {
    const cur = createRecallCursor();
    const a = [{ role: 'user', content: 'alpha' }];
    cur.advance(a);
    const b = [...a, { role: 'user', content: 'beta' }];
    expect(cur.next(b).map((m: any) => contentToText(m.content))).toEqual(['beta']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**（模块不存在）

- [ ] **Step 3: 实现 host-adapter.ts**

结构（内容从 pi-mafw-host-extension.ts **迁移**，实现体不变；该文件本任务不动——Task 2 才切换 import）：

```typescript
// gateway/src/runtime/host-adapter.ts
/**
 * HostAdapter —— 认知面契约（Phase 3 形式化，2026-10-08）。
 *
 * 编排面契约见 contract.ts（RuntimeClient：gateway→runtime 的 session/prompt/
 * event/approval）。本文件定义**认知面**：宿主适配器（跑在 runtime 进程/会话内）
 * 对 gateway 的四动词，协议 = loopback HTTP（宿主语言/进程无关）：
 *
 *   observe       事件 → POST /api/obs/capture {sessionID, source, content, failure}
 *                 source ∈ user_input | assistant_reply | tool_result | reasoning
 *   injectContext 每次 LLM 调用前 → GET /api/recall/context?sessionID=&query=
 *                 （100ms fail-open；游标增量 + 短增量并入 assistant 尾部；
 *                  注入物 = synthetic 部件标记，不回流查询）
 *   injectSystem  每回合 → GET /api/recall/pinned（150ms fail-open）+
 *                 静态 MEMORY_GUIDE，追加到 system 尾部
 *   tools         六件套（add_memory / python ×2 / media ×3）经
 *                 /api/memory/add、/api/python/*、/api/tts、/a2a
 *
 * 时序契约（COGNITION_CONTRACT）与一致性验证（S3/S4 场景，
 * POST /api/runtime/conformance）对全部宿主一致。
 *
 * 三实现：v1 opencode 插件（root src/plugin.ts，原生实现同语义、不经本文件
 * ——生产宿主不重构，v2 迁移时以本核心为核）；pi extension
 * （runtime/pi/pi-mafw-host-extension.ts，消费本文件）；opencode v2 插件（待迁移）。
 */

export const COGNITION_CONTRACT = {
  obsTimeoutMs: 5_000,
  recallTimeoutMs: 100,
  pinnedTimeoutMs: 150,
  shortIncrementMin: 50,
  assistantTailMax: 300,
} as const;

// ---- 以下实现体自 runtime/pi/pi-mafw-host-extension.ts 迁移（Task 2 切换 import）----
// MEMORY_GUIDE（全文原样迁移）
// contentToText / hashText / MEDIA_EXT_MIME / MAX_BYTES
// buildRecallQuery（签名改为 (real, increment)，内部用 COGNITION_CONTRACT 常量）
// createCognitionClient({sessionId, baseUrl, fetchImpl?}):
//   { observe(source, content, failure?), fetchRecallPointers(query), fetchPinnedProfile(), postJson(path, body, timeoutMs, signal?), getJson(path, timeoutMs) }
// createRecallCursor(): { next(real), advance(real) } —— lastRealId/lastRealCount 闭包态
// mediaDataFromSource / a2aRequest / taskAnswer / makeMediaPointer / postToolJson（原样迁移）
```

（执行时把 pi-mafw-host-extension.ts 中这些函数体**逐字**搬到本文件并按上述签名微调：`buildIncrement`+游标状态合并为 `createRecallCursor`；`postObs`/`fetchRecallPointers`/`fetchPinnedProfile` 收进 `createCognitionClient`。）

- [ ] **Step 4: 跑测试确认通过**（新增 ~9 测试）
- [ ] **Step 5: Commit**

```powershell
git add gateway/src/runtime/host-adapter.ts gateway/tests/unit/runtime/host-adapter.test.ts
git commit -m "feat(runtime): host-adapter cognition contract + shared client core (extracted from pi extension)"
```

---

### Task 2: pi 扩展重构为薄映射层（行为等价，现有 19 测试零修改全绿）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-mafw-host-extension.ts`
- Test: `gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts`（**只改 import 路径**：`buildRecallQuery`/`hashText` 等从 host-adapter 导入——若测试断言的行为未变，断言体不动）

- [ ] **Step 1: 重构 extension**

删除已迁移的实现体，改为：

```typescript
import { randomUUID } from 'crypto';
import {
  MEMORY_GUIDE, contentToText, hashText, buildRecallQuery, createCognitionClient, createRecallCursor,
  mediaDataFromSource, a2aRequest, taskAnswer, makeMediaPointer, postToolJson, COGNITION_CONTRACT,
} from '../host-adapter';
import type { MafwHostDeps } from '…（接口留在本文件或迁 host-adapter——留在本文件，pi 特有）';
```

`createMafwHostExtension` 内部改为：

```typescript
  const client = createCognitionClient({ sessionId: deps.sessionId, baseUrl: deps.baseUrl, fetchImpl: deps.fetchImpl });
  const cursor = createRecallCursor();
```

事件映射层保留（message_end / tool_result / context / before_agent_start / registerMafwTools），其中：
- `postObs(...)` → `client.observe(...)`
- `getJson('/api/recall/context...')` + 手写游标 → `client.fetchRecallPointers(query)` + `cursor.next(real)` / `cursor.advance(real)`
- `getJson('/api/recall/pinned')` → `client.fetchPinnedProfile()`
- `appendRecall` 保留在本文件（pi 消息形状特有：string→array 转换）
- 工具 execute 内的 `postToolJson`/`a2aRequest`/`mediaDataFromSource`/`taskAnswer`/`makeMediaPointer`/`hashText` 全部改为 import

- [ ] **Step 2: 跑全部相关测试**

```powershell
cd gateway; npx jest tests/unit/runtime/pi-mafw-host-extension.test.ts tests/unit/runtime/host-adapter.test.ts
```
Expected: 19 + ~9 全 PASS（19 个若因 import 路径编译失败，仅改 import 行——断言零修改）。

- [ ] **Step 3: Commit**

```powershell
git add gateway/src/runtime/pi/pi-mafw-host-extension.ts gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts
git commit -m "refactor(pi): host extension becomes thin event mapping over host-adapter core"
```

---

### Task 3: S3/S4 认知一致性场景

**Files:**
- Modify: `gateway/src/runtime/conformance-scenarios.ts`
- Modify: `gateway/src/routes/conformance.ts`
- Modify: `gateway/src/memory/gateway-db.ts`（补 `getObservationsBySession`）
- Modify: `gateway/src/index.ts`（recall 触达记录 + deps 扩展）
- Test: `gateway/tests/unit/runtime/conformance-scenarios.test.ts`、`gateway/tests/unit/routes/conformance.test.ts`（追加）

- [ ] **Step 1: 写失败测试（评估器）**

conformance-scenarios.test.ts 追加：

```typescript
import { evaluateScenario } from '../../../src/runtime/conformance-scenarios';

describe('cognition scenarios (evaluator)', () => {
  it('cognition-observe：user_input + tool_result + assistant_reply 齐全 → pass', () => {
    const r = evaluateScenario('cognition-observe', [], undefined, {
      sources: ['user_input', 'tool_result', 'assistant_reply'],
    });
    expect(r.pass).toBe(true);
  });

  it('cognition-observe：缺 tool_result → fail 并点名', () => {
    const r = evaluateScenario('cognition-observe', [], undefined, {
      sources: ['user_input', 'assistant_reply'],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('tool_result');
  });

  it('cognition-inject：guide 回声 + recall 触达 → pass', () => {
    const r = evaluateScenario('cognition-inject', [], undefined, {
      sources: ['user_input', 'assistant_reply'],
      recallCalledAt: 123,
      guideEcho: '## 记忆',
    });
    expect(r.pass).toBe(true);
  });

  it('cognition-inject：无 recall 触达 → fail', () => {
    const r = evaluateScenario('cognition-inject', [], undefined, {
      sources: ['user_input', 'assistant_reply'],
      recallCalledAt: null,
      guideEcho: '## 记忆',
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('recall');
  });

  it('cognition-inject：guide 未到达模型（回声无关键词）→ fail', () => {
    const r = evaluateScenario('cognition-inject', [], undefined, {
      sources: ['user_input', 'assistant_reply'],
      recallCalledAt: 123,
      guideEcho: 'I have no such block',
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toContain('memory-guide');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现评估器**

conformance-scenarios.ts：

```typescript
export interface ScenarioDef {
  id: 'chat-roundtrip' | 'session-lifecycle' | 'cognition-observe' | 'cognition-inject';
  // …其余不变
}
```

SCENARIOS 追加：

```typescript
  {
    id: 'cognition-observe',
    title: '认知面·观察捕获（T1）',
    description: '真实回合后 T1 应有 user_input / tool_result / assistant_reply 三类观察行（宿主 observe 动词）',
    prompt: 'Use a shell command tool to list the files in the current directory, then reply with the single word DONE.',
    timeoutMs: 120_000,
    requires: { eventStream: true },
  },
  {
    id: 'cognition-inject',
    title: '认知面·注入到达（recall + memory-guide）',
    description: '边界 recall 应触达 gateway（injectContext），模型能复述 <memory-guide> 首行（injectSystem 端到端到达）',
    prompt: 'Reply with the exact first heading line that appears inside the <memory-guide> block in your system instructions. Nothing else.',
    timeoutMs: 90_000,
    requires: { eventStream: true },
  },
```

`evaluateScenario` 追加第 4 可选参 `cognition?: { sources: string[]; recallCalledAt?: number | null; guideEcho?: string }`：

```typescript
  } else if (id === 'cognition-observe') {
    const sources = new Set(cognition?.sources ?? []);
    for (const need of ['user_input', 'tool_result', 'assistant_reply']) {
      if (!sources.has(need)) failures.push(`missing T1 observation source '${need}' — host observe verb not wired for this event class`);
    }
  } else if (id === 'cognition-inject') {
    if (!cognition?.recallCalledAt) failures.push('no /api/recall/context call recorded for this session — host injectContext verb not wired');
    if (!/记忆|memory-guide/i.test(cognition?.guideEcho ?? '')) failures.push('assistant reply does not echo the <memory-guide> heading — injectSystem did not reach the model');
  }
```

- [ ] **Step 4: gateway-db 补查询**

```typescript
  /** conformance S3/S4：按会话取观察行（时间正序）。 */
  getObservationsBySession(sessionID: string, limit = 100): Array<{ source: string; content: string }> {
    const rows = this.db
      .prepare('SELECT source, content FROM t1_observations WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionID, limit) as Array<{ source: string; content: string }>;
    return rows.reverse();
  }
```

- [ ] **Step 5: 路由驱动 + deps 扩展**

routes/conformance.ts——ConformanceDeps 追加：

```typescript
  getObservations(sessionID: string): Promise<Array<{ source: string; content: string }>>;
  getRecallCalledAt(sessionID: string): number | null;
```

handleConformance 场景分支追加（chat-roundtrip 分支之后）：

```typescript
      } else if (sc.id === 'cognition-observe' || sc.id === 'cognition-inject') {
        const sess = await deps.createSession({});
        const p = collectUntilTerminal(deps.registerEventTap, sess.id, perTimeout ?? sc.timeoutMs);
        await deps.promptAsync({ sessionID: sess.id, message: sc.prompt });
        await p;
        const obs = await deps.getObservations(sess.id);
        const cognition = {
          sources: obs.map((o) => o.source),
          recallCalledAt: deps.getRecallCalledAt(sess.id),
          guideEcho: obs.filter((o) => o.source === 'assistant_reply').map((o) => o.content).join('\n'),
        };
        const r = evaluateScenario(sc.id, [], undefined, cognition);
        await deps.deleteSession(sess.id).catch(() => {});
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      }
```

- [ ] **Step 6: index.ts 接线**

① recall 路由（/api/recall/context 分支开头，拿到 sessionID 后）：

```typescript
            if (sessionID) {
              this.recallCalledBySession.set(sessionID, Date.now());
              if (this.recallCalledBySession.size > 500) this.recallCalledBySession.clear(); // 有界
            }
```

类字段（approvalPolicy 声明附近）：`private recallCalledBySession = new Map<string, number>();`

② handleConformance deps 组装处（~1358）追加：

```typescript
        getObservations: (sessionID: string) => Promise.resolve(this.getGatewayDb().getObservationsBySession(sessionID)),
        getRecallCalledAt: (sessionID: string) => this.recallCalledBySession.get(sessionID) ?? null,
```

- [ ] **Step 7: 路由测试追加 + 全量**

conformance.test.ts 追加：fake deps 带 getObservations/getRecallCalledAt，POST body `{scenarios: ['cognition-observe']}` → 驱动后评估调用（返回 pass/fail 结构）；坏的 deps（getObservations 抛错）→ 场景标 crash 不崩路由。

```powershell
cd gateway; npx jest tests/unit/runtime/conformance-scenarios.test.ts tests/unit/routes/conformance.test.ts; npm run build
```

- [ ] **Step 8: Commit**

```powershell
git add gateway/src/runtime/conformance-scenarios.ts gateway/src/routes/conformance.ts gateway/src/memory/gateway-db.ts gateway/src/index.ts gateway/tests/unit/runtime/conformance-scenarios.test.ts gateway/tests/unit/routes/conformance.test.ts
git commit -m "feat(conformance): S3/S4 cognition scenarios - T1 observation + injection-reach verification (host-agnostic)"
```

---

### Task 4: AGENTS.md HostAdapter 契约段 + 发版 4.19.0

- [ ] **Step 1: AGENTS.md**（§5.19 Runtime 能力契约小节末尾追加）

```markdown
#### HostAdapter 认知面契约（2026-10-08，Phase 3 形式化）

编排面（RuntimeClient）管 gateway→runtime；**认知面（HostAdapter）管宿主适配器→gateway**，协议 = loopback HTTP（宿主语言/进程无关），实现核心在 `gateway/src/runtime/host-adapter.ts`（`COGNITION_CONTRACT` 时序常量 + `createCognitionClient` + `createRecallCursor` + 工具 HTTP 核心）。四动词：

| 动词 | 协议 | 时序/语义 |
|---|---|---|
| observe | POST /api/obs/capture | 5s fail-open；source ∈ user_input/assistant_reply/tool_result/reasoning |
| injectContext | GET /api/recall/context | **100ms fail-open**；游标增量（id 优先/count 回退）+ 短增量（<50 字符）并入 assistant 尾部 300；注入物带 `synthetic:true` 部件标记防回流 |
| injectSystem | GET /api/recall/pinned + 静态 MEMORY_GUIDE | 150ms fail-open；追加 system 尾部 |
| tools | /api/memory/add、/api/python/*、/api/tts、/a2a | 六件套；add_memory 走 HTTP 因 serve worker 无 MCP |

宿主实现：pi = `runtime/pi/pi-mafw-host-extension.ts`（薄事件映射，消费 host-adapter 核心）；v1 opencode 插件 = 原生实现同语义（**刻意不重构**——生产宿主，v2 迁移时统一）；v2 = 待迁移（以 host-adapter 为核）。**一致性验证**：`POST /api/runtime/conformance {scenarios:["cognition-observe","cognition-inject"]}` —— S3 验证 T1 三类观察行、S4 验证 recall 触达 + memory-guide 端到端到达模型（复述法，宿主无关）。
```

- [ ] **Step 2: 版本 + 发版**（`node scripts/bump-version.mjs 4.19.0` → build → 全量 jest → pack → mafw stop → install -g → daemon → health → `/api/runtime` pi ok）

- [ ] **Step 3: Commit + 交付报告**（commit 列表、测试数、S3/S4 说明——线上 conformance 全场景跑一次留作 v2 迁移前基线，本计划不强制跑（耗 LLM 往返），deferred 到下次切 runtime 或 v2 迁移时）

---

## Self-Review

- 覆盖：契约核心提取 ✓ / pi 薄化（行为等价由 19 存量测试证明）✓ / S3/S4 场景 ✓ / 文档发版 ✓；**不做**：v1 插件重构（决策已注明）、v2 适配器（待迁移立项）
- 无占位符：Task 1 的"迁移"步骤均指向存在的源文件与精确签名；S3/S4 代码完整
- 风险：模型不复述 guide 首行（S4 假阴性）——评估器用宽松匹配 `/记忆|memory-guide/i` 且 prompt 措辞精确；conformance 仅按需运行不进 CI（耗 LLM）
