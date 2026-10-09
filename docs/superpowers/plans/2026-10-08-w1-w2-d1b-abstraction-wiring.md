# 第一批：抽象→runtime 接线（W1 常驻先验 + W2 skill 物化 + D1b 降能）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通抽象层到运行时的两条 push 通道（常驻先验块、记忆→skill 物化），并落地 gist 化后源条目降能（D1b）。

**Architecture:** W1 镜像 pinned `<user-profile>` 全链（渲染纯函数 → deps 注入路由 → 插件 system.transform hook，fail-open 150ms）。W2 = 确定性渲染器（OKF md → SKILL.md md）+ G1-G5 纯函数闸门 + staging→triage 人审→安装 + 记忆变指针 + deopt。D1b 在 reflection 成功蒸馏后对源 episodes 按 factor 降能。

**Tech Stack:** gateway TS（jest --runInBand）、插件 src/hooks（opencode transform）、无新依赖。

## 0. 全局项落位（7 方向 + 4 接线 + 4 自我认知 + 5 生产侧，共 20 项）

本计划只详展**第一批**（Plan 1）；其余批次各出独立 plan（writing-plans：每个 plan 独立可测可交付），此处登记落位防丢。路线图总表：`docs/research/2026-10-08-brain-like-roadmap.md` §5。

| 系列 | 项 | 批次 / 状态 | 实现 plan |
|---|---|---|---|
| **D（脑化）** | D1 分档衰减 | ✅ 已实现 | — |
| | **D1b 源条目降能** | **第一批** | **Plan 1 Task 10** |
| | D2 检索即重写 | 第三批（窗口已有，缺消费 worker） | Plan 3 |
| | D3 surprise 门控 | 第二批（向量基建现成） | Plan 2 |
| | D4a 做梦预取 | 第二批（R8 现成，缺查询生成器） | Plan 2 |
| | D4b 反事实模拟 | 第三批（依赖 L1+L2） | Plan 3 |
| | D5 PPR 扩散激活 | 远端（需建图） | Plan 4 |
| | D6 第一人称重放 | 远端（体验层） | Plan 4 |
| | D7 叙事自我 | 远端（=L4 数据源） | Plan 4 |
| **W（接线）** | **W1 常驻先验块** | **第一批** | **Plan 1 Task 2-5** |
| | **W2 skill 物化通道** | **第一批** | **Plan 1 Task 6-9** |
| | W3 schema pattern completion | 远端（依赖 D5） | Plan 4 |
| | W4 goal 级先验 | 第三批（依赖 L1+L2；plan 节点已通） | Plan 3 |
| **L（自我认知）** | L1 能力账本 | 第二批（缺口：任务分类器） | Plan 2 |
| | **L2 失败模式谱** | **第一批落 category + W1 消费（首形）；完整聚合第二批** | **Plan 1 Task 1** / Plan 2 |
| | L3 知识边界 | 第三批（缺口：FOK 主题字段+样本量） | Plan 3 |
| | L4 自传时间线 | 远端（依赖 D7） | Plan 4 |
| **A（生产侧）** | A1 阶梯补顶 | 远端（依赖 A4） | Plan 4 |
| | A2 草稿-验证并行 | 第三批 | Plan 3 |
| | A3 抽象用强模型 | 搁置（用户判定非瓶颈） | — |
| | A4 选择压力回流 | 第二批（need 信号现成） | Plan 2 |
| | A5 抽象写回 schema | 远端 | Plan 4 |

**批次构成**：
- **Plan 1（本文件）**：W1 + W2 + D1b + L2（category 落盘）
- **Plan 2**：D3 + D4a + L1 + L2（聚合完整）+ A4
- **Plan 3**：A2 + D2 + D4b + W4 + L3
- **Plan 4（远端）**：D5 + W3 + A1 + A5 + D6 + D7 + L4

**批次排序依据**：接线侧（W）先通——现有抽象产物立刻生效；生产侧（A/D）随后提升质量；自我认知（L）与做梦（D4）在数据源就绪后跟进；远端项依赖建图/体验层/前置数据。

## Global Constraints

- **TDD**：先写失败测试再实现；每个 task 结束 commit
- **jest 不 typecheck `gateway/src/index.ts`**——凡改 index.ts 必须跑 `npm run build`（root）验证
- 测试 import 路径：`gateway/tests/unit/<sub>/x.test.ts` 用 `../../../src/...`
- 中文内容只经 write/edit 工具落盘（PowerShell 管道 UTF-8 损坏）
- 全量门禁：`cd gateway && npx jest --runInBand`（基线 258 套件 1739 用例）
- 版本号：本批不 bump（随下个 minor 一起）

---

### Task 1: reflection category 落盘（`cat:` 锚点，L2 前置）

**Files:**
- Modify: `gateway/src/recall/reflection.ts:281-294`（unit 构造）
- Test: `gateway/tests/unit/recall/reflection-category.test.ts`（新建）

**Interfaces:**
- Produces: 新写 insight 的 `cue_anchors` 末尾带 `cat:<category>`（如 `cat:failure`）。Task 3 的 priors 聚合靠它筛失败模式谱。

- [ ] **Step 1: 抽纯函数 + 失败测试**

`reflection.ts` 中把 unit 构造抽为导出纯函数（放在 `CATEGORY_ENERGY` 旁）：

```typescript
export function buildInsightUnit(insight: Insight, sessionID: string, now: string): HarmonicUnit {
  return {
    id: generateHarmonicId(),
    type: CATEGORY_TO_TYPE[insight.category],
    primary_abstraction: insight.content.slice(0, 200),
    // cat: 锚点落盘——L2 失败模式谱与 W1 先验块的筛选面（此前 category 映射完即弃）
    cue_anchors: [...(insight.cue_anchors ?? []), `cat:${insight.category}`],
    memory_value: insight.content,
    energy: CATEGORY_ENERGY[insight.category],
    salience: calculateSalience(insight.content),
    abstraction_level: abstractionLevelFor('semantic'),
    created_at: now,
    updated_at: now,
    source_session_id: sessionID === ORPHAN_SESSION ? undefined : sessionID,
  };
}
```

新建 `gateway/tests/unit/recall/reflection-category.test.ts`：

```typescript
import { buildInsightUnit } from '../../../src/recall/reflection';

describe('buildInsightUnit', () => {
  it('persists category as cat: anchor (L2 failure-taxonomy surface)', () => {
    const u = buildInsightUnit(
      { category: 'failure', content: 'serve 崩溃后事件订阅必须重连', cue_anchors: ['serve', 'watchdog'] },
      'ses_x',
      '2026-10-08T00:00:00.000Z',
    );
    expect(u.cue_anchors).toContain('cat:failure');
    expect(u.cue_anchors).toEqual(['serve', 'watchdog', 'cat:failure']);
    expect(u.type).toBe('semantic');
    expect(u.energy).toBe(0.9);
  });

  it('tolerates missing cue_anchors', () => {
    const u = buildInsightUnit({ category: 'insight', content: 'x' }, 'ORPHAN', '2026-10-08T00:00:00.000Z');
    expect(u.cue_anchors).toEqual(['cat:insight']);
    expect(u.source_session_id).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd gateway; npx jest tests/unit/recall/reflection-category.test.ts`
Expected: FAIL（buildInsightUnit 未导出）

- [ ] **Step 3: 实现**——`reflectSession` 中原内联 unit 构造（reflection.ts:282-294）替换为 `const unit = buildInsightUnit(insight, sessionID, now);`

- [ ] **Step 4: 绿 + 全量**

Run: `cd gateway; npx jest tests/unit/recall/reflection-category.test.ts` 然后 `npx jest --runInBand`
Expected: 新测试 2 过；全量绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/reflection.ts gateway/tests/unit/recall/reflection-category.test.ts
git commit -m "feat(reflection): persist insight category as cat: anchor (L2 failure-taxonomy surface)"
```

---

### Task 2: `<agent-priors>` 渲染器（纯函数）

**Files:**
- Modify: `gateway/src/recall/inject-format.ts`（PINNED_BUDGET 声明区之后追加）
- Test: `gateway/tests/unit/recall/agent-priors-format.test.ts`（新建）

**Interfaces:**
- Produces: `AGENT_PRIORS_BUDGET = { maxAxioms: 5, maxPatterns: 5, maxChars: 800 }`；`formatAgentPriors(input: { axioms: string[]; heuristics: string[]; failurePatterns: string[] }): { block: string | null; used: number }`（Task 3 消费）。

- [ ] **Step 1: 失败测试**

```typescript
import { formatAgentPriors, AGENT_PRIORS_BUDGET } from '../../../src/recall/inject-format';

describe('formatAgentPriors', () => {
  it('renders axioms + failure patterns within budget', () => {
    const { block, used } = formatAgentPriors({
      axioms: ['子进程 spawn 必须 windowsHide'],
      heuristics: [],
      failurePatterns: ['serve 崩溃后事件订阅必须重连'],
    });
    expect(block).toContain('<agent-priors>');
    expect(block).toContain('子进程 spawn 必须 windowsHide');
    expect(block).toContain('serve 崩溃后事件订阅必须重连');
    expect(used).toBe(2);
  });

  it('returns null block when all inputs empty', () => {
    expect(formatAgentPriors({ axioms: [], heuristics: [], failurePatterns: [] }).block).toBeNull();
  });

  it('hard-caps total chars', () => {
    const long = 'x'.repeat(400);
    const { block } = formatAgentPriors({
      axioms: [long, long, long],
      heuristics: [],
      failurePatterns: [long],
    });
    expect(block!.length).toBeLessThanOrEqual(AGENT_PRIORS_BUDGET.maxChars + 200); // 块头尾固定开销
  });
});
```

- [ ] **Step 2: 跑红** — `cd gateway; npx jest tests/unit/recall/agent-priors-format.test.ts` → FAIL（未导出）

- [ ] **Step 3: 实现**（inject-format.ts 追加）

```typescript
export const AGENT_PRIORS_BUDGET = { maxAxioms: 5, maxPatterns: 5, maxChars: 800 } as const;

/** W1 常驻先验块：蒸馏产物（L5 公理/启发式 + 失败模式谱）每轮常驻 system。 */
export function formatAgentPriors(input: {
  axioms: string[];
  heuristics: string[];
  failurePatterns: string[];
}): { block: string | null; used: number } {
  const lines: string[] = [];
  let chars = 0;
  let used = 0;
  const push = (line: string): boolean => {
    if (chars + line.length > AGENT_PRIORS_BUDGET.maxChars) return false;
    lines.push(line); chars += line.length + 1; used++;
    return true;
  };
  for (const a of input.axioms.slice(0, AGENT_PRIORS_BUDGET.maxAxioms)) if (!push(`- [公理] ${a}`)) break;
  for (const h of input.heuristics.slice(0, AGENT_PRIORS_BUDGET.maxAxioms)) if (!push(`- [启发式] ${h}`)) break;
  for (const f of input.failurePatterns.slice(0, AGENT_PRIORS_BUDGET.maxPatterns)) if (!push(`- [勿再犯] ${f}`)) break;
  if (lines.length === 0) return { block: null, used: 0 };
  return {
    block: `<agent-priors>\n## 行动先验（长期记忆蒸馏，常驻）\n${lines.join('\n')}\n</agent-priors>`,
    used,
  };
}
```

- [ ] **Step 4: 绿** — 同上命令

- [ ] **Step 5: Commit** — `git commit -m "feat(recall): formatAgentPriors renderer (budgeted <agent-priors> block)"`

---

### Task 3: priors 聚合路由模块

**Files:**
- Create: `gateway/src/routes/agent-priors.ts`
- Test: `gateway/tests/unit/routes/agent-priors.test.ts`（新建）

**Interfaces:**
- Consumes: `formatAgentPriors`（Task 2）；`L5Store.getTop(topK)` 形状 `{ axioms: Array<{content,energy}>, heuristics: Array<{pattern,energy}> }`
- Produces: `handleAgentPriors(deps)` → `{ block, used, budget }`；deps 形状见下（Task 4 在 index.ts 接线时注入）

- [ ] **Step 1: 失败测试**

```typescript
import { handleAgentPriors } from '../../../src/routes/agent-priors';

const idx = (entries: any[]) => ({ entries });

describe('handleAgentPriors', () => {
  it('combines L5 axioms with cat:failure/correction patterns, sorted by energy×(1+need)', async () => {
    const r = await handleAgentPriors({
      l5: { getTop: () => ({ axioms: [{ content: '公理A', energy: 0.9 }], heuristics: [] }) },
      getIndex: () => idx([
        { id: 'm1', energy: 0.5, salience: 1, cue_anchors: ['cat:failure'], primary_abstraction: '失败P1' },
        { id: 'm2', energy: 0.8, salience: 1, cue_anchors: ['cat:failure'], primary_abstraction: '失败P2' },
        { id: 'm3', energy: 0.9, salience: 1, cue_anchors: ['cat:insight'], primary_abstraction: '不收' },
        { id: 'm4', energy: 0.9, salience: 1, cue_anchors: ['cat:failure'], primary_abstraction: '已取代', superseded_by: 'm2' },
      ]),
      needFor: () => 0,
    });
    expect(r.block).toContain('公理A');
    expect(r.block).toContain('失败P2'); // energy 高者先
    expect(r.block).not.toContain('不收');
    expect(r.block).not.toContain('已取代');
    expect(r.block!.indexOf('失败P2')).toBeLessThan(r.block!.indexOf('失败P1'));
  });

  it('empty everything → null block', async () => {
    const r = await handleAgentPriors({
      l5: { getTop: () => ({ axioms: [], heuristics: [] }) },
      getIndex: () => idx([]),
    });
    expect(r.block).toBeNull();
  });
});
```

- [ ] **Step 2: 跑红** — `cd gateway; npx jest tests/unit/routes/agent-priors.test.ts` → FAIL

- [ ] **Step 3: 实现** `gateway/src/routes/agent-priors.ts`

```typescript
import { formatAgentPriors } from '../recall/inject-format';

export interface AgentPriorsDeps {
  l5: { getTop(k?: number): { axioms: Array<{ content: string }>; heuristics: Array<{ pattern: string }> } };
  getIndex(): { entries: any[] };
  needFor?: (id: string) => number;
  topK?: number;
}

export async function handleAgentPriors(deps: AgentPriorsDeps): Promise<{
  block: string | null; used: number; budget: { maxChars: number };
}> {
  const topK = deps.topK ?? 5;
  const { axioms, heuristics } = deps.l5.getTop(topK);
  const patterns = deps.getIndex().entries
    .filter((e: any) => !e.superseded_by
      && (e.cue_anchors ?? []).some((a: string) => a === 'cat:failure' || a === 'cat:correction'))
    .map((e: any) => ({
      text: e.primary_abstraction as string,
      score: (e.energy ?? 0) * (e.salience ?? 1) * (1 + (deps.needFor?.(e.id) ?? 0)),
    }))
    .sort((a, b) => b.score - a.score)
    .map((p) => p.text);
  const { block, used } = formatAgentPriors({
    axioms: axioms.map((a) => a.content),
    heuristics: heuristics.map((h) => h.pattern),
    failurePatterns: patterns,
  });
  return { block, used, budget: { maxChars: 800 } };
}
```

- [ ] **Step 4: 绿** — 同上

- [ ] **Step 5: Commit** — `git commit -m "feat(recall): agent-priors aggregation route module (L5 + failure taxonomy, need-weighted)"`

---

### Task 4: index.ts 接线 `GET /api/recall/priors`

**Files:**
- Modify: `gateway/src/index.ts`（pinned recall 路由块之后，约 :5605）

- [ ] **Step 1: 接线**（紧跟 `/api/recall/pinned` 块后插入）

```typescript
        // GET /api/recall/priors — W1 常驻先验块（L5 公理 + 失败模式谱），fail-open
        if (req.url?.startsWith('/api/recall/priors') && req.method === 'GET') {
          try {
            const { handleAgentPriors } = require('./routes/agent-priors');
            const result = await handleAgentPriors({
              l5: new L5Store(),
              getIndex: () => this.memoryService?.harmonicIndex.getIndex() ?? { entries: [] },
              needFor: (id) => getRetrievalEventBuffer().needFor(id),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err: any) {
            log.error('[Recall] priors error:', err.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ block: null, used: 0 }));
          }
          return;
        }
```

- [ ] **Step 2: 验证** — `npm run build`（root；jest 不 typecheck index.ts）+ `cd gateway; npx jest --runInBand` 全量绿
- [ ] **Step 3: 手动冒烟**（gateway 运行中时）：`Invoke-WebRequest http://127.0.0.1:3000/api/recall/priors` 返回 `{block:...}`
- [ ] **Step 4: Commit** — `git commit -m "feat(recall): GET /api/recall/priors endpoint (fail-open)"`

---

### Task 5: 插件侧注入 `<agent-priors>`

**Files:**
- Create: `src/hooks/agent-priors.ts`
- Modify: `src/plugin.ts:13,130-133`（import + system.transform 链追加）

- [ ] **Step 1: 实现 hook**（镜像 user-profile.ts 的 fail-open 150ms 模式）

```typescript
// W1 常驻先验块注入：拉取 gateway 的 <agent-priors> 并追加到 system 尾部
// （在 memory-guide 与 user-profile 之后——半稳定内容靠后保前缀缓存）。
const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const PRIORS_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/recall/priors`

export async function agentPriorsSystemHook(_input: any, output: any): Promise<any> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 150)
    const res = await fetch(PRIORS_URL, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return output
    const body = await res.json() as any
    if (body?.block) {
      if (!output.system) output.system = []
      output.system.push(body.block)
    }
  } catch {
    // fail-open
  }
  return output
}
```

- [ ] **Step 2: 接线** `src/plugin.ts`：`import { agentPriorsSystemHook } from './hooks/agent-priors';` + transform 链里 `await agentPriorsSystemHook(input, output);`（userProfileSystemHook 之后）

- [ ] **Step 3: 验证** — `npm run build`（root 全量）
- [ ] **Step 4: Commit** — `git commit -m "feat(plugin): inject <agent-priors> via system.transform (fail-open 150ms)"`

---

### Task 6: W2 提升闸门（G1-G5 纯函数）

**Files:**
- Create: `gateway/src/memory/skill-promotion.ts`
- Test: `gateway/tests/unit/memory/skill-promotion.test.ts`（新建）

**Interfaces:**
- Produces: `evaluatePromotion(signals, cfg?)` / `isConsistentMapping(body)` / `DEFAULT_PROMOTION_GATES`（Task 8 扫描管线消费）

- [ ] **Step 1: 失败测试**

```typescript
import { evaluatePromotion, isConsistentMapping, DEFAULT_PROMOTION_GATES } from '../../../src/memory/skill-promotion';

describe('isConsistentMapping', () => {
  it('step-shaped body passes', () => {
    expect(isConsistentMapping('1. 改代码\n2. npm run build\n3. 写令牌\n4. 等待通知')).toBe(true);
  });
  it('conditional-heavy body fails (variable mapping stays declarative)', () => {
    expect(isConsistentMapping('如果 A 则 X，否则 Y；若 B 取决于 C，如果 D 则 Z')).toBe(false);
  });
});

describe('evaluatePromotion', () => {
  const base = { need7d: 5, energy: 0.8, body: '1. a\n2. b', verified: true, daysSinceRevision: 10, existingSkillCount: 3 };
  it('all gates pass → eligible', () => {
    expect(evaluatePromotion(base).eligible).toBe(true);
  });
  it.each([
    ['G1 热度', { need7d: 1 }],
    ['G3 未验证', { verified: false }],
    ['G4 不稳定', { daysSinceRevision: 2 }],
    ['G5 列表膨胀', { existingSkillCount: DEFAULT_PROMOTION_GATES.maxSkills }],
  ])('%s → ineligible with reason', (_n, patch) => {
    const d = evaluatePromotion({ ...base, ...patch });
    expect(d.eligible).toBe(false);
    expect(d.reasons.length).toBeGreaterThan(0);
  });
  it('G2 条件分支体 → ineligible', () => {
    expect(evaluatePromotion({ ...base, body: '如果 x 则 a 否则 b' }).eligible).toBe(false);
  });
});
```

- [ ] **Step 2: 跑红** — `cd gateway; npx jest tests/unit/memory/skill-promotion.test.ts` → FAIL

- [ ] **Step 3: 实现**

```typescript
// W2 提升闸门（脑：一致映射/练习/稳定性；业界：JIT 热点/自验证/成本不对称）。
// 全部确定性——抽象在 curator 写记忆时已完成，此处零 LLM。
export const DEFAULT_PROMOTION_GATES = {
  minNeed7d: 3,
  minEnergy: 0.5,
  minStableDays: 7,
  maxConditionals: 1,
  minSteps: 2,
  maxSkills: 30,
} as const;

export interface PromotionSignals {
  need7d: number; energy: number; body: string;
  verified: boolean; daysSinceRevision: number; existingSkillCount: number;
}

export function isConsistentMapping(body: string): boolean {
  const conditionals = (body.match(/如果|否则|取决于|\bif\b|\belse\b/g) || []).length;
  const steps = (body.match(/^\s*(\d+[.、)]|[-*]\s)/gm) || []).length;
  return conditionals <= DEFAULT_PROMOTION_GATES.maxConditionals && steps >= DEFAULT_PROMOTION_GATES.minSteps;
}

export function evaluatePromotion(
  s: PromotionSignals,
  cfg: typeof DEFAULT_PROMOTION_GATES = DEFAULT_PROMOTION_GATES,
): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (s.need7d < cfg.minNeed7d) reasons.push(`G1 need7d=${s.need7d}<${cfg.minNeed7d}`);
  if (s.energy < cfg.minEnergy) reasons.push(`G1b energy=${s.energy}<${cfg.minEnergy}`);
  if (!isConsistentMapping(s.body)) reasons.push('G2 条件分支体（可变映射保持陈述性）');
  if (!s.verified) reasons.push('G3 未验证（缺 verified: 锚点）');
  if (s.daysSinceRevision < cfg.minStableDays) reasons.push(`G4 漂移中（${s.daysSinceRevision}d<${cfg.minStableDays}d）`);
  if (s.existingSkillCount >= cfg.maxSkills) reasons.push(`G5 skill 列表已满（${s.existingSkillCount}≥${cfg.maxSkills}）`);
  return { eligible: reasons.length === 0, reasons };
}
```

- [ ] **Step 4: 绿** → **Step 5: Commit** `git commit -m "feat(memory): skill promotion gates G1-G5 (deterministic)"`

---

### Task 7: W2 渲染器（OKF → SKILL.md）

**Files:**
- Modify: `gateway/src/memory/skill-promotion.ts`（追加）
- Test: `gateway/tests/unit/memory/skill-promotion.test.ts`（追加 describe）

**Interfaces:**
- Produces: `renderSkillMd(unit): { name: string; content: string }`——name = `ms-<id 尾 6 位>`（ascii 安全）；description = primary_abstraction + 触发词（cue_anchors 前 5）

- [ ] **Step 1: 失败测试**

```typescript
import { renderSkillMd } from '../../../src/memory/skill-promotion';

it('renders OKF unit as SKILL.md (name/desc/body mapping)', () => {
  const r = renderSkillMd({
    id: 'mem_1791453253146_y3ggt9',
    primary_abstraction: 'serve sidecar 重启后必须重订事件流',
    memory_value: '1. killProcessOnPort\n2. startServe\n3. subscribeToEvents',
    cue_anchors: ['serve', 'watchdog', 'sse'],
  });
  expect(r.name).toBe('ms-y3ggt9');
  expect(r.content).toMatch(/^---\nname: ms-y3ggt9\n/);
  expect(r.content).toContain('description: serve sidecar 重启后必须重订事件流。触发词：serve / watchdog / sse');
  expect(r.content).toContain('1. killProcessOnPort');
  expect(r.content).toContain('> 物化自记忆 mem_1791453253146_y3ggt9');
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```typescript
export function renderSkillMd(unit: {
  id: string; primary_abstraction: string; memory_value: string; cue_anchors?: string[];
}): { name: string; content: string } {
  const name = `ms-${unit.id.slice(-6)}`;
  const triggers = (unit.cue_anchors ?? []).filter((a) => !a.includes(':')).slice(0, 5).join(' / ');
  const content = `---
name: ${name}
description: ${unit.primary_abstraction}。触发词：${triggers}
---

${unit.memory_value}

> 物化自记忆 ${unit.id}（记忆为索引，本文件为真相源；修订请改本文件后由 curator 回写）。
`;
  return { name, content };
}
```

- [ ] **Step 4: 绿 → Step 5: Commit** `git commit -m "feat(memory): OKF -> SKILL.md renderer (md-to-md channel)"`

---

### Task 8: W2 提升扫描管线 + automation 规则

**Files:**
- Modify: `gateway/src/memory/skill-promotion.ts`（追加 `scanPromotionCandidates`）
- Modify: `gateway/src/index.ts`（`registerMemoryPipelineActions` 内注册 `memory:skillPromotion` action）
- Modify: `gateway/src/recall/pipeline-rules.ts`（供给周规则）
- Modify: `gateway/src/recall/pipeline-heartbeat.ts`（默认间隔表加条目）
- Test: `gateway/tests/unit/memory/skill-promotion-scan.test.ts`（新建）；更新 `gateway/tests/unit/pipeline-heartbeat.test.ts` 的默认表测试

**Interfaces:**
- Consumes: Task 6 闸门 + Task 7 渲染器；`RetrievalEventBuffer.needFor`
- Produces: staging 文件 `~/.mafw/skill-staging/<name>/SKILL.md` + triage 项（`summary.skillDraft = { name, memoryId }`）

- [ ] **Step 1: 失败测试**（scan：deps 全 mock）

```typescript
import { scanPromotionCandidates } from '../../../src/memory/skill-promotion';

it('eligible procedural -> staging write + triage draft; already-materialized skipped', async () => {
  const staged: any[] = []; const triaged: any[] = [];
  const n = await scanPromotionCandidates({
    getIndex: () => ({ entries: [
      { id: 'mem_1_abcdef', type: 'procedural', energy: 0.8, updated_at: '2026-09-20T00:00:00Z', cue_anchors: [] },
      { id: 'mem_2_ghijkl', type: 'procedural', energy: 0.8, updated_at: '2026-09-20T00:00:00Z', cue_anchors: ['skill:ms-foobar'] },
    ] }),
    readUnit: async (id) => id === 'mem_1_abcdef'
      ? { id, memory_value: '1. a\n2. b\ncue verified:2026-10-01', cue_anchors: ['verified:2026-10-01'] }
      : null,
    needFor: () => 5,
    existingSkillCount: () => 2,
    writeStaging: (name, content) => staged.push({ name, content }),
    createTriageItem: (item) => triaged.push(item),
    now: new Date('2026-10-08T00:00:00Z'),
  });
  expect(n).toBe(1);
  expect(staged[0].name).toBe('ms-abcdef');
  expect(triaged[0].summary.skillDraft).toEqual({ name: 'ms-abcdef', memoryId: 'mem_1_abcdef' });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**（`scanPromotionCandidates` 遍历 index 中 type=procedural、未 superseded、无 `skill:` 锚点的条目，读全文过闸门，过了就 writeStaging + createTriageItem；全部 fail-open）

- [ ] **Step 4: index.ts 注册 action**（`registerMemoryPipelineActions` 内追加，`this.automationEngine`/`this.getGatewayDb()` 等均在手；triage 直写 `~/.mafw/triage/triage-skillpromo-<ts>.json`，state PENDING_CONFIRMATION）+ heartbeat record

- [ ] **Step 5: pipeline-rules.ts 供给** `{ id: 'skill-promotion', schedule: '0 5 * * 0', timezone: 'UTC', action: 'memory:skillPromotion' }`；**pipeline-heartbeat.ts** 默认表加 `'memory:skillPromotion': 7 * DAY` 并更新 heartbeat 默认表测试

- [ ] **Step 6: 全量绿 + build → Commit** `git commit -m "feat(memory): skill-promotion weekly pipeline (scan -> staging -> triage draft)"`

---

### Task 9: W2 安装器 + triage confirm 分支

**Files:**
- Create: `gateway/src/memory/skill-install.ts`
- Modify: `gateway/src/index.ts:4797-4830`（triage confirm 路由加 skillDraft 分支）
- Test: `gateway/tests/unit/memory/skill-install.test.ts`（新建）

**Interfaces:**
- Consumes: Task 8 的 `summary.skillDraft`；file-store `read`/`write`（指针改写）
- Produces: `installSkillDraft(draft, deps)` → 拷贝 `~/.mafw/skill-staging/<name>/` → `~/.config/opencode/skills/<name>/`；源记忆改写为指针（memory_value 加前缀 + cue_anchors 加 `skill:<name>`，同 id write 回写）

- [ ] **Step 1: 失败测试**

```typescript
import { installSkillDraft } from '../../../src/memory/skill-install';

it('installs staged skill and rewrites source memory as pointer', async () => {
  const copied: any[] = []; let written: any = null;
  const r = await installSkillDraft(
    { name: 'ms-abcdef', memoryId: 'mem_1_abcdef' },
    {
      copyDir: (src, dst) => copied.push({ src, dst }),
      readMemory: async () => ({ id: 'mem_1_abcdef', memory_value: '1. a\n2. b', cue_anchors: ['serve'] }),
      writeMemory: async (u) => { written = u; },
      stagingDir: '/stg', skillsDir: '/skills',
    },
  );
  expect(r.installed).toBe('ms-abcdef');
  expect(copied[0]).toEqual({ src: '/stg/ms-abcdef', dst: '/skills/ms-abcdef' });
  expect(written.memory_value).toContain('已物化为 skill:ms-abcdef');
  expect(written.cue_anchors).toContain('skill:ms-abcdef');
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现 skill-install.ts**（deps 注入；真实接线处 copyDir=fs.cpSync recursive、readMemory/writeMemory=HarmonicUnitFileStore）

- [ ] **Step 4: index.ts confirm 分支**（拿到 item 且 state PENDING 后、创建 goal 之前）：

```typescript
            const skillDraft = (item as any).summary?.skillDraft;
            if (skillDraft?.name && skillDraft?.memoryId) {
              const { installSkillDraft } = await import('./memory/skill-install.js');
              const r = await installSkillDraft(skillDraft, this.skillInstallDeps());
              this.automationEngine?.confirmTriage(goalId, item);
              res.end(JSON.stringify({ status: 'confirmed', installed: r.installed }));
              return;
            }
```

（`skillInstallDeps()` 为 index.ts 新方法：stagingDir=`config.resolvePath('skill-staging')`、skillsDir=`path.join(os.homedir(), '.config/opencode/skills')`、file-store read/write。）

- [ ] **Step 5: 全量绿 + `npm run build` → Commit** `git commit -m "feat(memory): skill install via triage confirm (memory becomes pointer)"`

---

### Task 10: D1b — gist 写出后源 episodes 降能

**Files:**
- Modify: `gateway/src/recall/reflection.ts`（`reflectSession` 成功蒸馏后）+ `ReflectionOptions` 加 `sourceDemoteFactor?: number`
- Test: `gateway/tests/unit/recall/reflection-category.test.ts`（追加 describe，复用同文件 fake）

- [ ] **Step 1: 失败测试**——reflectSession 成功蒸馏后对每个源 episode 调 `index.updateEnergy(id, -energy*0.3)`；无产出时**不**降能
- [ ] **Step 2: 跑红 → Step 3: 实现**

```typescript
    // D1b: gist 化后源 verbatim episodes 降能（Fuzzy-Trace：细节先死，要点存活）。
    // 降能不失联——条目仍可检索，只是在排序中让位给 gist。
    if (result.distilled > 0) {
      const factor = this.opts.sourceDemoteFactor ?? 0.3;
      for (const ep of episodes) {
        const entry = this.opts.index.getIndex().entries.find((e) => e.id === ep.id);
        if (entry) this.opts.index.updateEnergy(ep.id, -(entry.energy * factor));
      }
      try { (this.opts.index as any).save?.(); } catch { /* fail-open */ }
    }
```

- [ ] **Step 4: 绿 + 全量 → Step 5: Commit** `git commit -m "feat(reflection): demote source episodes after gist distillation (D1b, fuzzy-trace)"`

---

### Task 11: 文档收尾 + 全量门禁

- [ ] **Step 1: AGENTS.md** §5.13 后追加 W1/W2/D1b 段（先验块通道、skill 物化五闸门与 deopt、D1b 降能）
- [ ] **Step 2: 路线图勾销**——`docs/research/2026-10-08-brain-like-roadmap.md` §5 表格中 W1/W2/D1b/L2前置 标记 ✅
- [ ] **Step 3: 全量门禁**：`cd gateway; npx jest --runInBand` 全绿 + root `npm run build` exit 0
- [ ] **Step 4: Commit** `git commit -m "docs: W1/W2/D1b landed (AGENTS.md + roadmap checkoff)"`

---

## Self-Review 记录

- **spec 覆盖**：W1（Task 2-5）、W2（Task 6-9）、D1b（Task 10）、L2 前置（Task 1）✅；deopt 通道 v1 只到"supersede→回炉"（skill-install 的指针改写是单向；**降级回退路径显式留 v2**：需 skill 调用计数，轨迹里 skill 工具调用可观测但本批不接）
- **类型一致**：`renderSkillMd`/`evaluatePromotion`/`installSkillDraft` 签名跨 task 一致
- **缺口声明**：skillsDir 默认用户级 `~/.config/opencode/skills/`（项目级分流留 v2）；skill 热加载依赖 opencode 下次会话发现（不重启 gateway）
