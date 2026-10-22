# 工具面 MCP 对齐（Tool Face MCP Alignment）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MAFW 工具面对齐 MCP stable spec 三件套——44+ 网关工具全量 `annotations`、首批 3 工具 `outputSchema` + `structuredContent`，审批语义零改动。

**Architecture:** 纯函数注解层（三级解析：声明 > mafw 专属表 > TOOL_CLASS 派生）→ MCP registry 构造期物化 → CallTool 透传 structuredContent。mafw_* 走专属表**不进**审批消费的 `TOOL_CLASS_TABLE`（builder check Q1 裁决）。`/api/tools/execute` 与六件套 execute 返回形状本批不动（§5.4 已撤销）。

**Tech Stack:** TypeScript / jest / @modelcontextprotocol/sdk 1.30.0（已装，零升级——`Annotations`/`outputSchema`/`CallToolResult.structuredContent` 原生支持）

**Spec:** `docs/superpowers/specs/2026-10-22-tool-face-mcp-alignment-design.md`（v2，builder check 四裁决已并入；计划从 spec 论证，两者一起读）

## Global Constraints

- C1 annotations/outputSchema/structuredContent 全部可选元数据；消费方不识别时 fail-open 忽略（wire 上多余字段被 MCP 客户端忽略）
- C2 **审批零翻转**：`TOOL_CLASS_TABLE`（`gateway/src/runtime/tool-classes.ts:25`）不得新增任何 `mafw_*` 键；`isReadOnlyTool`（`core/approval/safety-classifier.ts`）对 mafw_* 的判定保持现状（全部 false）
- C3 schema 照实：outputSchema 声明 handler 现有完整返回形状（含 `state`/`canExpand`/`memory_value` 迭代协议字段），不裁剪
- C4 六件套单源：spec 与 execute 同走 `runtime/mafw-tools.ts`；`/api/tools/execute` 合成的 tool part 帧字节不变
- C5 测试基线：gateway 328 套件 / claude adapter 24 / desktop 1124 / tui 220——全量回归不得低于此（新增测试除外）
- C6 中文注释/描述编码：PowerShell 管道会坏中文——多行中文内容用 `write`/`edit` 工具写文件，不用 PowerShell here-string patch 含中文的文件

## Review Focus

1. **审批翻转**（spec §3 反目标）：未来把 mafw_* 塞回 `TOOL_CLASS_TABLE` 会让 manager 的 deny file-edit 压过 allowlist → 15 工具 auto-deny。→ Task 6 钉扎测试：表内无 mafw_* 键 + `isReadOnlyTool('mafw_search_hybrid') === false`。
2. **新工具漏注解**：新增 MCP 工具未登记注解，ListTools 出现无 annotations 定义。→ Task 2 覆盖门：registry 全部工具名 ∈ `MAFW_TOOL_ANNOTATIONS`。
3. **error 载荷带 structured**：handler 错误路径返回 `{error}` 形状，与 success schema 不符——错误结果不得携带 structuredContent。→ Task 4 测试断言 error 分支无 `structuredContent`。
4. **text/structured 漂移**：两载荷不同步（消费者解析 text 与 structured 得到不同事实）。→ Task 4 测试断言 `structuredContent` deep-equal `JSON.parse(text)`。
5. **part 帧字节漂移**：六件套经 `/api/tools/execute` 的 tool part 帧被本批改动污染（desktop deep-equal 契约）。→ Task 6 全量回归（desktop 套件含 part 契约测试，本批未碰该路径即天然保持；回归确认）。

---

### Task 1: 注解类型与三级解析（tool-classes.ts）

**Files:**
- Modify: `gateway/src/runtime/tool-classes.ts`（新增 `MafwToolAnnotations` 类型 + `MAFW_TOOL_ANNOTATIONS` 表 + `annotationsForTool`）
- Test: `gateway/tests/unit/runtime/tool-annotations.test.ts`（新建）

**Interfaces:**
- Produces: `MafwToolAnnotations`（`{title?, readOnlyHint?, destructiveHint?, idempotentHint?, openWorldHint?}`，全部可选 boolean/string）；`annotationsForTool(name: string, declared?: MafwToolAnnotations, toolClass?: TOOL_CLASS): MafwToolAnnotations | undefined`；`MAFW_TOOL_ANNOTATIONS: Record<string, MafwToolAnnotations>`（45 条）。后续任务从本文件 import。

**落点裁决（对 spec §5.1 的偏差，已定）**：`MafwToolAnnotations` 定义在 `tool-classes.ts` 而非 `contract.ts`——contract.ts 已 import `TOOL_CLASS` 自 tool-classes.ts，注解类型落在同文件避免潜在环。Task 5 时 contract.ts 用 `import type` 引入。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime/tool-annotations.test.ts
import { annotationsForTool, MAFW_TOOL_ANNOTATIONS } from '../../../src/runtime/tool-classes';

describe('annotationsForTool 三级解析（spec §5.2）', () => {
  it('第一级：声明覆盖优先', () => {
    expect(annotationsForTool('mafw_add_memory', { readOnlyHint: true }))
      .toEqual({ readOnlyHint: true, destructiveHint: false }); // 浅合并：声明字段覆盖派生，未声明字段保留表值
  });
  it('第二级：mafw 专属表命中（不查 TOOL_CLASS_TABLE）', () => {
    expect(annotationsForTool('mafw_search_hybrid')).toEqual({ readOnlyHint: true, idempotentHint: true });
    expect(annotationsForTool('mafw_python')).toEqual({ readOnlyHint: false, destructiveHint: true });
  });
  it('第三级：runtime 原生工具走 TOOL_CLASS 派生', () => {
    expect(annotationsForTool('read', undefined, 'readonly')).toEqual({ readOnlyHint: true, idempotentHint: true });
    expect(annotationsForTool('bash', undefined, 'shell')).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(annotationsForTool('x_unknown', undefined, 'other')).toEqual({});
  });
  it('三级全 miss → undefined（不硬猜）', () => {
    expect(annotationsForTool('totally_unknown')).toBeUndefined();
    expect(annotationsForTool('totally_unknown', undefined, 'other')).toEqual({}); // other 类 = 空注解非 undefined
  });
  it('mafw_* 永不走 TOOL_CLASS 派生（表内名字优先）', () => {
    expect(annotationsForTool('mafw_search_hybrid', undefined, 'file-edit'))
      .toEqual({ readOnlyHint: true, idempotentHint: true }); // toolClass 参数被无视
  });
  // 完整性不做绝对数断言（AGENTS.md 39/40 自相矛盾、设计表手数 44）——
  // 真守卫是 Task 2/5 的关系性覆盖门：registry 全部名 + 六件套名 ∈ 本表。
});
```

（浅合并语义：`{...tableEntry, ...declared}`；"表值"断言以 spec §5.2 v2 表为准——实现时逐条对照，断言里的具体值若与表冲突以表为准修正断言。）

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/tool-annotations.test.ts`
Expected: FAIL（`annotationsForTool` 不存在）

- [ ] **Step 3: 实现**

`tool-classes.ts` 追加（放在 `TOOL_CLASS_TABLE` 之后）：
1. `export interface MafwToolAnnotations`（五字段全可选）
2. `const TOOL_CLASS_ANNOTATIONS: Record<TOOL_CLASS, MafwToolAnnotations>`——spec §5.2 v2 派生表逐行（readonly/search/plan = `{readOnlyHint:true, idempotentHint:true}`；file-edit/shell = `{readOnlyHint:false, destructiveHint:true, idempotentHint:false}`；subagent = `{readOnlyHint:false, destructiveHint:false, idempotentHint:false}`；web = `{readOnlyHint:false, openWorldHint:true}`；other = `{}`）
3. `const MAFW_TOOL_ANNOTATIONS: Record<string, MafwToolAnnotations>`——**spec §5.2 v2 的 45 条 mafw 表逐条照抄**（含 desktop_* 六条与 media/python 条目）
4. `export function annotationsForTool(name, declared?, toolClass?)`：name ∈ MAFW_TOOL_ANNOTATIONS → `{...entry, ...declared}`；否则 toolClass 提供 → `{...TOOL_CLASS_ANNOTATIONS[toolClass], ...declared}`；两者皆无 → `declared` 非空则返回 declared，否则 `undefined`

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/runtime/tool-annotations.test.ts`
Expected: PASS 全绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/tool-classes.ts gateway/tests/unit/runtime/tool-annotations.test.ts
git commit -m "feat(runtime): MafwToolAnnotations + three-level annotationsForTool (declared > mafw table > TOOL_CLASS derivation) - approval-consumed TOOL_CLASS_TABLE untouched (design Q1)"
```

---

### Task 2: MCP 工具定义类型扩展与构造期物化（types.ts + tool-registry.ts）

**Files:**
- Modify: `gateway/src/types.ts:43-51`（`ToolDefinition` 加可选字段）
- Modify: `gateway/src/mcp/tool-registry.ts`（definitions 物化 annotations）
- Test: `gateway/tests/unit/mcp/tool-registry-annotations.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `annotationsForTool`
- Produces: `ToolDefinition.annotations?: MafwToolAnnotations`（注意：MCP wire 形状字段名就是 `annotations`）；`ToolDefinition.outputSchema?: Record<string, unknown>`。registry 需导出 `DEFINITIONS`（或等价工厂）供测试枚举。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/mcp/tool-registry-annotations.test.ts
import { DEFINITIONS } from '../../../src/mcp/tool-registry';
import { MAFW_TOOL_ANNOTATIONS } from '../../../src/runtime/tool-classes';

describe('MCP 定义面注解物化（spec G2/G3）', () => {
  it('覆盖门：每个 registry 工具都登记在 MAFW_TOOL_ANNOTATIONS（新工具漏登记即 fail）', () => {
    for (const def of DEFINITIONS) {
      expect(MAFW_TOOL_ANNOTATIONS).toHaveProperty(def.name);
    }
  });
  it('每个定义携带 annotations（构造期物化）', () => {
    for (const def of DEFINITIONS) {
      expect(def.annotations).toBeDefined();
    }
  });
  it('内部一致性：definitions 与 handlers 一一对应（防掉工具/掉 handler）', () => {
    // 经 createToolRegistry(services) 取 handlers（services 用最小 fake）；
    // 断言 new Set(Object.keys(handlers)) === new Set(DEFINITIONS.map(d => d.name))
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/mcp/tool-registry-annotations.test.ts`
Expected: FAIL（DEFINITIONS 未导出 / annotations 不存在）

- [ ] **Step 3: 实现**

1. `types.ts` `ToolDefinition` 加 `annotations?: MafwToolAnnotations`（`import type` from `../runtime/tool-classes`）+ `outputSchema?: Record<string, unknown>`
2. `tool-registry.ts`：导出 `DEFINITIONS`（`const DEFINITIONS` → `export const DEFINITIONS`，现仅本文件消费，导出零风险）；文件头部 import `annotationsForTool`；**构造期物化**——将 `DEFINITIONS` 改为在模块加载时 map 一次：每条定义附加 `annotations: annotationsForTool(name)`（registry 定义无手工声明，走第二级 mafw 表；title 本批不填——registry 定义无 label 字段，YAGNI）

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/mcp/tool-registry-annotations.test.ts`
Expected: PASS

- [ ] **Step 5: 全量 MCP 相关回归 + Commit**

Run: `cd gateway && npx jest tests/unit/mcp --silent 2>&1 | Select-String "Tests:"`
Expected: 既有 MCP 套件全绿（ListTools 直通 `definitions`，多余字段 MCP SDK 容忍——annotations 本就是 SDK Tool 类型字段）

```bash
git add gateway/src/types.ts gateway/src/mcp/tool-registry.ts gateway/tests/unit/mcp/tool-registry-annotations.test.ts
git commit -m "feat(mcp): ToolDefinition annotations/outputSchema optional fields + registry construction-time materialization (40 tools) + coverage gate"
```

---

### Task 3: CallTool structuredContent 透传通道（共享映射 + 两 transport）

**Files:**
- Create: `gateway/src/mcp/call-result.ts`
- Modify: `gateway/src/mcp/sse-transport.ts:57-63`、`gateway/src/mcp/streamable-endpoint.ts:46-52`（CallTool handler 出口改用共享映射）
- Modify: `gateway/src/types.ts:38-41`（`ToolHandler` 返回类型加 `structuredContent?`）
- Test: `gateway/tests/unit/mcp/call-result.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 的 `ToolDefinition` 扩展（无直接依赖）
- Produces: `toCallToolResult(handlerResult: { content: Array<{type: string; text: string}>; isError?: boolean; structuredContent?: Record<string, unknown> }): { content: Array<{type: string; text: string}>; isError?: boolean; structuredContent?: Record<string, unknown> }`——恒等映射（今日），但作为两 transport 的单一出口，Task 4 起 structuredContent 经它直达 `CallToolResult.structuredContent`。`ToolHandler`（types.ts）返回形状加 `structuredContent?: Record<string, unknown>`。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/mcp/call-result.test.ts
import { toCallToolResult } from '../../../src/mcp/call-result';

describe('toCallToolResult（CallTool 出口单一映射，spec G4）', () => {
  it('纯 content 恒等透传（今日行为不变）', () => {
    const r = { content: [{ type: 'text', text: 'ok' }] };
    expect(toCallToolResult(r)).toEqual(r);
  });
  it('structuredContent 透传（MCP 双载荷：content + structuredContent）', () => {
    const r = { content: [{ type: 'text', text: '{}' }], structuredContent: { success: true } };
    expect(toCallToolResult(r).structuredContent).toEqual({ success: true });
  });
  it('isError 透传', () => {
    const r = { content: [{ type: 'text', text: 'e' }], isError: true };
    expect(toCallToolResult(r).isError).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/mcp/call-result.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

1. `types.ts` `ToolHandler` 返回类型加 `structuredContent?: Record<string, unknown>`
2. 新建 `mcp/call-result.ts`：`toCallToolResult` 恒等映射（含 structuredContent 透传）——单一出口的意义是两 transport 的 CallTool handler 不再各自内联拼装
3. 两 transport 的 `CallToolRequestSchema` handler：handler 结果返回处改 `return toCallToolResult(result)`（unknown-tool / try-catch 分支保持原样，不动）

- [ ] **Step 4: 运行确认通过 + MCP 回归**

Run: `cd gateway && npx jest tests/unit/mcp --silent 2>&1 | Select-String "Tests:"`
Expected: 新测试 3 例 PASS + 既有 MCP 套件全绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/types.ts gateway/src/mcp/call-result.ts gateway/src/mcp/sse-transport.ts gateway/src/mcp/streamable-endpoint.ts gateway/tests/unit/mcp/call-result.test.ts
git commit -m "feat(mcp): ToolHandler structuredContent + shared toCallToolResult mapping for both transports"
```

---

### Task 4: 首批三工具 structuredContent + outputSchema（schema 照实）

**Files:**
- Modify: `gateway/src/mcp/handlers/search-hybrid.ts:194`（成功分支）
- Modify: `gateway/src/mcp/handlers/get-memory.ts`（成功分支 return）
- Modify: `gateway/src/mcp/handlers/manager-list-goals.ts`（成功分支 return）
- Modify: `gateway/src/mcp/tool-registry.ts`（3 条定义加 `outputSchema`）
- Test: `gateway/tests/unit/mcp/structured-handlers.test.ts`（新建）

**Interfaces:**
- Consumes: Task 3 的 `ToolHandler.structuredContent`
- Produces: 三工具 CallTool 成功结果带 `structuredContent`（与 text JSON 同源单对象）；三定义带 `outputSchema`

**实现形态（三 handler 同一模式）**：成功分支改为 `const payload = {...}` 单对象 → `return { content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload }`——text 与 structured 同源，漂移不可能。**错误分支不动**（无 structuredContent，Review Focus #3）。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/mcp/structured-handlers.test.ts
// 三个 handler 的 Services 用现有测试的最小 fake（参考同目录既有 handler 测试的 services 构造；
// search-hybrid 需 indexManager mock——若既有测试无先例，用极简 fake：search() 返回空、graphStore 为 null）
import { handleSearchHybrid } from '../../../src/mcp/handlers/search-hybrid';
import { handleGetMemory } from '../../../src/mcp/handlers/get-memory';
import { handleManagerListGoals } from '../../../src/mcp/handlers/manager-list-goals';
import { DEFINITIONS } from '../../../src/mcp/tool-registry';

describe('首批 structured 工具（spec G5，schema 照实）', () => {
  it('mafw_search_hybrid：structuredContent 与 text 同源（含迭代协议字段）', async () => {
    const r = await handleSearchHybrid({ query: 'x' }, fakeServices as any);
    expect(r.structuredContent).toBeDefined();
    expect(r.structuredContent).toEqual(JSON.parse(r.content[0].text));
    for (const k of ['results', 'canExpand', 'round', 'count', 'hint']) {
      expect(r.structuredContent!).toHaveProperty(k); // schema 照实：迭代协议字段不得丢
    }
  });
  it('mafw_get_memory：structuredContent 信封 {success, memory}', async () => {
    const r = await handleGetMemory({ id: 'mem_missing' }, fakeServices as any);
    // 缺 id 的行为以现有 handler 为准（成功/失败路径都断言同源原则）：
    expect(r.structuredContent === undefined || r.structuredContent).toEqual(JSON.parse(r.content[0].text));
  });
  it('mafw_list_goals：structuredContent 与 text 同源', async () => {
    const r = await handleManagerListGoals({}, { mafwDir: undefined } as any);
    expect(r.structuredContent).toBeDefined();
    expect(r.structuredContent).toEqual(JSON.parse(r.content[0].text));
  });
  it('错误分支无 structuredContent（Review Focus #3）', async () => {
    const r = await handleGetMemory({ id: '' }, fakeServices as any);
    if (r.isError) expect(r.structuredContent).toBeUndefined();
  });
  it('三定义携带 outputSchema（顶层 object）', () => {
    for (const name of ['mafw_search_hybrid', 'mafw_get_memory', 'mafw_list_goals']) {
      const def = DEFINITIONS.find(d => d.name === name)!;
      expect(def.outputSchema).toBeDefined();
      expect(def.outputSchema!.type).toBe('object');
    }
  });
});
```

（`fakeServices` 构造参考同目录既有 handler 测试；断言与 handler 实际行为冲突时以"同源原则 + 迭代协议字段在场"为不变量，具体字段断言可修正。）

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/mcp/structured-handlers.test.ts`
Expected: FAIL（structuredContent 不存在）

- [ ] **Step 3: 实现**

1. 三 handler 成功分支改单对象模式（见上）
2. `tool-registry.ts` 三定义加 `outputSchema`（schema 照实——required 只放恒在场字段）：
   - `mafw_search_hybrid`：`{type:'object', properties:{results:{type:'array',items:{type:'object'}}, canExpand:{type:'boolean'}, state:{type:['string','null']}, round:{type:'number'}, count:{type:'number'}, fok:{type:'object'}, hint:{type:'string'}}, required:['results','canExpand','round','count','hint']}`
   - `mafw_get_memory`：`{type:'object', properties:{success:{type:'boolean'}, memory:{type:'object'}, latest:{type:'object'}, source:{type:'object'}}, required:['success','memory']}`
   - `mafw_list_goals`：`{type:'object', properties:{success:{type:'boolean'}, goals:{type:'array',items:{type:'object',properties:{goalId:{type:'string'},phase:{type:'string'},round:{},verdict:{},updatedAt:{}},required:['goalId']}}}, required:['success','goals']}`（`round/verdict/updatedAt` 可缺省——goal state 字段可选，不进 required）

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/mcp/structured-handlers.test.ts tests/unit/mcp --silent 2>&1 | Select-String "Tests:"`
Expected: PASS + MCP 套件全绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/handlers/search-hybrid.ts gateway/src/mcp/handlers/get-memory.ts gateway/src/mcp/handlers/manager-list-goals.ts gateway/src/mcp/tool-registry.ts gateway/tests/unit/mcp/structured-handlers.test.ts
git commit -m "feat(mcp): first-batch structuredContent for search_hybrid/get_memory/list_goals (single-source payload, iteration protocol fields preserved) + outputSchema as-documented"
```

---

### Task 5: RuntimeClient 契约扩展 + 六件套 factory 挂注解

**Files:**
- Modify: `gateway/src/runtime/contract.ts:184-193`（`MafwToolRegistration` 加两可选字段）
- Modify: `gateway/src/runtime/mafw-tools.ts:21-26`（`MafwToolSpec` 同步）+ factory 出口挂注解
- Test: `gateway/tests/unit/runtime/mafw-tools-annotations.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `MafwToolAnnotations`/`annotationsForTool`（`import type` + 值导入）
- Produces: `MafwToolRegistration.annotations?: MafwToolAnnotations`、`MafwToolRegistration.outputSchema?: Record<string, any>`；`MafwToolSpec` 同两字段。六件套注册条目自动携带 `annotations`（factory 物化，TOOL_DEFS 字面量不写注解——单源）。pi stash 透传零行为变化（typebox 通道只消费 parameters，字段 fail-open）。

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime/mafw-tools-annotations.test.ts
import { buildMafwToolFactory } from '../../../src/runtime/mafw-tools';
import { MAFW_TOOL_ANNOTATIONS } from '../../../src/runtime/tool-classes';

describe('六件套 factory 注解物化（spec G1/G3）', () => {
  it('六件套全部携带 annotations（factory 构造期，spec §5.5）', () => {
    const factory = buildMafwToolFactory({ baseUrl: 'http://127.0.0.1:3000' });
    const regs = factory('ses_test');
    expect(regs).toHaveLength(6);
    for (const r of regs) {
      expect(r.annotations).toBeDefined();
      expect(r.annotations).toEqual(MAFW_TOOL_ANNOTATIONS[r.name]);
    }
  });
  it('六件套名字全部登记在注解表（覆盖门）', () => {
    for (const name of ['mafw_add_memory', 'mafw_python', 'mafw_python_restart', 'mafw_media_ask', 'mafw_media_upload', 'mafw_media_speak']) {
      expect(MAFW_TOOL_ANNOTATIONS).toHaveProperty(name);
    }
  });
});
```

（`buildMafwToolFactory` 签名以现有导出为准——若参数形状不同，以"拿到 6 条注册"为不变量调整构造。）

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/mafw-tools-annotations.test.ts`
Expected: FAIL（annotations 不存在）

- [ ] **Step 3: 实现**

1. `contract.ts`：`import type { MafwToolAnnotations } from './tool-classes'`；`MafwToolRegistration` 加 `annotations?: MafwToolAnnotations` + `outputSchema?: Record<string, any>`（注释：缺省无声明；runtime 不识别时 fail-open 忽略）
2. `mafw-tools.ts`：`MafwToolSpec` 同两字段；factory 产出注册处（TOOL_DEFS map → registration）附加 `annotations: annotationsForTool(d.spec.name)`（spec 字面量不写注解——表是单源；若 spec 自带 `annotations` 则 `annotationsForTool(name, spec.annotations)` 走覆盖级）

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/runtime/mafw-tools-annotations.test.ts tests/unit/runtime --silent 2>&1 | Select-String "Tests:"`
Expected: PASS + runtime 套件全绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/mafw-tools.ts gateway/tests/unit/runtime/mafw-tools-annotations.test.ts
git commit -m "feat(runtime): MafwToolRegistration annotations/outputSchema contract fields + six-piece factory annotation materialization (single source: MAFW_TOOL_ANNOTATIONS)"
```

---

### Task 6: 审批零翻转钉扎 + 全量回归收口

**Files:**
- Modify: `gateway/src/runtime/tool-classes.ts:25`（`TOOL_CLASS_TABLE` 导出——`const` → `export const`，供钉扎测试枚举）
- Test: `gateway/tests/unit/runtime/approval-flip-pin.test.ts`（新建）

**Interfaces:**
- Consumes: `TOOL_CLASS_TABLE`（导出后）、`toolClassOf`、`isReadOnlyTool`（`core/approval/safety-classifier.ts`——若其为内部函数，通过其导出的公共入口断言；grep 确认）
- Produces: 审批零翻转钉扎（Review Focus #1 的永久防线）

- [ ] **Step 1: 写测试（本任务测试今日即绿——钉扎性质，先跑一次确认现状值）**

```typescript
// gateway/tests/unit/runtime/approval-flip-pin.test.ts
import { TOOL_CLASS_TABLE, toolClassOf } from '../../../src/runtime/tool-classes';
import { isReadOnlyTool } from '../../../src/core/approval/safety-classifier';

describe('审批零翻转钉扎（design §3 反目标 / Review Focus #1）', () => {
  it('TOOL_CLASS_TABLE 无任何 mafw_* 键（manager/curator 的类 deny 不可能波及网关工具）', () => {
    const offenders = Object.keys(TOOL_CLASS_TABLE).filter(k => k.startsWith('mafw_'));
    expect(offenders).toEqual([]);
  });
  it('mafw_* 的类别解析保持现状（undefined = 落 allowlist 名字匹配）', () => {
    expect(toolClassOf('mafw_add_memory')).toBeUndefined();
    expect(toolClassOf('mafw_search_hybrid')).toBeUndefined();
    expect(toolClassOf('mafw_restart_agent')).toBeUndefined();
  });
  it('isReadOnlyTool 对 mafw_* 保持现状（全部 false——注解不是审批权威）', () => {
    for (const name of ['mafw_search_hybrid', 'mafw_get_memory', 'mafw_add_memory', 'mafw_python']) {
      expect(isReadOnlyTool(name)).toBe(false);
    }
  });
});
```

（`isReadOnlyTool` 签名/导出以实际为准；若它接受 part/toolName 双形态，用最简形态。**先跑一次记录现状值——若某 mafw 工具今日已是 true，钉扎现状而非臆断 false。**）

- [ ] **Step 2: 运行（确认钉的是现状）**

Run: `cd gateway && npx jest tests/unit/runtime/approval-flip-pin.test.ts`
Expected: PASS（若 FAIL 说明现状认知有误——以实际输出修正断言并记录，不改生产代码）

- [ ] **Step 3: 导出 TOOL_CLASS_TABLE（若 Step 1 已需要）**

`tool-classes.ts:25` `const TOOL_CLASS_TABLE` → `export const TOOL_CLASS_TABLE`（纯导出，零行为变化）

- [ ] **Step 4: 四套全量回归（Review Focus #5：part 契约）**

Run:
```
cd gateway && npx jest 2>&1 | Select-String "Tests:|Suites:"     # ≥328 suites / ≥2343（基线 2325 + 新增 ~18）
cd adapters/claude && npm test 2>&1 | Select-String "pass|fail"  # 24（本批不碰 adapter，恒定）
cd packages/desktop && npm test 2>&1 | Select-String "# pass"    # ≥1124（含并行会话新增；本批不碰 desktop）
cd packages/tui && node --test "tests/*.test.ts" 2>&1 | Select-String "pass|fail"  # 220
```
Expected: 全绿（gateway 全量偶发 laya-client/worktree/goal 并行 flake 已知——隔离重跑即绿，非回归）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/tool-classes.ts gateway/tests/unit/runtime/approval-flip-pin.test.ts
git commit -m "test(runtime): approval zero-flip pinning - TOOL_CLASS_TABLE mafw_* ban + isReadOnlyTool current-verdict snapshot (design Q1 permanent guard)"
```

---

## 收口（执行者完成全部任务后）

1. 汇总：新增测试数 / 四套全量数（对照 C5 基线）
2. `cd gateway && npx tsc --noEmit` 必须干净（P0 教训：gateway 类型检查单独跑）
3. 向用户汇报：交付内容表 + 测试计数 + commit 列表
