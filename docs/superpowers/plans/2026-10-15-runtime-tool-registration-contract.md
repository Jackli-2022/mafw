# Runtime 契约必选工具注册接口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `RuntimeClient` 新增必选 `tools: RuntimeTools` 接口（registerTools + nativeTools），六件套 spec/执行逻辑收敛为 gateway 单源 `runtime/mafw-tools.ts`，runtime 原生工具声明经 tool-classes overlay 生效，附 `/api/tools` HTTP 补充通道。

**Architecture:** 契约收紧为无条件 hard 校验（Tier-0 基线）；gateway 在激活期把 `buildMafwToolFactory()` 推给 runtime（execute 闭包随 spec 走，runtime 只做 plumbing）；`nativeTools()` 声明整体替换 tool-classes overlay（优先于并集表）；out-of-process runtime 经 `GET /api/tools` + `POST /api/tools/execute` 取 spec/执行。

**Tech Stack:** TypeScript (gateway CJS), jest, pi typebox 1.3.7（`T.Unsafe` 包 JSON Schema——`~unsafe` 键为 non-enumerable 不入 wire，spike 已验证：`typebox/build/type/types/unsafe.mjs` + `pi-ai/dist/api/openai-completions.js:1099` 原样透传 + `pi-ai/dist/utils/validation.js:251` 对无 Kind 符号 schema 有 fallback）。

**Spec:** `docs/superpowers/specs/2026-10-15-runtime-tool-registration-contract-design.md`

## Global Constraints

- 每任务一个 commit，直接提交 main（仓库既定工作流），commit 后 gateway jest 相关文件 + 最终任务全量必须绿
- 六件套 = `mafw_add_memory` / `mafw_python` / `mafw_python_restart` / `mafw_media_speak` / `mafw_media_upload` / `mafw_media_ask`，description 文本与现行 `pi-mafw-host-extension.ts` **逐字一致**（迁移非改写）
- v1 opencode 插件（`src/tools/`）**不动**；desktop/TUI **零改动**
- 测试命令一律在 `gateway/` 目录下执行；gateway 侧新代码无注释噪声（遵循仓库现状风格，关键决策处保留中文注释）
- `contract.ts` 不得 import `host-adapter.ts`（契约层保持依赖轻：只 import `tool-classes.ts` 的 `TOOL_CLASS` 类型）

---

### Task 1: tool-classes overlay

**Files:**
- Modify: `gateway/src/runtime/tool-classes.ts`
- Test: `gateway/tests/unit/runtime/tool-classes.test.ts`

**Interfaces:**
- Consumes: 现有 `TOOL_CLASS` / `TOOL_CLASS_TABLE` / `toolClassOf`
- Produces: `setToolClassOverlay(entries: Array<{ name: unknown; toolClass: unknown }>): { applied: number; invalid: string[] }`、`clearToolClassOverlay(): void`；`toolClassOf` 变为 overlay（小写归一）→ 并集表 → `'other'`

- [ ] **Step 1: Write the failing test**

在 `gateway/tests/unit/runtime/tool-classes.test.ts` 末尾追加：

```typescript
import { setToolClassOverlay, clearToolClassOverlay } from '../../../src/runtime/tool-classes';

describe('toolClassOverlay（runtime 声明优先于并集表）', () => {
  afterEach(() => clearToolClassOverlay());

  it('overlay 优先于并集表', () => {
    setToolClassOverlay([{ name: 'list', toolClass: 'shell' }]);
    expect(toolClassOf('list')).toBe('shell');
  });

  it('声明表外新名字生效（大小写归一）', () => {
    setToolClassOverlay([{ name: 'InspectFile', toolClass: 'readonly' }]);
    expect(toolClassOf('inspectfile')).toBe('readonly');
    expect(toolClassOf('InspectFile')).toBe('readonly');
  });

  it('无效条目跳过并报告，好条目照常应用', () => {
    const r = setToolClassOverlay([
      { name: 'good_tool', toolClass: 'web' },
      { name: '', toolClass: 'web' },
      { name: 42, toolClass: 'web' },
      { name: 'bad_class', toolClass: 'nonsense' },
    ]);
    expect(r.applied).toBe(1);
    expect(r.invalid).toHaveLength(3);
    expect(toolClassOf('good_tool')).toBe('web');
  });

  it('重复 set 整体替换（热切换语义）', () => {
    setToolClassOverlay([{ name: 'a', toolClass: 'web' }]);
    setToolClassOverlay([{ name: 'b', toolClass: 'shell' }]);
    expect(toolClassOf('a')).toBe('other');
    expect(toolClassOf('b')).toBe('shell');
  });

  it('clear 后回落并集表', () => {
    setToolClassOverlay([{ name: 'list', toolClass: 'shell' }]);
    clearToolClassOverlay();
    expect(toolClassOf('list')).toBe('search');
  });

  it('enrichToolClass 经 overlay 生效（消费方零改动）', () => {
    setToolClassOverlay([{ name: 'my_read', toolClass: 'readonly' }]);
    const evt = { payload: { type: 'part.updated', properties: { part: { type: 'tool', tool: 'my_read' } } } };
    enrichToolClass(evt);
    expect(evt.payload.properties.part.toolClass).toBe('readonly');
  });
});
```

（import 语句合并进文件头部的现有 import。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/runtime/tool-classes.test.ts`
Expected: FAIL — `setToolClassOverlay` 不存在（模块没有该导出）

- [ ] **Step 3: Write minimal implementation**

`gateway/src/runtime/tool-classes.ts` 的 `toolClassOf` 替换为 overlay 优先，并在文件末尾追加 overlay API：

```typescript
/** 工具名 → 语义类别（未知/自定义 → 'other'；大小写不敏感；runtime 声明 overlay 优先）。 */
export function toolClassOf(toolName: string | undefined | null): TOOL_CLASS {
  if (!toolName) return 'other';
  const lower = String(toolName).toLowerCase();
  return toolClassOverlay.get(lower) ?? TOOL_CLASS_TABLE[lower] ?? 'other';
}
```

文件末尾追加：

```typescript
const TOOL_CLASS_VALUES = new Set<string>([
  'readonly', 'search', 'file-edit', 'shell', 'subagent', 'web', 'plan', 'other',
]);

/** runtime 声明的工具类别 overlay（优先于并集表；小写归一）。 */
const toolClassOverlay = new Map<string, TOOL_CLASS>();

/**
 * 激活期注入 runtime 声明的工具类别（整体替换——热切换语义）。无效条目
 * （空名/非法 class）跳过并报告，由调用方 warning。spec 2026-10-15 §7。
 */
export function setToolClassOverlay(entries: Array<{ name: unknown; toolClass: unknown }>): { applied: number; invalid: string[] } {
  toolClassOverlay.clear();
  const invalid: string[] = [];
  let applied = 0;
  for (const e of entries ?? []) {
    const name = typeof e?.name === 'string' ? e.name.trim().toLowerCase() : '';
    const cls = e?.toolClass;
    if (!name || typeof cls !== 'string' || !TOOL_CLASS_VALUES.has(cls)) {
      invalid.push(JSON.stringify(e));
      continue;
    }
    toolClassOverlay.set(name, cls as TOOL_CLASS);
    applied++;
  }
  return { applied, invalid };
}

/** 清空 overlay（回落并集表；测试隔离用）。 */
export function clearToolClassOverlay(): void {
  toolClassOverlay.clear();
}
```

注意：`toolClassOverlay` Map 声明必须在 `toolClassOf` 之前（模块级 const 提升——TS 会报 used-before-declared，把两个 const 放在 `toolClassOf` 上方即可）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/runtime/tool-classes.test.ts`
Expected: PASS（原 4 组 + 新 overlay 组全绿）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/tool-classes.ts gateway/tests/unit/runtime/tool-classes.test.ts
git commit -m "feat(gateway): tool-classes overlay——runtime 声明优先于并集表，激活期整体替换（spec 2026-10-15 §7）"
```

---

### Task 2: 契约类型收紧 + validate hard ×2 + opencode/pi 实现

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Modify: `gateway/src/runtime/validate.ts`
- Modify: `gateway/src/runtime/opencode-runtime.ts`
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`
- Modify: `gateway/src/runtime/pi/pi-session.ts`
- Test: `gateway/tests/unit/runtime/validate-shape.test.ts`、`gateway/tests/unit/runtime/opencode-runtime.test.ts`、`gateway/tests/unit/runtime/pi-runtime.test.ts`

**Interfaces:**
- Consumes: Task 1 无依赖（本任务自包含）
- Produces: `MafwToolRegistration` / `NativeToolDeclaration` / `RuntimeTools`（contract.ts）；`RuntimeClient.tools`（必选字段）；`PiSessionRegistry.setToolFactory(f)`；`PI_NATIVE_TOOLS` / `OPENCODE_NATIVE_TOOLS`

- [ ] **Step 1: Write the failing tests**

`gateway/tests/unit/runtime/validate-shape.test.ts`——`OK_RT` 返回对象加 `tools`（`...rest` 之前），并在文件末尾追加 describe：

```typescript
// OK_RT 内：
    tools: {
      registerTools: async () => {},
      nativeTools: () => [],
    },
```

```typescript
describe('validateRuntime — tools 通道（Tier-0 必选，无条件 hard）', () => {
  it('tools 缺失 → 两条 hard（registerTools + nativeTools）', () => {
    const rt = OK_RT(); delete (rt as any).tools;
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard.some((i) => i.includes('tools.registerTools'))).toBe(true);
    expect(v.hard.some((i) => i.includes('tools.nativeTools'))).toBe(true);
  });

  it('registerTools 存在但 nativeTools 非函数 → hard', () => {
    const rt = OK_RT({ tools: { registerTools: async () => {} } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard.some((i) => i.includes('tools.nativeTools'))).toBe(true);
  });

  it('nativeTools 存在但 registerTools 非函数 → hard', () => {
    const rt = OK_RT({ tools: { nativeTools: () => [] } });
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard.some((i) => i.includes('tools.registerTools'))).toBe(true);
  });

  it('nativeTools 返回 [] 合法（不算 issue）', () => {
    const rt = OK_RT();
    const v = validateRuntime(rt as any, 'my-rt');
    expect(v.hard).toEqual([]);
  });
});
```

`gateway/tests/unit/runtime/opencode-runtime.test.ts` 末尾追加：

```typescript
describe('opencode-runtime tools 通道（Tier-0 必选）', () => {
  it('registerTools = ack no-op + nativeTools 声明合法条目', async () => {
    const rt = await createOpencodeRuntime({ baseUrl: 'http://127.0.0.1:4096' });
    await expect(rt.tools.registerTools(async () => [])).resolves.toBeUndefined();
    const decls = rt.tools.nativeTools();
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) {
      expect(typeof d.name).toBe('string');
      expect(d.name.length).toBeGreaterThan(0);
      expect(['readonly', 'search', 'file-edit', 'shell', 'subagent', 'web', 'plan', 'other']).toContain(d.toolClass);
    }
    expect(decls.map((d) => d.name)).toEqual(expect.arrayContaining(['read', 'bash', 'edit', 'task']));
  });
});
```

`gateway/tests/unit/runtime/pi-runtime.test.ts` 末尾追加：

```typescript
describe('pi-runtime tools 通道（Tier-0 必选）', () => {
  it('registerTools stash 进 registry + nativeTools 声明 pi 清单', async () => {
    const rt = await createPiRuntime(
      { fetch, log: console, pluginConfig: () => ({}) } as any,
      { loadPi: async () => fakePi },
    );
    const factory = (_sid: string) => [];
    await rt.tools.registerTools(factory);
    expect(((rt as any).registry as any).opts.toolFactory).toBe(factory);
    const decls = rt.tools.nativeTools();
    expect(decls.map((d: any) => d.name).sort()).toEqual(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
    for (const d of decls) {
      expect(['readonly', 'search', 'file-edit', 'shell', 'subagent', 'web', 'plan', 'other']).toContain(d.toolClass);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/runtime/validate-shape.test.ts tests/unit/runtime/opencode-runtime.test.ts tests/unit/runtime/pi-runtime.test.ts`
Expected: FAIL——validate hard 断言失败（tools 未校验）；opencode/pi 的 `rt.tools` undefined

- [ ] **Step 3: Implement contract types**

`gateway/src/runtime/contract.ts`：

3a. 头部 import 加：

```typescript
import type { TOOL_CLASS } from './tool-classes';
```

3b. 文件头注释的 Tier 0 行改为：

```typescript
 *   Tier 0（sessionApi + promptWhileBusy + tools 注册通道）→ 协作协议（Goal/问答/反馈）+ per-turn 记忆
```

3c. `RuntimeCredentials` 接口之后（`RuntimeClient` 之前）插入：

```typescript
// ─── 工具注册通道（Tier-0 必选；spec 2026-10-15） ────────────────────────────

/** MAFW 基础工具注册项：spec（JSON Schema）+ runtime 中性执行器。 */
export interface MafwToolRegistration {
  /** 工具名（如 'mafw_add_memory'）——runtime 原样注册 */
  name: string;
  label?: string;
  description: string;
  /** JSON Schema（object 形态）；runtime 翻译为自家类型系统（pi typebox T.Unsafe / MCP inputSchema / Claude tool use） */
  parameters: Record<string, any>;
  /** 执行器（gateway loopback HTTP 已封装）。isError=true 时 runtime 应向 agent 报工具错误。 */
  execute(params: any, signal?: AbortSignal): Promise<{ text: string; isError?: boolean }>;
}

/** runtime 原生工具声明（激活期注入 tool-classes overlay，优先于并集表）。 */
export interface NativeToolDeclaration {
  name: string;
  toolClass: TOOL_CLASS;
}

/**
 * 工具注册通道——Tier-0 必选，无能力位（无工具通道的 runtime 里 agent 没有
 * 记忆工具，核心闭环断裂；缺实现 = 激活期 hard 校验拒绝，回退内置 runtime）。
 */
export interface RuntimeTools {
  /** 注册 MAFW 基础工具集。factory 按会话惰性调用（python 内核/记忆归因有会话亲和性）；幂等（重复调用替换）。 */
  registerTools(factory: (sessionId: string) => MafwToolRegistration[]): Promise<void>;
  /** runtime 原生工具清单；空数组合法（= 无并集表之外的工具）。 */
  nativeTools(): NativeToolDeclaration[];
}
```

3d. `RuntimeClient` 的 `config` 组之后、`completion?` 之前插入必选字段：

```typescript
  /** 工具注册通道（Tier-0 必选，无能力位——缺 = hard 校验拒绝）。 */
  tools: RuntimeTools;
```

- [ ] **Step 4: Implement validate hard checks**

`gateway/src/runtime/validate.ts`——`providerConfigApi` 块之后、`if (out.hard.length > 0) return out;` 之前插入：

```typescript
  // ── hard：工具注册通道（Tier-0 必选，无条件——非能力门控） ─────────────
  const tools = (rt as any).tools;
  if (!isObject(tools) || !isFn(tools.registerTools)) {
    out.hard.push(`${source}: tools.registerTools is missing (not a function) — MAFW basic tools have no path to your agents (Tier-0 required)`);
  }
  if (!isObject(tools) || !isFn(tools.nativeTools)) {
    out.hard.push(`${source}: tools.nativeTools is missing (not a function; returning [] is valid) — tool classification falls back to the static union table`);
  }
```

- [ ] **Step 5: Implement opencode tools**

`gateway/src/runtime/opencode-runtime.ts`——顶部加 import（与现有 contract 相关 import 合并）：

```typescript
import type { NativeToolDeclaration } from './contract';
```

（检查现有 import：若已有 `from './contract'` 的 import 行则合并进去。）

`createOpencodeRuntime` 函数之前加常量：

```typescript
/** opencode 原生工具清单（tool-classes overlay 声明；调研表 2026-10-13）。 */
const OPENCODE_NATIVE_TOOLS: NativeToolDeclaration[] = [
  { name: 'read', toolClass: 'readonly' },
  { name: 'grep', toolClass: 'search' },
  { name: 'glob', toolClass: 'search' },
  { name: 'list', toolClass: 'search' },
  { name: 'write', toolClass: 'file-edit' },
  { name: 'edit', toolClass: 'file-edit' },
  { name: 'bash', toolClass: 'shell' },
  { name: 'shell', toolClass: 'shell' },
  { name: 'task', toolClass: 'subagent' },
  { name: 'webfetch', toolClass: 'web' },
  { name: 'todowrite', toolClass: 'plan' },
];
```

`rt.agents = {...}` 赋值之后加：

```typescript
  // 工具注册通道（Tier-0 必选）：六件套由 v1 宿主插件承载（plugin-native 工具）
  // + MCP 面由自接线覆盖——通道已存在，spec 推送 = 通道确认（no-op ack）。
  rt.tools = {
    async registerTools() {
      log.info('[opencode-runtime] tools.registerTools ack — six-piece hosted by v1 plugin, MCP face via self-wiring');
    },
    nativeTools() { return OPENCODE_NATIVE_TOOLS; },
  };
```

（确认 `log` 已在该文件 import——line 299 已用 `log.info`，无需加。）

- [ ] **Step 6: Implement pi tools（stash 最小实现）**

`gateway/src/runtime/pi/pi-session.ts`：

6a. 顶部加 import（现有 contract import 行若无则新增）：

```typescript
import type { MafwToolRegistration } from '../contract';
```

6b. `PiSessionRegistryOptions` 加字段（`getType` 之后）：

```typescript
  /** MAFW 基础工具 factory（runtime tools.registerTools 注入；host extension 按会话消费） */
  toolFactory?: (sessionId: string) => MafwToolRegistration[];
```

6c. `PiSessionRegistry` 类内加方法（`create` 之前）：

```typescript
  setToolFactory(f: (sessionId: string) => MafwToolRegistration[]): void {
    this.opts = { ...this.opts, toolFactory: f };
  }
```

`gateway/src/runtime/plugins/pi-runtime.ts`：

6d. 顶部 contract import 合并类型：

```typescript
import type { AgentRuntime, RuntimeCapabilities, CompletionRequest, CompletionResult, NativeToolDeclaration, MafwToolRegistration } from '../contract';
```

6e. `PI_CAPABILITIES` 之后加常量：

```typescript
/** pi 原生工具清单（pi-coding-agent dist/core/tools：read/grep/find/ls/write/edit/bash）。 */
const PI_NATIVE_TOOLS: NativeToolDeclaration[] = [
  { name: 'read', toolClass: 'readonly' },
  { name: 'grep', toolClass: 'search' },
  { name: 'find', toolClass: 'search' },
  { name: 'ls', toolClass: 'search' },
  { name: 'write', toolClass: 'file-edit' },
  { name: 'edit', toolClass: 'file-edit' },
  { name: 'bash', toolClass: 'shell' },
];
```

6f. 返回对象 `registry,` 之后加：

```typescript
    tools: {
      registerTools: async (factory: (sessionId: string) => MafwToolRegistration[]) => {
        registry.setToolFactory(factory);
      },
      nativeTools: () => PI_NATIVE_TOOLS,
    },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest tests/unit/runtime/validate-shape.test.ts tests/unit/runtime/opencode-runtime.test.ts tests/unit/runtime/pi-runtime.test.ts`
Expected: PASS 全部

- [ ] **Step 8: 类型收紧波及面检查**

Run: `npx tsc --noEmit -p tsconfig.json`（在 gateway/ 下）
Expected: 若有其它文件因 `RuntimeClient.tools` 必选而报错（mock/测试构造），给对应对象补 `tools: { registerTools: async () => {}, nativeTools: () => [] }` stub 修复。生产代码实现均已在本任务提供，不应有其它报错。

- [ ] **Step 9: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/validate.ts gateway/src/runtime/opencode-runtime.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/src/runtime/pi/pi-session.ts gateway/tests/unit/runtime/
git commit -m "feat(gateway): 契约必选 tools 通道——registerTools/nativeTools 进 Tier-0 hard 校验，opencode(ack+清单)/pi(registry stash+清单) 达标（spec 2026-10-15 §4）"
```

---

### Task 3: mafw-tools 单源模块（六件套 spec + execute + 激活助手）

**Files:**
- Create: `gateway/src/runtime/mafw-tools.ts`
- Test: `gateway/tests/unit/runtime/mafw-tools.test.ts`（新）

**Interfaces:**
- Consumes: `MafwToolRegistration` / `AgentRuntime`（contract.ts，Task 2）；`hashText` / `postToolJson` / `a2aRequest` / `taskAnswer` / `makeMediaPointer` / `mediaDataFromSource`（host-adapter.ts）；`setToolClassOverlay` / `clearToolClassOverlay`（tool-classes.ts，Task 1）
- Produces: `MafwToolSpec`；`MAFW_TOOL_SPECS: MafwToolSpec[]`；`buildMafwToolFactory(opts: { baseUrl: string; fetchImpl?: typeof fetch }): (sessionId: string) => MafwToolRegistration[]`；`activateRuntimeTools(rt: AgentRuntime, source: string, opts: { baseUrl: string }, logger?): Promise<void>`

- [ ] **Step 1: Write the failing test**

`gateway/tests/unit/runtime/mafw-tools.test.ts`（新文件）：

```typescript
import {
  MAFW_TOOL_SPECS, buildMafwToolFactory, activateRuntimeTools,
} from '../../../src/runtime/mafw-tools';
import { toolClassOf, clearToolClassOverlay } from '../../../src/runtime/tool-classes';
import { hashText } from '../../../src/runtime/host-adapter';
import type { AgentRuntime } from '../../../src/runtime/contract';

type Req = { url: string; method: string; body?: any };
type Res = { ok: boolean; json?: any };

function makeFakeFetch(routes: Array<{ match: (r: Req) => boolean; res: Res }>) {
  const calls: Req[] = [];
  const fetchImpl: any = async (url: string, init?: any) => {
    const req: Req = { url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(req);
    const hit = routes.find((r) => r.match(req));
    if (!hit) throw new Error(`no route for ${req.method} ${req.url}`);
    return { ok: hit.res.ok, json: async () => hit.res.json };
  };
  return { calls, fetchImpl };
}

const SIX = ['mafw_add_memory', 'mafw_media_ask', 'mafw_media_speak', 'mafw_media_upload', 'mafw_python', 'mafw_python_restart'];

describe('MAFW_TOOL_SPECS（六件套静态清单）', () => {
  it('6 条、名字唯一、parameters 为 object 形状 JSON Schema', () => {
    expect(MAFW_TOOL_SPECS.map((s) => s.name).sort()).toEqual([...SIX].sort());
    expect(new Set(MAFW_TOOL_SPECS.map((s) => s.name)).size).toBe(6);
    for (const s of MAFW_TOOL_SPECS) {
      expect((s.parameters as any).type).toBe('object');
      expect(typeof (s.parameters as any).properties).toBe('object');
      expect(s.description.length).toBeGreaterThan(10);
    }
  });
});

describe('buildMafwToolFactory（会话亲和闭包）', () => {
  it('factory(sid) 产 6 个注册项；add_memory POST body 携带 sessionID', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/memory/add'), res: { ok: true, json: { success: true, id: 'mem_1' } } },
    ]);
    const regs = buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('pi_s9');
    expect(regs.map((r) => r.name).sort()).toEqual([...SIX].sort());
    const add = regs.find((r) => r.name === 'mafw_add_memory')!;
    const out = await add.execute({ content: '测试', cueAnchors: ['a'] });
    expect(out.isError).toBeUndefined();
    expect(out.text).toContain('mem_1');
    expect(calls[0].body).toMatchObject({ content: '测试', sessionID: 'pi_s9', cueAnchors: ['a'] });
  });

  it('add_memory 失败 → isError + 错误文本', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/memory/add'), res: { ok: false, json: { error: 'bad' } } },
    ]);
    const regs = buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1');
    const out = await regs.find((r) => r.name === 'mafw_add_memory')!.execute({ content: 'x' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('记忆写入失败');
  });

  it('python 输出文本化（stdout/kernelRestarted/图片数）；错误带 traceback 尾部', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/python/execute'), res: { ok: true, json: { status: 'ok', stdout: '42', kernelRestarted: true, attachments: [{}] } } },
    ]);
    const regs = buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1');
    const out = await regs.find((r) => r.name === 'mafw_python')!.execute({ code: 'print(42)' });
    expect(out.text).toContain('42');
    expect(out.text).toContain('python_kernel_reset');
    expect(out.text).toContain('1 张图片');

    const { fetchImpl: f2 } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/python/execute'), res: { ok: true, json: { status: 'error', error: { ename: 'ValueError', evalue: 'boom', traceback: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'] } } } },
    ]);
    const out2 = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl: f2 })('s1')
      .find((r) => r.name === 'mafw_python')!.execute({ code: 'x' });
    expect(out2.isError).toBe(true);
    expect(out2.text).toContain('ValueError: boom');
    expect(out2.text).toContain('l8');
    expect(out2.text).not.toContain('l1');
  });

  it('python 内核不可达 → isError 提示 mafw_python_restart', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/python/execute'), res: { ok: false, json: {} } },
    ]);
    const out = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1')
      .find((r) => r.name === 'mafw_python')!.execute({ code: 'x' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('mafw_python_restart');
  });

  it('media_speak → 带 djb2 hash 的语音标记', async () => {
    const { fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/api/tts'), res: { ok: true, json: { artifactId: 'art_9', voice: '茉莉' } } },
    ]);
    const out = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1')
      .find((r) => r.name === 'mafw_media_speak')!.execute({ text: '你好' });
    expect(out.text).toBe(`[语音回复 art:art_9 音色:茉莉 h:${hashText('你好')}]`);
  });

  it('media_ask taskID 链：GetTask → SendMessage(referenceTaskIds+contextId)', async () => {
    const { calls, fetchImpl } = makeFakeFetch([
      { match: (r) => r.url.includes('/a2a') && r.body?.method === 'GetTask', res: { ok: true, json: { result: { task: { id: 't1', contextId: 'ctx1' } } } } },
      { match: (r) => r.url.includes('/a2a') && r.body?.method === 'SendMessage', res: { ok: true, json: { result: { task: { id: 't2', status: { state: 'TASK_STATE_COMPLETED', message: { parts: [{ text: '图里有只猫' }] } } } } } } },
    ]);
    const out = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1')
      .find((r) => r.name === 'mafw_media_ask')!.execute({ taskID: 't1', question: '图里有什么' });
    expect(out.text).toContain('图里有只猫');
    expect(out.text).toContain('t2');
    const send = calls.find((c) => c.body?.method === 'SendMessage');
    expect(send.body.params.message.referenceTaskIds).toEqual(['t1']);
    expect(send.body.params.message.contextId).toBe('ctx1');
  });

  it('media_ask 缺参数 → isError', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const out = await buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl })('s1')
      .find((r) => r.name === 'mafw_media_ask')!.execute({ question: 'q' });
    expect(out.isError).toBe(true);
    expect(out.text).toContain('taskID');
  });
});

describe('activateRuntimeTools（激活期接线）', () => {
  afterEach(() => clearToolClassOverlay());

  function makeRt(over: any = {}): AgentRuntime {
    return {
      name: 'rt',
      tools: {
        registerTools: jest.fn(async () => {}),
        nativeTools: jest.fn(() => [{ name: 'my_read', toolClass: 'readonly' }, { name: 'bad', toolClass: 'nonsense' }, { name: '', toolClass: 'web' }]),
        ...over,
      },
    } as any;
  }

  it('registerTools 收到可执行 factory；nativeTools 好条目进 overlay、坏条目跳过', async () => {
    const rt = makeRt();
    await activateRuntimeTools(rt, 'test:rt', { baseUrl: 'http://gw' });
    const factory = (rt.tools.registerTools as jest.Mock).mock.calls[0][0] as (sid: string) => any[];
    expect(factory('s1').map((r) => r.name).sort()).toEqual([...SIX].sort());
    expect(toolClassOf('my_read')).toBe('readonly');
    expect(toolClassOf('bad')).toBe('other');
  });

  it('registerTools 抛错 → 不阻断（fail-open）；nativeTools 抛错 → 清 overlay', async () => {
    const rt = makeRt({ registerTools: jest.fn(async () => { throw new Error('nope'); }) });
    await expect(activateRuntimeTools(rt, 'test:rt', { baseUrl: 'http://gw' })).resolves.toBeUndefined();
    const rt2 = makeRt({ nativeTools: jest.fn(() => { throw new Error('boom'); }) });
    await activateRuntimeTools(rt2, 'test:rt2', { baseUrl: 'http://gw' });
    expect(toolClassOf('my_read')).toBe('other');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/runtime/mafw-tools.test.ts`
Expected: FAIL——模块不存在（Cannot find module）

- [ ] **Step 3: Write the implementation**

`gateway/src/runtime/mafw-tools.ts`（新文件）——六件套 description 与 `pi-mafw-host-extension.ts` 现行文本逐字一致，执行逻辑逐字迁移（`ok`/`fail` 形状改为 `{text}`/`{text,isError}`）：

```typescript
/**
 * MAFW 基础工具集（六件套）——spec 与执行逻辑的 gateway 单一来源。
 *
 * 契约（contract.ts RuntimeTools.registerTools）在激活期把 factory 推给
 * runtime；runtime 只做 plumbing：按会话取 registrations、把 parameters
 * 翻译为自家类型系统（pi typebox T.Unsafe / MCP inputSchema）、把 execute
 * 接到工具调用面。执行 = gateway loopback HTTP（/api/memory/add、
 * /api/python/*、/api/tts、/a2a——HostAdapter 工具动词）。
 *
 * v1 opencode 插件（src/tools/）不经此模块（生产宿主，v2 迁移统一）。
 * spec：docs/superpowers/specs/2026-10-15-runtime-tool-registration-contract-design.md
 */
import { randomUUID } from 'crypto';
import type { AgentRuntime, MafwToolRegistration } from './contract';
import {
  hashText, postToolJson, a2aRequest, taskAnswer, makeMediaPointer, mediaDataFromSource,
} from './host-adapter';
import { setToolClassOverlay, clearToolClassOverlay } from './tool-classes';
import { log } from '../core/utils/logger';

export interface MafwToolSpec {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, any>;
}

const ok = (text: string): { text: string } => ({ text });
const fail = (text: string): { text: string; isError: boolean } => ({ text, isError: true });

interface ExecuteCtx { sessionId: string; f: typeof fetch; base: string }

interface ToolDef {
  spec: MafwToolSpec;
  makeExecute(ctx: ExecuteCtx): (params: any, signal?: AbortSignal) => Promise<{ text: string; isError?: boolean }>;
}

const TOOL_DEFS: ToolDef[] = [
  {
    spec: {
      name: 'mafw_add_memory',
      label: 'MAFW 记忆写入',
      description: '保存一条记忆到谐波记忆系统（跨会话存续的事实/决定/偏好/教训/模式）。一次一条，附 cueAnchors 检索关键词；memoryType: semantic=事实/偏好/约束, episodic=叙事, procedural=教训/模式, global=跨项目。逐字保留标识符进 cueAnchors。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '记忆内容（一句话）' },
          memoryType: { type: 'string', enum: ['semantic', 'episodic', 'procedural', 'global'] },
          cueAnchors: { type: 'array', items: { type: 'string', description: '检索关键词（≤8）' } },
          primaryAbstraction: { type: 'string', description: '6-8 词摘要（缺省自动生成）' },
          importance: { type: 'number', description: '重要性 1-10' },
        },
        required: ['content'],
      },
    },
    makeExecute({ sessionId: sid, f, base }) {
      return async (params, signal) => {
        const r = await postToolJson(f, base, '/api/memory/add', {
          content: params.content,
          memoryType: params.memoryType || 'semantic',
          cueAnchors: params.cueAnchors || [],
          primaryAbstraction: params.primaryAbstraction,
          importance: params.importance,
          sessionID: sid,
        }, 10_000, signal);
        return r.ok ? ok(`记忆已保存：${r.body?.id ?? ''}`) : fail(`记忆写入失败：${r.text ?? ''} ${JSON.stringify(r.body ?? {})}`);
      };
    },
  },
  {
    spec: {
      name: 'mafw_python',
      label: 'MAFW Python 内核',
      description: '在会话的持久 Python 内核中执行代码（变量/导入跨调用保持）。数据分析/统计/科学计算/多步计算优先用本工具。matplotlib 图表作为图片附件返回（输出中标注数量）。',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: '要执行的 Python 代码' } },
        required: ['code'],
      },
    },
    makeExecute({ sessionId: sid, f, base }) {
      return async (params, signal) => {
        const r = await postToolJson(f, base, '/api/python/execute', { sessionID: sid, code: params.code }, 180_000, signal);
        if (!r.ok) return fail(`内核不可用：${r.text ?? ''}（可用 mafw_python_restart 重启）`);
        const j = r.body ?? {};
        if (j.status === 'error' && j.error) {
          const tb = Array.isArray(j.error.traceback) ? j.error.traceback.join('\n').split('\n').slice(-6).join('\n') : '';
          return fail(`代码执行出错：${j.error.ename}: ${j.error.evalue}\n${tb}\n（内核状态保留，可修改后重试）`);
        }
        const parts: string[] = [];
        if (j.kernelRestarted) parts.push('<python_kernel_reset> 内核已重启，之前的变量/导入已丢失。</python_kernel_reset>');
        if (j.stdout) parts.push(j.stdout);
        if (j.result) parts.push(j.result);
        if (j.stderr) parts.push(`stderr:\n${j.stderr}`);
        if (j.truncated) parts.push('...(输出已截断)');
        if (Array.isArray(j.attachments) && j.attachments.length) parts.push(`[生成 ${j.attachments.length} 张图片]`);
        return ok(parts.join('\n') || '(无输出)');
      };
    },
  },
  {
    spec: {
      name: 'mafw_python_restart',
      label: 'MAFW Python 内核重启',
      description: '重启会话的持久 Python 内核（内核崩溃或内存泄漏时调用；重启后变量丢失）。',
      parameters: { type: 'object', properties: {} },
    },
    makeExecute({ sessionId: sid, f, base }) {
      return async (_params, signal) => {
        const r = await postToolJson(f, base, '/api/python/restart', { sessionID: sid }, 60_000, signal);
        return r.ok ? ok('内核已重启') : fail(`重启失败：${r.text ?? ''}`);
      };
    },
  },
  {
    spec: {
      name: 'mafw_media_speak',
      label: 'MAFW 语音合成',
      description: '将文本合成为语音。用户通过语音消息输入时必须调用本工具以语音回复。返回 [语音回复 art:... 音色:... h:...] 标记，必须原样包含在回复文本中（h 为文本指纹，桌面端用于流式去重）。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要合成的文本（≤2000 字符）' },
          voice: { type: 'string', description: '音色：冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean（默认茉莉）' },
          style: { type: 'string', description: '发音风格指令' },
        },
        required: ['text'],
      },
    },
    makeExecute({ f, base }) {
      return async (params, signal) => {
        const r = await postToolJson(f, base, '/api/tts', { text: params.text, voice: params.voice, style: params.style }, 130_000, signal);
        if (!r.ok || !r.body?.artifactId) return fail(`语音合成失败：${r.text ?? ''}`);
        const voice = r.body.voice || params.voice || '默认';
        return ok(`[语音回复 art:${r.body.artifactId} 音色:${voice} h:${hashText(params.text)}]`);
      };
    },
  },
  {
    spec: {
      name: 'mafw_media_upload',
      label: 'MAFW 媒体上传',
      description: '上传本地图片/视频/音频到 Media Agent 并返回引用指针；之后用返回的 taskID 经 mafw_media_ask 多轮追问。mediaPath 为本地绝对路径。',
      parameters: {
        type: 'object',
        properties: {
          mediaPath: { type: 'string', description: '本地媒体文件绝对路径' },
          question: { type: 'string', description: '可选的首个问题' },
        },
        required: ['mediaPath'],
      },
    },
    makeExecute({ f, base }) {
      return async (params, signal) => {
        try {
          const media = mediaDataFromSource(params.mediaPath);
          if (!media) return fail(`不支持的媒体格式或文件不存在：${params.mediaPath}`);
          const result = await a2aRequest(f, base, 'SendMessage', {
            message: {
              messageId: `upload-${randomUUID()}`,
              role: 1,
              parts: [
                { raw: media.data, mediaType: media.mediaType, filename: media.filename },
                ...(params.question ? [{ text: params.question }] : []),
              ],
            },
          }, signal);
          const task = result?.task;
          if (!task?.id) return fail('gateway 未返回任务');
          const answer = taskAnswer(task);
          if (task?.status?.state === 'TASK_STATE_FAILED') return fail(answer || 'Media Agent 分析失败');
          return ok(makeMediaPointer(task.id, task.contextId, media.filename) + (answer ? `\n首个问题回答：${answer}` : ''));
        } catch (err: any) { return fail(`媒体上传失败：${err?.message ?? err}`); }
      };
    },
  },
  {
    spec: {
      name: 'mafw_media_ask',
      label: 'MAFW 媒体追问',
      description: '分析或追问图片/视频/音频。会话里有 [媒体附件 taskID: xxx] 指针时传 taskID；只有本地文件路径时传 mediaPath（自动上传后追问）。返回分析文本 + 新 taskID（追问用新 ID，媒体不重传）。',
      parameters: {
        type: 'object',
        properties: {
          taskID: { type: 'string', description: '从 [媒体附件 taskID: xxx] 指针提取（与 mediaPath 二选一）' },
          mediaPath: { type: 'string', description: '本地媒体文件绝对路径（与 taskID 二选一）' },
          question: { type: 'string', description: '要问这个媒体的具体问题' },
        },
        required: ['question'],
      },
    },
    makeExecute({ f, base }) {
      return async (params, signal) => {
        try {
          let activeTaskID = params.taskID;
          let activeContextId: string | undefined;
          if (activeTaskID) {
            const task = await a2aRequest(f, base, 'GetTask', { id: activeTaskID }, signal);
            activeContextId = task?.task?.contextId ?? task?.contextId;
            if (!activeContextId) return fail(`任务 ${activeTaskID} 不存在或已被清理，请重新上传媒体。`);
          } else if (params.mediaPath) {
            const media = mediaDataFromSource(params.mediaPath);
            if (!media) return fail(`不支持的媒体格式或文件不存在：${params.mediaPath}`);
            const created = await a2aRequest(f, base, 'SendMessage', {
              message: {
                messageId: `ask-${randomUUID()}`,
                role: 1,
                parts: [{ raw: media.data, mediaType: media.mediaType, filename: media.filename }, { text: params.question }],
              },
            }, signal);
            const t = created?.task;
            if (!t?.id) return fail('gateway 未返回任务');
            activeTaskID = t.id;
            activeContextId = t.contextId;
            if (t?.status?.state === 'TASK_STATE_COMPLETED') {
              const answer = taskAnswer(t);
              if (answer) return ok(`${answer}\n（新任务 taskID: ${t.id}，继续追问请用新 taskID）`);
            }
          } else {
            return fail('缺少参数：请提供 taskID（媒体附件指针）或 mediaPath（媒体文件路径）。');
          }
          const result = await a2aRequest(f, base, 'SendMessage', {
            message: {
              messageId: `ask-${randomUUID()}`,
              role: 1,
              contextId: activeContextId,
              referenceTaskIds: [activeTaskID],
              parts: [{ text: params.question }],
            },
          }, signal);
          const t = result?.task;
          const answer = taskAnswer(t);
          if (t?.status?.state === 'TASK_STATE_FAILED') return fail(answer || 'Media Agent 分析失败');
          if (!answer) return fail('Media Agent 未返回描述，请稍后重试。');
          return ok(`${answer}\n（新任务 taskID: ${t?.id}，继续追问请用新 taskID）`);
        } catch (err: any) { return fail(`Media Agent 调用失败：${err?.message ?? err}`); }
      };
    },
  },
];

export const MAFW_TOOL_SPECS: MafwToolSpec[] = TOOL_DEFS.map((d) => d.spec);

export function buildMafwToolFactory(opts: { baseUrl: string; fetchImpl?: typeof fetch }): (sessionId: string) => MafwToolRegistration[] {
  const f = (opts.fetchImpl ?? fetch) as typeof fetch;
  const base = opts.baseUrl;
  return (sessionId: string) => TOOL_DEFS.map((d) => ({ ...d.spec, execute: d.makeExecute({ sessionId, f, base }) }));
}

/**
 * 激活期工具接线（index.ts createRuntime 三分支调用）：推送六件套 factory +
 * nativeTools 声明进 tool-classes overlay。fail-open——任一步失败不阻断激活
 * （registerTools 失败 = 该 runtime 工具面缺失但不换 runtime；nativeTools
 * 失败 = overlay 清空回落并集表）。
 */
export async function activateRuntimeTools(
  rt: AgentRuntime,
  source: string,
  opts: { baseUrl: string },
  logger: { info(m: string): void; warn(m: string): void } = log,
): Promise<void> {
  try {
    await rt.tools.registerTools(buildMafwToolFactory({ baseUrl: opts.baseUrl }));
  } catch (err: any) {
    logger.warn(`[RuntimeTools] '${rt.name}' registerTools failed (non-fatal): ${err?.message ?? err}`);
  }
  try {
    const decls = rt.tools.nativeTools();
    const { applied, invalid } = setToolClassOverlay(Array.isArray(decls) ? decls : []);
    if (invalid.length) logger.warn(`[RuntimeTools] ${source}: nativeTools invalid entries skipped: ${invalid.join(', ')}`);
    if (applied > 0) logger.info(`[RuntimeTools] ${source}: tool-class overlay applied (${applied} entries)`);
  } catch (err: any) {
    clearToolClassOverlay();
    logger.warn(`[RuntimeTools] ${source}: nativeTools failed (overlay cleared): ${err?.message ?? err}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/runtime/mafw-tools.test.ts`
Expected: PASS 全部

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/mafw-tools.ts gateway/tests/unit/runtime/mafw-tools.test.ts
git commit -m "feat(gateway): mafw-tools 六件套单源——spec/execute 从 pi extension 上移为 runtime 中性 factory + activateRuntimeTools 激活助手（spec 2026-10-15 §5）"
```

---

### Task 4: index.ts 激活接线

**Files:**
- Modify: `gateway/src/index.ts`（createRuntime 三分支）

**Interfaces:**
- Consumes: `activateRuntimeTools`（Task 3）
- Produces: 无新接口（行为：激活期推送 factory + overlay）

- [ ] **Step 1: Add import**

`gateway/src/index.ts` 顶部 import 区（与其它 `./runtime/` import 相邻处）加：

```typescript
import { activateRuntimeTools } from './runtime/mafw-tools';
```

- [ ] **Step 2: Wire three branches in createRuntime**

2a. **插件分支**（`this.applyRuntimeValidation(rt, pluginName, true);` 之后、`wrapGlobalEventStream(rt, plugin, ...)` 之前）插入：

```typescript
          // 工具注册通道接线（Tier-0）：推送六件套 factory + nativeTools → 类别 overlay
          await activateRuntimeTools(rt, pluginName, { baseUrl: `http://127.0.0.1:${config.server.apiPort}` });
```

2b. **内置分支**（`this.applyRuntimeValidation(rt, 'builtin:opencode', false);` 之后、`wrapGlobalEventStream` 之前）插入：

```typescript
      await activateRuntimeTools(rt, 'builtin:opencode', { baseUrl: `http://127.0.0.1:${config.server.apiPort}` });
```

2c. **兜底分支**（`this.applyRuntimeValidation(fallbackRt, 'builtin:opencode(direct)', false);` 之后）插入：

```typescript
    await activateRuntimeTools(fallbackRt, 'builtin:opencode(direct)', { baseUrl: `http://127.0.0.1:${config.server.apiPort}` });
```

（`config` 已在该文件 import。时序保证：createRuntime 完成先于任何会话创建，pi 侧 stash 无竞态。）

- [ ] **Step 3: Run regression**

Run: `npx jest tests/unit/runtime/ tests/unit/runtime-switch.test.ts`
Expected: PASS（接线为纯增量；activateRuntimeTools 自身在 Task 3 已单测覆盖）

- [ ] **Step 4: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(gateway): createRuntime 三分支接 activateRuntimeTools——激活期推送六件套 factory + nativeTools 类别 overlay（spec 2026-10-15 §4）"
```

---

### Task 5: pi 切换 factory 消费（extension 瘦身）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-session.ts`（create + fork 两处流转 toolFactory）
- Modify: `gateway/src/runtime/pi/pi-mafw-host-extension.ts`（删 registerMafwTools，换 registerFactoryTools）
- Test: `gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts`（tools describe 重写）

**Interfaces:**
- Consumes: `MafwToolRegistration`（contract）；`PiSessionRegistryOptions.toolFactory` / `setToolFactory`（Task 2）
- Produces: `MafwHostDeps.toolFactory?: (sessionId: string) => MafwToolRegistration[]`

- [ ] **Step 1: Rewrite the tools tests（先红）**

`gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts`——把现有 `const FakeType: any = {...}` 块和 `describe('pi-mafw-host tools', ...)` 整体替换为：

```typescript
import { buildMafwToolFactory } from '../../../src/runtime/mafw-tools';

const FakeType: any = {
  // 忠实模拟 typebox 1.3.7 Unsafe：Clone + ~unsafe 为 non-enumerable（不入 JSON 序列化）
  Unsafe: (s: any) => {
    const c: any = { ...s };
    Object.defineProperty(c, '~unsafe', { value: null, enumerable: false });
    return c;
  },
};

describe('pi-mafw-host tools（gateway 单源 factory 消费）', () => {
  it('注册 6 个工具——toolFactory 接 buildMafwToolFactory（端到端）', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const { pi, tools } = makeFakePi();
    createMafwHostExtension({
      sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType,
      toolFactory: buildMafwToolFactory({ baseUrl: 'http://gw', fetchImpl }),
    }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'mafw_add_memory', 'mafw_media_ask', 'mafw_media_speak', 'mafw_media_upload', 'mafw_python', 'mafw_python_restart',
    ]);
  });

  it('parameters 经 T.Unsafe 包装：JSON 序列化与原 spec 逐字一致且不含 ~unsafe', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const { pi, tools } = makeFakePi();
    const factory = (sid: string) => [{
      name: 'mafw_x', label: 'L', description: `D@${sid}`,
      parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      execute: async () => ({ text: 'ok' }),
    }];
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType, toolFactory: factory }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(tools).toHaveLength(1);
    expect(JSON.stringify(tools[0].parameters)).toBe(JSON.stringify(factory('x')[0].parameters));
    expect(JSON.stringify(tools[0].parameters)).not.toContain('~unsafe');
  });

  it('execute 桥接：{text} → pi ToolResult；isError → isError: true', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const { pi, tools } = makeFakePi();
    const factory = (sid: string) => [
      { name: 't_ok', description: 'd', parameters: { type: 'object', properties: {} }, execute: async (p: any) => ({ text: `ran@${sid}:${p.x}` }) },
      { name: 't_err', description: 'd', parameters: { type: 'object', properties: {} }, execute: async () => ({ text: 'boom', isError: true }) },
    ];
    createMafwHostExtension({ sessionId: 'pi_s2', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType, toolFactory: factory }).on(pi);
    await new Promise((r) => setTimeout(r, 10));
    const okOut = await tools.find((t: any) => t.name === 't_ok').execute('c', { x: 1 }, undefined as any);
    expect(okOut.content[0].text).toBe('ran@pi_s2:1');
    expect(okOut.isError).toBeUndefined();
    const errOut = await tools.find((t: any) => t.name === 't_err').execute('c', {}, undefined as any);
    expect(errOut.content[0].text).toBe('boom');
    expect(errOut.isError).toBe(true);
  });

  it('无 toolFactory → 不注册；getType 失败 → 同样跳过（fail-open）', async () => {
    const { fetchImpl } = makeFakeFetch([]);
    const a = makeFakePi();
    createMafwHostExtension({ sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl, getType: async () => FakeType }).on(a.pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(a.tools).toHaveLength(0);
    const b = makeFakePi();
    createMafwHostExtension({
      sessionId: 'pi_s1', baseUrl: 'http://gw', fetchImpl,
      getType: async () => { throw new Error('no typebox'); },
      toolFactory: () => [{ name: 't', description: 'd', parameters: {}, execute: async () => ({ text: '' }) }],
    }).on(b.pi);
    await new Promise((r) => setTimeout(r, 10));
    expect(b.tools).toHaveLength(0);
  });
});
```

（原 tools describe 中 add_memory/python/media_speak/media_ask 的行为断言已在 Task 3 `mafw-tools.test.ts` 覆盖——删除，不迁移。）

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/runtime/pi-mafw-host-extension.test.ts`
Expected: FAIL——`MafwHostDeps` 无 `toolFactory`（TS 报错）/ 注册 0 工具

- [ ] **Step 3: Implement extension rewrite**

3a. `gateway/src/runtime/pi/pi-mafw-host-extension.ts`：

imports 改为（删 `randomUUID`、`hashText`、`mediaDataFromSource`、`a2aRequest`、`taskAnswer`、`makeMediaPointer`、`postToolJson`；加 contract 类型）：

```typescript
import {
  MEMORY_GUIDE, contentToText, buildRecallQuery,
  createCognitionClient, createRecallCursor,
} from '../host-adapter';
import type { MafwToolRegistration } from '../contract';
```

`MafwHostDeps` 加字段：

```typescript
  /** MAFW 基础工具 factory（runtime tools.registerTools 注入；gateway 单源） */
  toolFactory?: (sessionId: string) => MafwToolRegistration[];
```

`on(pi)` 的 tools 段替换为：

```typescript
      // === tools：六件套（gateway 单源 factory；T.Unsafe 包 JSON Schema——Clone 产生
      //     新对象且 ~unsafe 键 non-enumerable 不入 wire；typebox 不可达 fail-open 跳过） ===
      void registerFactoryTools(pi, deps).catch(() => { /* 工具面缺失不阻塞会话 */ });
```

`registerMafwTools` 函数整体删除，替换为：

```typescript
async function registerFactoryTools(pi: any, deps: MafwHostDeps): Promise<void> {
  const T = await (deps.getType ? deps.getType() : Promise.resolve(null));
  if (!T) return; // typebox 不可达 → fail-open 跳过注册
  const registrations = deps.toolFactory ? deps.toolFactory(deps.sessionId) : [];
  for (const r of registrations) {
    pi.registerTool({
      name: r.name,
      label: r.label,
      description: r.description,
      parameters: T.Unsafe(r.parameters),
      async execute(_id: string, params: any, signal: AbortSignal) {
        const out = await r.execute(params, signal);
        return out.isError
          ? { content: [{ type: 'text', text: out.text }], details: {}, isError: true }
          : { content: [{ type: 'text', text: out.text }], details: {} };
      },
    });
  }
}
```

文件头注释 tools 行同步：`injectSystem→before_agent_start；tools→registerTool ×6（gateway 单源 factory）`。

3b. `gateway/src/runtime/pi/pi-session.ts`——`create()` 内 host extension 构造（~line 70）改为：

```typescript
    const hostExtension = this.opts.hostBaseUrl
      ? createMafwHostExtension({ sessionId: id, baseUrl: this.opts.hostBaseUrl, getType: this.opts.getType, toolFactory: this.opts.toolFactory })
      : null;
```

`fork()` 内（~line 304）同样加 `toolFactory: this.opts.toolFactory`：

```typescript
    const forkHostExtension = this.opts.hostBaseUrl
      ? createMafwHostExtension({ sessionId: newId, baseUrl: this.opts.hostBaseUrl, getType: this.opts.getType, toolFactory: this.opts.toolFactory })
      : null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/runtime/pi-mafw-host-extension.test.ts tests/unit/runtime/pi-session.test.ts tests/unit/runtime/pi-runtime.test.ts`
Expected: PASS 全部

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pi/pi-mafw-host-extension.ts gateway/src/runtime/pi/pi-session.ts gateway/tests/unit/runtime/pi-mafw-host-extension.test.ts
git commit -m "refactor(gateway): pi host extension 切换 gateway 单源 factory——T.Unsafe 包 JSON Schema（~unsafe non-enumerable 不入 wire），270→~120 行，六件套 spec/执行收敛 mafw-tools（spec 2026-10-15 §6）"
```

---

### Task 6: /api/tools HTTP 通道

**Files:**
- Create: `gateway/src/routes/tools.ts`
- Modify: `gateway/src/index.ts`（python 路由后挂载）
- Test: `gateway/tests/unit/routes/tools.test.ts`（新）

**Interfaces:**
- Consumes: `MAFW_TOOL_SPECS` / `buildMafwToolFactory`（Task 3）；`MafwToolRegistration`（contract）
- Produces: `handleToolsList(res: http.ServerResponse): void`；`handleToolsExecute(req, res, deps: { buildFactory: () => (sessionId: string) => MafwToolRegistration[] }): Promise<void>`

- [ ] **Step 1: Write the failing test**

`gateway/tests/unit/routes/tools.test.ts`（新文件）：

```typescript
import * as http from 'http';
import { handleToolsList, handleToolsExecute } from '../../../src/routes/tools';

function fakeRes(): { res: http.ServerResponse; status: () => number; body: () => string } {
  const res = {} as unknown as http.ServerResponse;
  let status = 0;
  let payload = '';
  (res as any).writeHead = (s: number) => { status = s; return res; };
  (res as any).end = (b: string) => { payload = b ?? ''; return res; };
  return { res, status, body: () => payload };
}

function fakeReq(body: any): http.IncomingMessage {
  const req = {} as unknown as http.IncomingMessage;
  const json = JSON.stringify(body);
  (req as any).on = (ev: string, cb: (d?: string) => void) => {
    if (ev === 'data') { if (json) cb(json); }
    if (ev === 'end') cb();
    return req;
  };
  return req;
}

describe('GET /api/tools（spec 清单）', () => {
  it('返回六件套 spec（无 execute）', () => {
    const { res, status, body } = fakeRes();
    handleToolsList(res);
    expect(status()).toBe(200);
    const parsed = JSON.parse(body());
    expect(parsed.tools).toHaveLength(6);
    for (const t of parsed.tools) {
      expect(t.execute).toBeUndefined();
      expect(t.parameters.type).toBe('object');
    }
  });
});

describe('POST /api/tools/execute（通用执行）', () => {
  const deps = {
    buildFactory: () => (sid: string) => [
      { name: 'mafw_echo', description: 'd', parameters: { type: 'object', properties: {} }, execute: async (p: any) => ({ text: `${sid}:${p.x ?? ''}` }) },
    ] as any[],
  };

  it('按名分发 + sessionID 亲和', async () => {
    const { res, status, body } = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'mafw_echo', params: { x: 'v' }, sessionID: 's7' }), res, deps);
    expect(status()).toBe(200);
    expect(JSON.parse(body())).toEqual({ text: 's7:v' });
  });

  it('未知工具 → 404 + available 列表', async () => {
    const { res, status, body } = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'nope', sessionID: 's' }), res, deps);
    expect(status()).toBe(404);
    const parsed = JSON.parse(body());
    expect(parsed.error).toContain('nope');
    expect(parsed.available).toEqual(['mafw_echo']);
  });

  it('缺 name → 400；坏 JSON → 400', async () => {
    const a = fakeRes();
    await handleToolsExecute(fakeReq({ sessionID: 's' }), a.res, deps);
    expect(a.status()).toBe(400);
    const badReq = { on: (ev: string, cb: (d?: string) => void) => { if (ev === 'data') cb('{not json'); if (ev === 'end') cb(); return badReq; } } as any;
    const b = fakeRes();
    await handleToolsExecute(badReq, b.res, deps);
    expect(b.status()).toBe(400);
  });

  it('execute 抛错 → 502', async () => {
    const deps2 = {
      buildFactory: () => () => [
        { name: 'boom', description: 'd', parameters: {}, execute: async () => { throw new Error('kaboom'); } },
      ] as any[],
    };
    const { res, status, body } = fakeRes();
    await handleToolsExecute(fakeReq({ name: 'boom', sessionID: 's' }), res, deps2);
    expect(status()).toBe(502);
    expect(JSON.parse(body()).error).toContain('kaboom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/routes/tools.test.ts`
Expected: FAIL——模块不存在

- [ ] **Step 3: Write the route**

`gateway/src/routes/tools.ts`（新文件）：

```typescript
// MAFW 基础工具 HTTP 面（deps 注入可单测）：
//   GET  /api/tools         —— 六件套 spec 清单（out-of-process runtime 的注册面）
//   POST /api/tools/execute —— 通用执行（name+params+sessionID；复用 buildMafwToolFactory）
// 信任域与 /api/python/* 一致（挂载点 isLoopback 门）。
import * as http from 'http';
import { MAFW_TOOL_SPECS, buildMafwToolFactory } from '../runtime/mafw-tools';
import type { MafwToolRegistration } from '../runtime/contract';

export interface ToolsExecuteDeps {
  buildFactory: () => (sessionId: string) => MafwToolRegistration[];
}

export function handleToolsList(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ tools: MAFW_TOOL_SPECS }));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function handleToolsExecute(req: http.IncomingMessage, res: http.ServerResponse, deps: ToolsExecuteDeps): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch (err: any) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `invalid JSON: ${err.message}` }));
    return;
  }
  const name = typeof body?.name === 'string' ? body.name : '';
  const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
  if (!name) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'name is required' }));
    return;
  }
  const registrations = deps.buildFactory()(sessionID);
  const reg = registrations.find((r) => r.name === name);
  if (!reg) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `unknown tool '${name}'`, available: registrations.map((r) => r.name) }));
    return;
  }
  try {
    const out = await reg.execute(body.params ?? {}, undefined);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  } catch (err: any) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err?.message || String(err) }));
  }
}
```

（`buildMafwToolFactory` import 保留给 index.ts 侧构造用不需要——routes/tools.ts 只依赖注入；若 lint 报 unused 则删掉该 import，只留 `MAFW_TOOL_SPECS` 与类型。）

- [ ] **Step 4: Mount in index.ts**

`gateway/src/index.ts`：

4a. import 区加：

```typescript
import { handleToolsList, handleToolsExecute } from './routes/tools';
```

4b. `/api/python/status` 路由块之后（`return;` 与下一路由之间）插入：

```typescript
        // GET /api/tools — MAFW 基础工具 spec 清单（out-of-process runtime 的注册面）
        if (req.url === "/api/tools" && req.method === "GET") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          handleToolsList(res);
          return;
        }

        // POST /api/tools/execute — 通用工具执行（out-of-process runtime 通道；同 /api/python/* 信任域）
        if (req.url === "/api/tools/execute" && req.method === "POST") {
          if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
          await handleToolsExecute(req, res, {
            buildFactory: () => buildMafwToolFactory({ baseUrl: `http://127.0.0.1:${config.server.apiPort}` }),
          });
          return;
        }
```

（`buildMafwToolFactory` 若 Task 4 未 import 则并入该 import：`import { activateRuntimeTools, buildMafwToolFactory } from './runtime/mafw-tools';`）

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/routes/tools.test.ts tests/unit/routes/`
Expected: PASS 全部

- [ ] **Step 6: Commit**

```bash
git add gateway/src/routes/tools.ts gateway/src/index.ts gateway/tests/unit/routes/tools.test.ts
git commit -m "feat(gateway): /api/tools 通道——GET spec 清单 + POST 通用执行（out-of-process runtime 补充通道，loopback 门，spec 2026-10-15 §5）"
```

---

### Task 7: 文档 + 全量回归

**Files:**
- Modify: `gateway/src/runtime/loader.ts`（README_CONTENT 插件模板）
- Modify: `.opencode/skills/runtime-plugin-authoring/SKILL.md`
- Modify: `AGENTS.md`（§5.19）

**Interfaces:**
- Consumes: 前六任务全部产出
- Produces: 文档（无代码接口）

- [ ] **Step 1: loader.ts README_CONTENT 插件模板加 tools 段**

`gateway/src/runtime/loader.ts` 的 `README_CONTENT` 模板中，`getBaseUrl()` 行之前（`config: { ... }` 之后）插入：

```
      // REQUIRED (Tier-0): tool registration channel — MAFW basic tools reach
      // your agents through this. Store the factory; call it per session and
      // register each {name, label, description, parameters, execute} into
      // your runtime's native tool registry (parameters is JSON Schema).
      tools: {
        async registerTools(factory) { myRuntime.toolFactory = factory; },
        nativeTools() {
          return [
            { name: 'my_read', toolClass: 'readonly' },
            // toolClass: readonly|search|file-edit|shell|subagent|web|plan
          ];
        },
      },
```

并在模板 capabilities 注释段（`sessionApi + promptWhileBusy already true`）后补一行：`// tools channel is REQUIRED (hard validation rejects plugins without it)`。

- [ ] **Step 2: SKILL.md 加工具注册章节**

`.opencode/skills/runtime-plugin-authoring/SKILL.md`——"### 4.5 MCP 自接线"小节之后插入新小节：

```markdown
### 4.8 工具注册通道（tools.registerTools——Tier-0 必选）

runtime 必须实现 `tools` 接口（缺 = 激活期 hard 校验拒绝，回退 opencode）：

```js
tools: {
  // gateway 激活期推送六件套 factory（mafw_add_memory / mafw_python /
  // mafw_python_restart / mafw_media_speak / mafw_media_upload / mafw_media_ask）
  async registerTools(factory) {
    // 存储 factory；在每个会话创建时调用 factory(sessionId) 得到注册项数组，
    // 每项 = { name, label?, description, parameters(JSON Schema), execute(params, signal) }
    // 把 parameters 翻译为自家类型系统后注册进会话的工具面，execute 直接透传调用。
    runtimeState.toolFactory = factory;
  },
  // 声明 runtime 原生工具（喂审批只读档/身份策略/桌面渲染的类别解析）
  nativeTools() {
    return [
      { name: 'my_read', toolClass: 'readonly' },
      { name: 'my_shell', toolClass: 'shell' },
      // toolClass: readonly|search|file-edit|shell|subagent|web|plan（空数组合法）
    ];
  },
},
```

要点：
- **execute 闭包随 spec 走**——执行逻辑全部封装在 gateway（loopback HTTP），runtime 侧零工具逻辑；
- **factory 按会话惰性调用**（python 内核/记忆归因有会话亲和性）；
- **out-of-process runtime**（agent 进程无法持有 in-process 闭包）：`GET /api/tools` 取 spec 清单 + `POST /api/tools/execute {name, params, sessionID}` 执行（loopback）；
- 参考实现：pi 的 `pi-mafw-host-extension.ts`（T.Unsafe 包 JSON Schema + execute 桥接，~30 行）。
```

同时更新该文件 Tier 0 小节（L19 附近）：在 Tier 0 能力清单里加一行 `tools 注册通道（registerTools + nativeTools，必选）`。

- [ ] **Step 3: AGENTS.md §5.19 契约描述更新**

`AGENTS.md` §5.19 的契约能力清单处（`contract.ts — RuntimeCapabilities...` 行附近）补：

```markdown
- `RuntimeClient.tools`（**Tier-0 必选**，无能力位）：`registerTools(factory)`——gateway 激活期推送六件套 factory（spec+execute 单源 `runtime/mafw-tools.ts`，execute 闭包随 spec 走，runtime 只做 plumbing）；`nativeTools()`——runtime 原生工具声明，激活期经 `tool-classes.ts` overlay（声明优先于并集表，热切换整体替换）生效。缺实现 = validate.ts hard 拒绝回退 opencode。out-of-process 通道：`GET /api/tools` + `POST /api/tools/execute`
```

- [ ] **Step 4: 全量回归 + build**

Run（gateway/ 下）: `npx jest`
Expected: 全部套件绿（对照提交前基线数——本批新增测试约 25 例）

Run（仓库根）: `npm run build`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/loader.ts .opencode/skills/runtime-plugin-authoring/SKILL.md AGENTS.md
git commit -m "docs(gateway): 工具注册通道文档——loader README 模板 + runtime-plugin-authoring SKILL + AGENTS §5.19（spec 2026-10-15 §8）"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3 D1-D8 → Task 2（D1 契约/校验）、Task 3（D2/D3 factory）、Task 5（D8 T.Unsafe + spike 结论）、Task 6（D7 HTTP）、Task 1/4（D5 overlay/激活）、Task 7（文档）；§9 验收四条 → Task 3/5/6 测试 + Task 7 回归
- **占位符**：无 TBD/TODO；所有代码块完整
- **类型一致性**：`MafwToolRegistration.execute` 返回 `{ text: string; isError?: boolean }` 在 contract/mafw-tools/pi extension/测试间一致；`setToolClassOverlay` 签名 Task 1 定义 = Task 3 activateRuntimeTools 消费；`PiSessionRegistryOptions.toolFactory` Task 2 定义 = Task 5 流转
- **已知边界**：Task 2 后 pi 激活即满足契约（stash 在 Task 2、消费在 Task 5，中间态 pi 会话仍用旧手写注册——行为不回退）；`/api/tools` GET 无 query 解析（`req.url ===` 精确匹配，与 python 路由同惯例）
