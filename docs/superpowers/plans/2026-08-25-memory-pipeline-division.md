# 记忆管线两级分工实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `docs/superpowers/specs/2026-08-25-memory-pipeline-division-design.md` 实现记忆管线两级分工：reflect 输入全文化、prompt 分工、Generative Agents 式三步反思、importance 打分映射 salience。

**Architecture:** 4 个独立改动，按依赖顺序实施：①reflect 全文输入（数据层）→ ②prompt 分工声明（提示层）→ ③三步反思编排（流程层，依赖 ①② 的全文输入与分工 prompt）→ ④importance→salience（写入层，独立）。每个任务 TDD + 独立提交。

**Tech Stack:** TypeScript, Jest, gateway/src/recall/*, mcp handlers, 插件工具 schema。

## Global Constraints

- 测试命令：`npx jest tests/unit/gateway/<file> -t <name>`（单测）与 `npm test`（全量）
- 构建命令：`npm run build`（构建 plugin + gateway）
- `mafw_add_memory` 的 `importance` 参数：可选整数 1-10；映射 `salience = 0.5 + (importance - 1) / 9`；不传回退 `calculateSalience(content)`
- reflect 输出格式不变：`parseInsights` 的 JSON `{"insights":[{category, content, cue_anchors}]}` 结构
- 证据块格式：`### 相关历史记忆\n- [id] primary_abstraction`
- 改动的常量需 export（`TOOL_EXTRACTION_SYSTEM`、`REFLECT_SYSTEM`、`QUESTIONS_SYSTEM`）以便测试断言
- 全部提交信息中文，风格 `feat:` / `fix:` / `test:` 前缀

---

### Task 1: reflect 输入升级为 memory_value 全文

**Files:**
- Modify: `gateway/src/recall/reflection.ts:172-186`（reflectSession 的 prompt 组装）
- Test: `tests/unit/gateway/reflection.test.ts`（新建）

**Interfaces:**
- Consumes: `ReflectionPipeline`（构造 `new ReflectionPipeline({index, baseDir, workerFor, cursor, ...})`）；内部 `this.store.read(id): Promise<HarmonicUnit|null>`；`unreflectedBySession` 返回 `{id, text}[]`
- Produces: `reflectSession` 的 prompt 现在包含 `memory_value` 全文（每条截断 2000 字符，读取失败回退 `e.text`）

- [ ] **Step 1: 写失败测试（全文加载）**

```ts
// tests/unit/gateway/reflection.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { ReflectionPipeline } from '../../../gateway/src/recall/reflection';
import { ReflectCursor } from '../../../gateway/src/recall/reflect-cursor';

let dir: string;
let db: GatewayDatabase;
let store: HarmonicUnitFileStore;

const T = '2025-01-01T00:00:00.000Z';

function epUnit(id: string, primary: string, anchors: string[], memoryValue: string): any {
  return {
    id, type: 'episodic', primary_abstraction: primary, cue_anchors: anchors,
    memory_value: memoryValue, energy: 0.8, created_at: T, updated_at: T,
    source_session_id: 'sess-1',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  db = new GatewayDatabase(path.join(dir, 'gw.db'));
  store = new HarmonicUnitFileStore(dir, undefined, undefined);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reflectSession prompt includes full memory_value', async () => {
  await store.write(epUnit('ep1', 'deployed service', ['deploy'], 'Full narrative of the deployment with all details and the root cause of the outage was the missing timeout on the HTTP client.'));
  const prompts: string[] = [];
  const pipeline = new ReflectionPipeline({
    index: store.indexManager_(),
    baseDir: dir,
    workerFor: () => ({
      prompt: async (_p: string, _sys: string, _m: any) => {
        prompts.push(_p);
        return '{"insights":[]}';
      },
    }) as any,
    cursor: new ReflectCursor(db),
    workerModel: { providerID: 'x', modelID: 'y' },
  });
  await (pipeline as any).reflectSession('sess-1', [{ id: 'ep1', text: 'deployed service deploy' }]);
  expect(prompts[0]).toContain('Full narrative of the deployment');
  expect(prompts[0]).not.toContain('deployed service deploy');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/unit/gateway/reflection.test.ts -t "includes full memory_value"`
Expected: FAIL（prompt 只有摘要行，`toContain('Full narrative...')` 失败）

- [ ] **Step 3: 最小实现（全文加载 + 回退 + 截断）**

`gateway/src/recall/reflection.ts` 的 `reflectSession` 中，把 `const prompt = episodes.map((e, i) => ...)` 替换为异步全文加载：

```ts
    const promptLines: string[] = [];
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      let text = ep.text;
      try {
        const unit = await this.store.read(ep.id);
        if (unit?.memory_value) text = unit.memory_value.slice(0, 2000);
      } catch { /* fall back to summary line */ }
      promptLines.push(`${i + 1}. ${text}`);
    }
    const prompt = promptLines.join('\n');
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/unit/gateway/reflection.test.ts -t "includes full memory_value"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/recall/reflection.ts tests/unit/gateway/reflection.test.ts
git commit -m "feat: reflect 输入升级为 memory_value 全文（截断 2000 + 回退摘要行）"
```

---

### Task 2: 两条管线 prompt 分工声明

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts:36-53`（TOOL_EXTRACTION_SYSTEM + export）
- Modify: `gateway/src/recall/reflection.ts:48-54`（REFLECT_SYSTEM + export）
- Test: `tests/unit/gateway/reflection.test.ts`（追加分工断言）

**Interfaces:**
- Consumes: 无（纯 prompt 文本改动）
- Produces: export 的 `TOOL_EXTRACTION_SYSTEM`、`REFLECT_SYSTEM` 常量（供测试断言）

- [ ] **Step 1: 写失败测试（分工声明存在）**

追加到 `tests/unit/gateway/reflection.test.ts`：

```ts
import { REFLECT_SYSTEM } from '../../../gateway/src/recall/reflection';
import { TOOL_EXTRACTION_SYSTEM } from '../../../gateway/src/recall/turn-pipeline';

test('prompt division: extract focuses on facts, reflect on cross-episode patterns', () => {
  expect(TOOL_EXTRACTION_SYSTEM).toContain('事实层');
  expect(TOOL_EXTRACTION_SYSTEM).toContain('跨会话的模式泛化');
  expect(REFLECT_SYSTEM).toContain('跨回合');
  expect(REFLECT_SYSTEM).toContain('单点事实');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/unit/gateway/reflection.test.ts -t "prompt division"`
Expected: FAIL（TOOL_EXTRACTION_SYSTEM 未 export，import 报错）

- [ ] **Step 3: 实现分工 prompt**

`turn-pipeline.ts` — 常量 `const TOOL_EXTRACTION_SYSTEM` 改为 `export const TOOL_EXTRACTION_SYSTEM`，并在 Rules 块后追加：

```ts
Division of labor: your job is the FACT LAYER of this session — concrete facts, decisions, preferences, event outcomes, and specific technical pitfalls (which API does what). Do NOT attempt cross-session pattern generalization — that is the daily reflection pipeline's job.
```

`reflection.ts` — 常量 `const REFLECT_SYSTEM` 改为 `export const REFLECT_SYSTEM`，并在 Rules 块后追加：

```ts
Division of labor: focus on CROSS-EPISODE high-level patterns — recurring failure root causes, lessons that generalize to future tasks, user behavior patterns. Do NOT re-record single-point facts already present in the episodic memories (the hourly extract pipeline already saved those).
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/unit/gateway/reflection.test.ts -t "prompt division"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/recall/reflection.ts gateway/src/recall/turn-pipeline.ts tests/unit/gateway/reflection.test.ts
git commit -m "feat: turnCompress/reflect prompt 分工声明（事实层 vs 跨回合高阶模式）"
```

---

### Task 3: Generative Agents 式三步反思编排

**Files:**
- Modify: `gateway/src/recall/reflection.ts`（QUESTIONS_SYSTEM、parseQuestions、reflectSession 编排）
- Test: `tests/unit/gateway/reflection.test.ts`（三步流程、回退、取证断言）

**Interfaces:**
- Consumes: `this.store.read(id)`（Task 1）；`this.opts.index.searchScored(query, k, options)` → `ScoredEntry[]`（`{entry, score}`）；`parseInsights`（现有）
- Produces: `QUESTIONS_SYSTEM`（export）、`parseQuestions(text): string[]`（export，解析失败返回 `[]`）；`reflectSession` 编排三步

- [ ] **Step 1: 写失败测试（三步编排：问题生成 → 取证 → 蒸馏）**

```ts
test('reflectSession runs question → evidence → distillation', async () => {
  await store.write(epUnit('ep1', 'deployed service crashed', ['deploy'], 'Service crashed due to missing timeout.'));
  const calls: { p: string; sys: string }[] = [];
  const searchCalls: string[] = [];
  const pipeline = new ReflectionPipeline({
    index: {
      ...store.indexManager_(),
      searchScored: (q: string) => {
        searchCalls.push(q);
        return [{ entry: { id: 'ev1', primary_abstraction: 'timeout lessons' }, score: 1 }] as any;
      },
    } as any,
    baseDir: dir,
    workerFor: () => ({
      prompt: async (p: string, sys: string) => {
        calls.push({ p, sys });
        if (sys.includes('questions')) return '{"questions":["What caused the crash?"]}';
        return '{"insights":[{"category":"failure","content":"Deployments need timeout configuration before release","cue_anchors":["deploy"]}]}';
      },
    }) as any,
    cursor: new ReflectCursor(db),
    workerModel: { providerID: 'x', modelID: 'y' },
  });
  const result = await (pipeline as any).reflectSession('sess-1', [{ id: 'ep1', text: 'deployed service crashed deploy' }]);
  expect(calls.length).toBe(2);
  expect(searchCalls).toContain('What caused the crash?');
  expect(calls[1].p).toContain('### 相关历史记忆');
  expect(calls[1].p).toContain('[ev1] timeout lessons');
  expect(result.distilled).toBe(1);
});
  const result = await (pipeline as any).reflectSession('sess-1', [{ id: 'ep1', text: 'deployed service crashed deploy' }]);
  expect(calls.length).toBe(2);
  expect(searchCalls).toContain('What caused the crash?');
  expect(calls[1].p).toContain('### 相关历史记忆');
  expect(calls[1].p).toContain('[ev1] timeout lessons');
  expect(result.distilled).toBe(1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/unit/gateway/reflection.test.ts -t "question"`
Expected: FAIL（calls.length 为 1，无 searchCalls）

- [ ] **Step 3: 实现 QUESTIONS_SYSTEM + parseQuestions**

```ts
export const QUESTIONS_SYSTEM = `You are a reflection system for a coding agent's long-term memory. Review the episodic memories of one conversation and generate the 2-3 most salient high-level questions about this session — questions whose answers would reveal durable patterns, recurring root causes, or generalizable lessons. Return ONLY valid JSON, no markdown:
{"questions":["<question>","<question>"]}
Rules:
- questions must be answerable from past conversations (not speculation)
- prefer questions that span multiple episodes`;

export function parseQuestions(text: string): string[] {
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    const items = parsed?.questions ?? parsed;
    if (!Array.isArray(items)) return [];
    return items.filter((q: any) => typeof q === 'string' && q.trim()).slice(0, 3).map(String);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: 实现三步编排**

在 `reflectSession` 中，把 Task 1 的单次 `worker.prompt(prompt, REFLECT_SYSTEM, ...)` 替换为：

```ts
    const worker = this.opts.workerFor(sessionID);
    let insights: Insight[] = [];
    try {
      // Step 1: generate salient questions
      const qText = await worker.prompt(prompt, QUESTIONS_SYSTEM, this.opts.workerModel);
      const questions = parseQuestions(qText);
      // Step 2: retrieve evidence per question (bm25, no graph expansion)
      const evidence: string[] = [];
      if (questions.length > 0) {
        for (const q of questions) {
          const hits = this.opts.index.searchScored(q, 5, { retriever: 'bm25', graphExpand: false });
          for (const hit of hits) {
            const line = `- [${hit.entry.id}] ${hit.entry.primary_abstraction}`;
            if (!evidence.includes(line)) evidence.push(line);
          }
        }
      }
      // Step 3: distill insights with evidence context
      const evidenceBlock = evidence.length > 0 ? `\n\n### 相关历史记忆\n${evidence.join('\n')}` : '';
      const text = await worker.prompt(prompt + evidenceBlock, REFLECT_SYSTEM, this.opts.workerModel);
      insights = parseInsights(text);
    } catch {
      result.failed++;
      return result; // episodes stay unreflected
    }
```

注意：Task 1 的 `const worker = this.opts.workerFor(sessionID);` 行会与新代码重复声明——删除旧的单次声明，把 `let insights: Insight[] = [];` 和 `worker` 移到 try 块外（或内部）。保留 catch → failed 语义。证据块为空时不附加（与旧行为一致）。

- [ ] **Step 5: 写失败测试（questions 解析失败回退，不取证直接蒸馏）**

```ts
test('reflectSession falls back to direct distillation when questions unparseable', async () => {
  await store.write(epUnit('ep1', 'deployed service crashed', ['deploy'], 'Service crashed.'));
  const calls: string[] = [];
  const searchCalls: string[] = [];
  const pipeline = new ReflectionPipeline({
    index: {
      ...store.indexManager_(),
      searchScored: (q: string) => { searchCalls.push(q); return []; },
    } as any,
    baseDir: dir,
    workerFor: () => ({
      prompt: async (p: string, sys: string) => {
        calls.push(sys);
        if (sys.includes('questions')) return 'not json at all';
        return '{"insights":[{"category":"insight","content":"lesson","cue_anchors":["x"]}]}';
      },
    }) as any,
    cursor: new ReflectCursor(db),
    workerModel: { providerID: 'x', modelID: 'y' },
  });
  await (pipeline as any).reflectSession('sess-1', [{ id: 'ep1', text: 'deployed service crashed deploy' }]);
  expect(calls.length).toBe(2);
  expect(searchCalls.length).toBe(0);
});
```

- [ ] **Step 6: 运行确认通过（两个测试）**

Run: `npx jest tests/unit/gateway/reflection.test.ts`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add gateway/src/recall/reflection.ts tests/unit/gateway/reflection.test.ts
git commit -m "feat: reflect 三步编排（问题生成→检索取证→蒸馏，失败回退直蒸馏）"
```

---

### Task 4: importance 打分 → salience

**Files:**
- Modify: `src/tools/add-memory.ts`（插件工具 schema + HTTP body 透传）
- Modify: `gateway/src/index.ts:4574-4611`（HTTP 路径 salience）
- Modify: `gateway/src/mcp/handlers/add-memory.ts:30-42`（MCP 路径 salience）
- Modify: `gateway/src/recall/turn-pipeline.ts`（TOOL_EXTRACTION_SYSTEM 加 importance 标尺）
- Test: `tests/unit/gateway/add-memory.test.ts`（新建，映射单测）

**Interfaces:**
- Consumes: `calculateSalience(content): number`（现有）；`config.memory.defaultEnergy`
- Produces: `mafw_add_memory` 可选参数 `importance?: number`（1-10 整数）；salience 映射函数 `importanceToSalience(n): number`（export，从 `gateway/src/core/memory/salience-perceptor.ts`）

- [ ] **Step 1: 写失败测试（importanceToSalience 映射）**

```ts
// tests/unit/gateway/add-memory.test.ts
import { importanceToSalience } from '../../../gateway/src/core/memory/salience-perceptor';

test('importanceToSalience maps 1..10 to 0.5..1.5', () => {
  expect(importanceToSalience(1)).toBe(0.5);
  expect(importanceToSalience(5)).toBeCloseTo(0.944, 3);
  expect(importanceToSalience(10)).toBe(1.5);
});

test('importanceToSalience clamps out-of-range to defaults', () => {
  expect(importanceToSalience(0)).toBe(1.0);
  expect(importanceToSalience(11)).toBe(1.0);
  expect(importanceToSalience(undefined as any)).toBe(1.0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/unit/gateway/add-memory.test.ts`
Expected: FAIL（importanceToSalience 未定义）

- [ ] **Step 3: 实现 importanceToSalience**

`gateway/src/core/memory/salience-perceptor.ts` 追加：

```ts
/** Map an explicit importance score (1-10) to salience, bridging the regex
 *  three-tier scale (0.5 / 1.0 / 1.5). Out-of-range or missing → 1.0. */
export function importanceToSalience(importance: number | undefined): number {
  if (typeof importance !== 'number' || !Number.isFinite(importance)) return 1.0;
  if (importance < 1 || importance > 10) return 1.0;
  return 0.5 + ((importance - 1) / 9);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/unit/gateway/add-memory.test.ts`
Expected: PASS

- [ ] **Step 5: 改插件工具 schema（src/tools/add-memory.ts）**

args 加：

```ts
    importance: z.number().int().min(1).max(10).optional().describe('重要性打分 1-10：1=琐碎日常，5=普通事实，9-10=架构级决定/严重事故。缺省自动判定'),
```

execute 的 body 加：`importance: args.importance,`

`AddMemoryTool` 接口的 args 类型加 `importance?: number;`。

- [ ] **Step 6: 改 HTTP 路径（gateway/src/index.ts:4593-4605）**

```ts
        const { importanceToSalience } = require('./core/memory/salience-perceptor.js');
        const salience = typeof data?.importance === 'number' && Number.isFinite(data.importance)
          ? importanceToSalience(data.importance)
          : calculateSalience(content);
```

unit 对象中 `salience: salience,`（替换 `salience: calculateSalience(content)`）。

- [ ] **Step 7: 改 MCP 路径（gateway/src/mcp/handlers/add-memory.ts）**

```ts
import { calculateSalience, importanceToSalience } from "../../core/memory/salience-perceptor";
// ...
const importance = (args.importance as number | undefined);
const salience = importance !== undefined
  ? importanceToSalience(importance)
  : calculateSalience(content);
```

unit 对象中 `salience,`（替换 `salience: calculateSalience(content)`）。工具入参校验在 MCP 层由 schema 保证（zod 在 tools.ts），handler 只做有限数防御。

- [ ] **Step 8: 改 TOOL_EXTRACTION_SYSTEM 加 importance 标尺**

`turn-pipeline.ts` 的 TOOL_EXTRACTION_SYSTEM Rules 块追加：

```ts
- for every memory you write, include an explicit importance score via the mafw_add_memory importance parameter: 1=trivial routine, 5=ordinary fact, 9-10=architecture-level decision or serious incident
```

- [ ] **Step 9: 运行全量测试**

Run: `npm test`
Expected: 全部 PASS（含 Task 1-3 的 reflection 测试）

- [ ] **Step 10: 提交**

```bash
git add src/tools/add-memory.ts gateway/src/index.ts gateway/src/mcp/handlers/add-memory.ts gateway/src/recall/turn-pipeline.ts gateway/src/core/memory/salience-perceptor.ts tests/unit/gateway/add-memory.test.ts
git commit -m "feat: mafw_add_memory importance 参数映射 salience（HTTP+MCP 双路径）"
```

---

### Task 5: 构建 + 部署验证

**Files:**
- 无（纯构建/部署）

**Interfaces:**
- Consumes: Task 1-4 全部改动

- [ ] **Step 1: 构建**

Run: `npm run build`
Expected: exit 0，dist 更新（plugin + gateway）

- [ ] **Step 2: 全局包同步**

Run: `npm pack; npm install -g opencode-plugin-mafw-*.tgz`
Expected: 全局包更新（`C:\home\ubuntu\.npm-global\node_modules\opencode-plugin-mafw`）

- [ ] **Step 3: 真实 gateway 验证（前台启动）**

Run: `mafw restart`（按 AGENTS.md 6.3 前台重启），等待启动日志 `started`
Expected: 启动成功；`~/.mafw/logs/mafw.log` 无新报错

- [ ] **Step 4: 提交（如有遗留）**

```bash
git add -A
git commit -m "chore: 记忆管线两级分工构建部署"
```

