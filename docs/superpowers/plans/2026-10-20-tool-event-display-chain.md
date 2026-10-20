# 工具事件显示链补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/tools/execute` 执行自动合成两帧 tool part 事件（running → completed/error）经 `handleOpencodeEvent` 全管线广播；in-process 第三方 runtime 可 opt-in 包装（`wrapRegistrationsWithEvents`）；conformance 新增 `tool-visibility` 场景。

**Architecture:** 合成事件构造/执行核单源在 `mafw-tools.ts`（route 与 wrapper 共用 `executeWithToolFrames`）；注入点 = `handleOpencodeEvent`（与 runtime 事件同权：normalize→facets→enrichToolClass→trajectory→广播，enrich 在 tap 之前实证 index.ts:1127<1128）；conformance 经同一注入点喂探针帧对，tap 快照扩展携带 `part`。

**Tech Stack:** TypeScript (gateway CJS), jest。

**Spec:** `docs/superpowers/specs/2026-10-20-tool-event-display-chain-design.md`（D1-D8 决策）

## Global Constraints

- 每任务一个 commit 直接进 main；gateway jest 相关文件绿 + 最终全量绿 + root build exit 0
- 两帧终态制：`running`（含 input）→ `completed`（output）/ `error`（error）——execute `{text,isError:true}` → error 态（D5）；无 pending 帧
- 404/400 不发帧（D7）；emission try/catch fail-open（D6）；两帧同 part.id（D3，desktop upsert 合卡）
- desktop/TUI 零改动；pi/opencode 不包装（已自发）

---

### Task 1: mafw-tools 合成事件核心

**Files:**
- Modify: `gateway/src/runtime/mafw-tools.ts`
- Test: `gateway/tests/unit/runtime/mafw-tools.test.ts`

**Interfaces:**
- Consumes: `MafwToolRegistration`（contract.ts）；`randomUUID`（已 import）
- Produces: `ToolPartEventFrame`；`buildToolPartEvent(args)`；`executeWithToolFrames(reg, params, sessionId, emit, signal?)`；`wrapRegistrationsWithEvents(regs, sessionId, emit)`

- [ ] **Step 1: Write the failing tests**

`mafw-tools.test.ts` 追加：

```typescript
import { buildToolPartEvent, executeWithToolFrames, wrapRegistrationsWithEvents } from '../../../src/runtime/mafw-tools';

describe('显示链：合成 tool part 事件（spec 2026-10-20）', () => {
  it('buildToolPartEvent 形状：扁平 part.updated + tool part + state 按序携带 output/error', () => {
    const r = buildToolPartEvent({ sessionID: 's1', partId: 'toolpart_x', tool: 'mafw_python', status: 'running', input: { code: '1' } });
    expect(r).toEqual({
      type: 'part.updated',
      properties: { sessionID: 's1', part: { id: 'toolpart_x', type: 'tool', tool: 'mafw_python', state: { status: 'running', input: { code: '1' } } } },
    });
    const c = buildToolPartEvent({ sessionID: 's1', partId: 'toolpart_x', tool: 't', status: 'completed', input: {}, output: 'ok' });
    expect(c.properties.part.state).toEqual({ status: 'completed', input: {}, output: 'ok' });
    const e = buildToolPartEvent({ sessionID: 's1', partId: 'toolpart_x', tool: 't', status: 'error', input: {}, error: 'boom' });
    expect(e.properties.part.state).toEqual({ status: 'error', input: {}, error: 'boom' });
  });

  function makeReg(over: any = {}): any {
    return { name: 'mafw_probe', description: 'd', parameters: { type: 'object', properties: {} }, execute: jest.fn(async () => ({ text: 'done' })), ...over };
  }

  it('executeWithToolFrames：running→completed 两帧同 part.id；isError → error 帧（D5）', async () => {
    const frames: any[] = [];
    const reg = makeReg();
    const out = await executeWithToolFrames(reg, { x: 1 }, 's1', (f) => frames.push(f));
    expect(out).toEqual({ text: 'done' });
    expect(frames.map((f) => f.properties.part.state.status)).toEqual(['running', 'completed']);
    expect(frames[0].properties.part.id).toBe(frames[1].properties.part.id);
    expect(frames[0].properties.part.id).toMatch(/^toolpart_/);
    expect(frames[1].properties.part.state.output).toBe('done');

    const frames2: any[] = [];
    const reg2 = makeReg({ execute: jest.fn(async () => ({ text: 'bad', isError: true })) });
    await executeWithToolFrames(reg2, {}, 's1', (f) => frames2.push(f));
    expect(frames2[1].properties.part.state.status).toBe('error');
    expect(frames2[1].properties.part.state.error).toBe('bad');
  });

  it('execute 抛错 → error 帧 + 重抛；emit 抛错不阻断（D6）；signal 透传', async () => {
    const frames: any[] = [];
    const boom = new Error('kaboom');
    const reg = makeReg({ execute: jest.fn(async () => { throw boom; }) });
    await expect(executeWithToolFrames(reg, {}, 's1', (f) => { frames.push(f); if (frames.length === 1) throw new Error('emit broken'); }, 'sig' as any)).rejects.toThrow('kaboom');
    expect(frames.map((f) => f.properties.part.state.status)).toEqual(['running', 'error']);
    expect(frames[1].properties.part.state.error).toBe('kaboom');
    expect(reg.execute).toHaveBeenCalledWith({}, 'sig');
  });

  it('wrapRegistrationsWithEvents：包装后 execute 自发两帧，原结果保留', async () => {
    const frames: any[] = [];
    const wrapped = wrapRegistrationsWithEvents([makeReg()], 's9', (f) => frames.push(f));
    expect(wrapped).toHaveLength(1);
    const out = await wrapped[0].execute({ a: 1 });
    expect(out).toEqual({ text: 'done' });
    expect(frames.map((f) => f.properties.part.state.status)).toEqual(['running', 'completed']);
    expect(frames[0].properties.sessionID).toBe('s9');
    expect(frames[0].properties.part.tool).toBe('mafw_probe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/runtime/mafw-tools.test.ts`
Expected: FAIL——三个导出不存在

- [ ] **Step 3: Implement**

`gateway/src/runtime/mafw-tools.ts` 末尾追加：

```typescript
// ─── 显示链：合成 tool part 事件（spec 2026-10-20；调研 2026-10-20 §4） ────────

export interface ToolPartEventFrame {
  type: 'part.updated';
  properties: {
    sessionID: string;
    part: {
      id: string;
      type: 'tool';
      tool: string;
      state: { status: 'running' | 'completed' | 'error'; input: any; output?: string; error?: string };
    };
  };
}

export function buildToolPartEvent(args: {
  sessionID: string; partId: string; tool: string;
  status: 'running' | 'completed' | 'error'; input: any; output?: string; error?: string;
}): ToolPartEventFrame {
  const state: ToolPartEventFrame['properties']['part']['state'] = { status: args.status, input: args.input };
  if (args.output !== undefined) state.output = args.output;
  if (args.error !== undefined) state.error = args.error;
  return {
    type: 'part.updated',
    properties: {
      sessionID: args.sessionID,
      part: { id: args.partId, type: 'tool', tool: args.tool, state },
    },
  };
}

/**
 * 单源执行核（D8）：emit running → execute → emit 终态（isError → error 态，D5）。
 * emission fail-open（D6）——渲染增强不得破坏工具执行；execute 抛错发 error 帧后重抛。
 */
export async function executeWithToolFrames(
  reg: MafwToolRegistration,
  params: any,
  sessionId: string,
  emit: (evt: ToolPartEventFrame) => void,
  signal?: AbortSignal,
): Promise<{ text: string; isError?: boolean }> {
  const partId = `toolpart_${randomUUID()}`;
  const fire = (frame: ToolPartEventFrame) => { try { emit(frame); } catch { /* fail-open */ } };
  fire(buildToolPartEvent({ sessionID: sessionId, partId, tool: reg.name, status: 'running', input: params }));
  let out: { text: string; isError?: boolean };
  try {
    out = await reg.execute(params, signal);
  } catch (err: any) {
    fire(buildToolPartEvent({ sessionID: sessionId, partId, tool: reg.name, status: 'error', input: params, error: err?.message ?? String(err) }));
    throw err;
  }
  if (out?.isError) {
    fire(buildToolPartEvent({ sessionID: sessionId, partId, tool: reg.name, status: 'error', input: params, error: out.text }));
  } else {
    fire(buildToolPartEvent({ sessionID: sessionId, partId, tool: reg.name, status: 'completed', input: params, output: out?.text ?? '' }));
  }
  return out;
}

/** opt-in 包装：无事件映射的 in-process runtime 用——emit 指向其 global.event() 流（进 wrapGlobalEventStream 同管线）。 */
export function wrapRegistrationsWithEvents(
  regs: MafwToolRegistration[],
  sessionId: string,
  emit: (evt: unknown) => void,
): MafwToolRegistration[] {
  return regs.map((reg) => ({
    ...reg,
    async execute(params: any, signal?: AbortSignal) {
      return executeWithToolFrames(reg, params, sessionId, emit, signal);
    },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/runtime/mafw-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/mafw-tools.ts gateway/tests/unit/runtime/mafw-tools.test.ts
git commit -m "feat(gateway): 合成 tool part 事件核心——buildToolPartEvent/executeWithToolFrames 两帧终态制/wrapRegistrationsWithEvents opt-in（spec 2026-10-20 §4.1）"
```

---

### Task 2: /api/tools/execute 接线发射

**Files:**
- Modify: `gateway/src/routes/tools.ts`
- Modify: `gateway/src/index.ts`（挂载点 emitEvent）
- Test: `gateway/tests/unit/routes/tools.test.ts`

**Interfaces:**
- Consumes: `executeWithToolFrames`（Task 1）
- Produces: `ToolsExecuteDeps.emitEvent: (evt: unknown) => void`（必选）

- [ ] **Step 1: Write the failing tests**

`tools.test.ts` 改造：两个 describe 的 deps 都加 `emitEvent` spy；新增帧断言 describe。关键改动（`deps` 工厂重写）：

```typescript
import { executeWithToolFrames } from '../../../src/runtime/mafw-tools'; // 不需要——仅 route 用

describe('POST /api/tools/execute（通用执行）', () => {
  const makeDeps = (regOver: any = {}) => ({
    buildFactory: () => (sid: string) => [
      { name: 'mafw_echo', description: 'd', parameters: { type: 'object', properties: {} }, ...regOver, execute: regOver.execute ?? (async (p: any) => ({ text: `${sid}:${p.x ?? ''}` })) },
    ] as any[],
    emitEvent: jest.fn(),
  });

  it('按名分发 + sessionID 亲和 + 两帧合成（running→completed，同 part.id）', async () => {
    const deps = makeDeps();
    const { res, status, body } = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'mafw_echo', params: { x: 'v' }, sessionID: 's7' }), res, deps);
    expect(status()).toBe(200);
    expect(JSON.parse(body())).toEqual({ text: 's7:v' });
    expect(deps.emitEvent).toHaveBeenCalledTimes(2);
    const f1 = (deps.emitEvent as jest.Mock).mock.calls[0][0];
    const f2 = (deps.emitEvent as jest.Mock).mock.calls[1][0];
    expect(f1.type).toBe('part.updated');
    expect(f1.properties.part.state.status).toBe('running');
    expect(f1.properties.sessionID).toBe('s7');
    expect(f2.properties.part.state.status).toBe('completed');
    expect(f2.properties.part.state.output).toBe('s7:v');
    expect(f1.properties.part.id).toBe(f2.properties.part.id);
  });

  it('isError → error 帧；execute 抛错 → 502 + error 帧', async () => {
    const depsErr = makeDeps({ execute: async () => ({ text: 'bad', isError: true }) });
    const a = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'mafw_echo', sessionID: 's' }), a.res, depsErr);
    expect(a.status()).toBe(200);
    const frames = (depsErr.emitEvent as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(frames[1].properties.part.state.status).toBe('error');

    const depsThrow = makeDeps({ execute: async () => { throw new Error('kaboom'); } });
    const b = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'mafw_echo', sessionID: 's' }), b.res, depsThrow);
    expect(b.status()).toBe(502);
    const frames2 = (depsThrow.emitEvent as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(frames2[1].properties.part.state.status).toBe('error');
    expect(frames2[1].properties.part.state.error).toContain('kaboom');
  });

  it('未知工具 404 / 缺 name 400 → 零帧（D7 无幻影卡片）', async () => {
    const deps = makeDeps();
    const a = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'nope', sessionID: 's' }), a.res, deps);
    expect(a.status()).toBe(404);
    const b = fakeRes();
    await handleToolsExecute(fakeReq({ sessionID: 's' }), b.res, deps);
    expect(b.status()).toBe(400);
    expect(deps.emitEvent).not.toHaveBeenCalled();
  });

  it('坏 JSON → 400 零帧', async () => {
    const deps = makeDeps();
    const badReq = { on: (ev: string, cb: (d?: string) => void) => { if (ev === 'data') cb('{not json'); if (ev === 'end') cb(); return badReq; } } as any;
    const { res, status } = fakeRes();
    await handleToolsExecute(badReq, res, deps);
    expect(status()).toBe(400);
    expect(deps.emitEvent).not.toHaveBeenCalled();
  });
});
```

（原「按名分发」「未知工具」「缺 name/坏 JSON」四测合并进上述结构，断言保留并加零帧检查。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/routes/tools.test.ts`
Expected: FAIL——deps 无 emitEvent（TS）/ 帧断言失败

- [ ] **Step 3: Implement**

3a. `routes/tools.ts`：import 区加 `executeWithToolFrames`；deps 增字段；执行行替换：

```typescript
import { MAFW_TOOL_SPECS, executeWithToolFrames } from '../runtime/mafw-tools';

export interface ToolsExecuteDeps {
  buildFactory: () => (sessionId: string) => MafwToolRegistration[];
  /** 合成事件出口（index.ts 接 handleOpencodeEvent——与 runtime 事件同管线：enrich/trajectory/广播） */
  emitEvent: (evt: unknown) => void;
}
```

`reg.execute(body.params ?? {}, undefined)` 替换为：

```typescript
    const out = await executeWithToolFrames(reg, body.params ?? {}, sessionID, deps.emitEvent);
```

（404/400 早退在查找之前，天然零帧——D7。）

3b. `index.ts` `/api/tools/execute` 挂载处 deps 增：

```typescript
          await handleToolsExecute(req, res, {
            buildFactory: () => buildMafwToolFactory({ baseUrl: `http://127.0.0.1:${config.server.apiPort}` }),
            emitEvent: (evt) => this.handleOpencodeEvent(evt),
          });
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx jest tests/unit/routes/tools.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS + EXIT=0

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/tools.ts gateway/src/index.ts gateway/tests/unit/routes/tools.test.ts
git commit -m "feat(gateway): /api/tools/execute 合成两帧 tool part 经 handleOpencodeEvent 同管线广播——out-of-process 工具调用可见（spec 2026-10-20 §4.2）"
```

---

### Task 3: conformance tool-visibility 场景

**Files:**
- Modify: `gateway/src/runtime/conformance-scenarios.ts`（id union + SCENARIOS + evaluator + ObservedEvent.part）
- Modify: `gateway/src/routes/conformance.ts`（deps + driver 分支）
- Modify: `gateway/src/index.ts`（tap 快照带 part L1133 + conformanceDeps 增 injectEvent）
- Test: `gateway/tests/unit/runtime/conformance-scenarios.test.ts`、`gateway/tests/unit/routes/conformance.test.ts`

**Interfaces:**
- Consumes: `buildToolPartEvent`（Task 1）；tap 注册（`registerEventTap`）
- Produces: `ObservedEvent.part?: any`；`ConformanceDeps.injectEvent(evt: unknown): void`；场景 id `'tool-visibility'`

- [ ] **Step 1: Write the failing tests**

`conformance-scenarios.test.ts` 追加：

```typescript
describe('evaluateScenario — tool-visibility', () => {
  const frame = (status: string, id = 'toolpart_p', toolClass?: string) => ({
    type: 'part.updated', sessionID: 'p1', at: 1,
    part: { id, type: 'tool', tool: 'mafw_conformance_probe', toolClass, state: { status, input: {}, ...(status === 'completed' ? { output: 'ok' } : {}) } },
  });

  it('两帧 running→completed 同 id + toolClass enrich → pass', () => {
    const r = evaluateScenario('tool-visibility', [frame('running'), frame('completed', 'toolpart_p', 'other')] as any);
    expect(r.pass).toBe(true);
  });

  it('零帧 → fail（显示链断）', () => {
    const r = evaluateScenario('tool-visibility', []);
    expect(r.pass).toBe(false);
    expect(r.failures[0]).toMatch(/2 tool part frames/);
  });

  it('缺 toolClass → fail；id 不一致 → fail；终态非 completed/error → fail', () => {
    const noClass = evaluateScenario('tool-visibility', [frame('running'), frame('completed')] as any);
    expect(noClass.failures.some((f) => f.includes('toolClass'))).toBe(true);
    const diffId = evaluateScenario('tool-visibility', [frame('running', 'a', 'other'), frame('completed', 'b', 'other')] as any);
    expect(diffId.failures.some((f) => f.includes('part.id'))).toBe(true);
    const badTerminal = evaluateScenario('tool-visibility', [frame('running'), frame('running', 'toolpart_p', 'other')] as any);
    expect(badTerminal.failures.some((f) => f.includes('terminal'))).toBe(true);
  });
});
```

`routes/conformance.test.ts`：`makeDeps` 增 `injectEvent`（模拟 normalize+enrich 后的 tap 快照）：

```typescript
    let tapCb: ((e: any) => void) | undefined;
    // makeDeps 内 registerEventTap 改为：
    registerEventTap: (_sid: string, cb: (e: any) => void) => { tapCb = cb; return () => {}; },
    injectEvent: (evt: any) => {
      const part = evt?.properties?.part
        ? { ...evt.properties.part, toolClass: evt.properties.part.toolClass ?? 'other' }
        : undefined;
      tapCb?.({ type: evt.type, sessionID: evt.properties.sessionID, at: Date.now(), ...(part ? { part } : {}) });
    },
```

（原 setTimeout 回放删除——已由 injectEvent 承担 chat-roundtrip 的观测；若删除后 chat-roundtrip 测试失败，则保留两条 setTimeout 回放作为该 fake 的 promptAsync 副作用，injectEvent 仅服务 tool-visibility。）「runs all scenarios」断言 `{ pass: 5 }` → `{ pass: 6 }`。追加：

```typescript
  it('tool-visibility 单场景：注入探针两帧 → pass', async () => {
    const json = await post({ scenarios: ['tool-visibility'] }, makeDeps());
    expect(json.summary).toEqual({ pass: 1, fail: 0 });
    const r = json.results[0];
    expect(r.id).toBe('tool-visibility');
    expect(r.pass).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/runtime/conformance-scenarios.test.ts tests/unit/routes/conformance.test.ts`
Expected: FAIL——unknown scenario / deps 缺 injectEvent / 5≠6

- [ ] **Step 3: Implement**

3a. `conformance-scenarios.ts`：

```typescript
export interface ObservedEvent {
  type: string;
  sessionID?: string;
  at: number;
  /** part.updated 载荷（tool-visibility 断言用；enrich 在 tap 之前——index.ts:1127<1128） */
  part?: any;
}
```

id union 增 `'tool-visibility'`；SCENARIOS 增：

```typescript
  {
    id: 'tool-visibility',
    title: '工具显示链（合成 tool part 两帧）',
    description: '注入探针帧对（running→completed）后 canonical 管线应产出 tool part（同 part.id、终态序、toolClass enrich）——注册的工具调用不再隐形',
    prompt: '',
    timeoutMs: 10_000,
    requires: {},
  },
```

`evaluateScenario` 增分支：

```typescript
  } else if (id === 'tool-visibility') {
    const parts = events.filter((e) => e.type === 'part.updated' && e.part?.type === 'tool').map((e) => e.part);
    if (parts.length < 2) {
      failures.push('expected 2 tool part frames (running + terminal) — display chain broken: synthetic/self tool events do not reach the canonical pipeline');
    } else {
      if (parts[0].state?.status !== 'running') failures.push('first frame is not running');
      if (!['completed', 'error'].includes(parts[parts.length - 1].state?.status)) failures.push('last frame is not terminal (completed/error)');
      if (parts[0].id !== parts[parts.length - 1].id) failures.push('frames do not share part.id — desktop would render two cards');
      if (parts[parts.length - 1].toolClass === undefined) failures.push('part.toolClass not enriched — enrichToolClass not wired for this event path');
    }
  } else {
```

3b. `routes/conformance.ts`：import `buildToolPartEvent`；`ConformanceDeps` 增 `injectEvent(evt: unknown): void;`；driver 循环增分支（放 `session-lifecycle` else 之前）：

```typescript
      } else if (sc.id === 'tool-visibility') {
        // 确定性、零副作用（不执行真工具、不耗 LLM）：经与 /api/tools/execute 同一
        // 注入点喂探针帧对，tap 断言 canonical 管线产出（spec §4.3）。
        const sid = `conformance_probe_${Date.now()}`;
        const partId = `toolpart_conformance_${Date.now()}`;
        const events: ObservedEvent[] = [];
        const stop = deps.registerEventTap(sid, (e) => events.push(e));
        deps.injectEvent(buildToolPartEvent({ sessionID: sid, partId, tool: 'mafw_conformance_probe', status: 'running', input: {} }));
        deps.injectEvent(buildToolPartEvent({ sessionID: sid, partId, tool: 'mafw_conformance_probe', status: 'completed', input: {}, output: 'probe' }));
        await sleep(300);
        stop();
        const r = evaluateScenario(sc.id, events);
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      } else {
```

3c. `index.ts` 两处：

- tap 快照（~L1133）带 part：

```typescript
        const snap = { type: f.type, sessionID, at: Date.now(), ...(props?.part ? { part: props.part } : {}) };
```

- `conformanceDeps()` 增：

```typescript
      injectEvent: (evt) => this.handleOpencodeEvent(evt),
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/runtime/conformance-scenarios.test.ts tests/unit/routes/conformance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/conformance-scenarios.ts gateway/src/routes/conformance.ts gateway/src/index.ts gateway/tests/unit/runtime/conformance-scenarios.test.ts gateway/tests/unit/routes/conformance.test.ts
git commit -m "feat(gateway): conformance tool-visibility 场景——探针帧对注入 + tap 快照携带 part（toolClass/同 id/终态序断言），注册但隐形变激活期可测（spec 2026-10-20 §4.3）"
```

---

### Task 4: 文档 + 全量回归

**Files:**
- Modify: `.opencode/skills/runtime-plugin-authoring/SKILL.md`（4.8 增显示链段）
- Modify: `AGENTS.md`（/api/tools 行补合成发射）

**Interfaces:** 无代码接口

- [ ] **Step 1: SKILL 4.8 增「显示链」小节**

4.8 末尾「要点」列表后追加：

```markdown
**显示链（注册 ≠ 显示）**——工具能执行不等于前端能看到，三路径任选其一：

1. **runtime 自发**（pi/opencode 现状）：把原生工具事件映射到 `tool.call`/`tool.result` 三原语（gateway `ToolPartAssembler` 合帧）或直映 `part.updated` tool part——见 3.1 契约表
2. **gateway 合成 opt-in**（无事件映射的 in-process runtime）：`wrapRegistrationsWithEvents(regs, sessionId, emit)` 包装 factory 注册项，emit 接你 `global.event()` 流——两帧自动广播
3. **out-of-process 自动**：`POST /api/tools/execute` 自动合成两帧（running→completed/error）经全管线广播；**调用方 = 放弃自发 canonical 工具事件**（防双卡，conformance 校验）

历史渲染：不实现 `session.normalizeMessages` 则历史消息里的工具块不渲染（契约可选方法，pi 有参考实现）。
验证：`POST /api/runtime/conformance {"scenarios":["tool-visibility"]}`。
```

- [ ] **Step 2: AGENTS.md /api/tools 行**

§5.19 `RuntimeClient.tools` 段的 out-of-process 通道句补：「执行自动合成两帧 tool part（running→completed/error，`toolpart_<uuid>`）经 handleOpencodeEvent 同管线广播（enrich/trajectory/Mode A）」。

- [ ] **Step 3: 全量回归 + build**

Run（gateway/）: `npx jest`
Run（root）: `npm run build`
Expected: 全绿 + exit 0

- [ ] **Step 4: Commit**

```bash
git add .opencode/skills/runtime-plugin-authoring/SKILL.md AGENTS.md
git commit -m "docs(gateway): 工具显示链文档——SKILL 4.8 三路径 + AGENTS /api/tools 合成发射说明（spec 2026-10-20 §4.4）"
```

---

## Self-Review 记录

- **Spec 覆盖**：D1-D8 → Task 1（D1/D3/D5/D6/D8）、Task 2（D2/D4/D7）；§4.3 → Task 3；§4.4 → Task 4；验收五条 → Task 2/3 测试 + Task 4 回归
- **占位符**：无；全部代码块完整
- **类型一致性**：`ToolPartEventFrame` 定义（Task 1）= route/conformance 消费形状；`emitEvent: (evt: unknown) => void` 与 `executeWithToolFrames` 的 `emit: (evt: ToolPartEventFrame) => void` 兼容（逆变）；`ObservedEvent.part` tap 快照与 evaluator 断言字段一致（part.id/state.status/toolClass）
- **波及面**：tools.test.ts 四测重构（emitEvent 必选）；conformance.test.ts fake deps 改造 + 5→6；chat-roundtrip fake 若依赖原 setTimeout 回放则保留——已在 Step 1 注明两种处理
