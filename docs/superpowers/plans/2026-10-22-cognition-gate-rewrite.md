# 认知面六动词（gate/rewrite）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HostAdapter 认知面四动词→六动词——新增 gate（工具/prompt 执行前决策）与 rewrite（工具输出回模型前脱敏），声明式规则驱动（`cognition.rules` config），pi 宿主全接线，内部会话豁免 + 优先级铁律。

**Architecture:** 规则引擎纯函数（match/模板/校验/redact）→ CognitionGate 服务（进程内注入 pi，同 evaluatePermission 先例）→ pi 审批扩展 gate 步（autoDeny 后、evaluatePermission 前；rewrite 后复评）+ 宿主扩展 tool_result redact / input 门。HTTP 动词留给 out-of-process 宿主（契约面完整性）。`cognition_gate` 扁平事件（TAIL_ACCOUNTED_PREFIXES 消费，零词表改动）。

**Tech Stack:** TypeScript / jest / pi 扩展 API（tool_call block+逐键 mutation / tool_result content / input transform·handled）

**Spec:** `docs/superpowers/specs/2026-10-22-cognition-gate-rewrite-design.md`（v2，builder check 两问六修正并入）

## Global Constraints

- C1 **fail-open 全防护**：pi 的 tool_call handler 异常 = fail-CLOSED（agent-loop 自身行为）——gate 步必须自包 try/catch（异常→放行+warn）；input handler 异常 pi runner 天然吞（fail-open 免包）
- C2 **rewrite = 逐键 mutation**：`Object.assign(event.input, 规则模板插值结果)`——整体重赋值被 pi 静默丢弃；改写只影响执行参数（LLM 见原始 args、无 schema 复验——语义边界文档化）
- C3 **rewrite 后复评**：改写产物交既有权限链（改写不能绕过危险正则/身份政策）
- C4 **G6 铁律**：gate 层 allow 非终局（链继续）；deny 只会更严——用户规则无法把身份政策 deny 翻成 allow
- C5 **内部会话豁免（v2 Q1）**：`internalSessionRoles.has(sessionID)`（gateway 注册表）→ prompt 门恒放行 + HTTP 动词同查——用户规则不得拦编排/通知 prompt
- C6 **prompt+ask 加载期拒绝（v2 Q2）**：validateRules 拒绝 `on:'prompt' && action:'ask'` 条目 + error 日志 + 跳过
- C7 **redact 图片透传（builder check E）**：`applyRedact(content: Array<TextContent|ImageContent>)`——非文本部件原样透传（matplotlib/媒体防丢）
- C8 **ReDoS 护栏**：加载期正则编译测试（throw→跳过+error）；match 测试文本截 10KB
- C9 **规则现读不快照**：CognitionGate 每次求值读 `config.cognition.rules`（热重载免费——reload() 自动 diff 全段）；config defaults() 加 cognition 空段
- C10 测试基线：gateway 344 套件/2411 + SDK 140 + TUI 220 + desktop 1174 + adapter 24；中文注释文件用 write/edit 工具（CRLF）

## Review Focus

1. **内部编排 prompt 被用户规则误杀**（spec §7 裁决 8 的核心风险）：deny 规则命中 goal 节点 prompt → handled → 回合不启动 → watchdog 重试 → archive_fail。→ Task 3 测试：isInternalSession 豁免（在册 prompt 恒 continue）。
2. **gate 步异常 fail-closed brick agent**：pi agent-loop 对 handler 异常 block 执行——CognitionGate/求值任何异常必须被 gate 步吞掉。→ Task 4 测试：evaluateGate 抛错 → 放行（mock 抛错断言）。
3. **rewrite 绕过政策**：改写后的危险命令未复评直接执行。→ Task 4 测试：rewrite 后 evaluatePermission 仍被调且收到改写后 input。
4. **prompt deny 无感知消失**：handled 吞输入不进 transcript——用户输入消失必须有 cognition_gate 事件。→ Task 5 wiring 断言：deny 分支 emit。
5. **redact 丢图**：text-only 实现静默丢 ImageContent。→ Task 1 测试：混合 content 数组 redact 后 image 部件原样在场。

---

### Task 1: 规则引擎纯函数（rules.ts）

**Files:**
- Create: `gateway/src/core/cognition/rules.ts`
- Test: `gateway/tests/unit/core/cognition-rules.test.ts`

**Interfaces:**
- Consumes: `commandTextOf`（`core/approval/safety-classifier.ts` 导出，`ApprovalCandidate` 形参）；`redactSecrets`（`recall/redact.ts`，`(content: string) => string`）
- Produces:
  ```typescript
  // gateway/src/core/cognition/rules.ts
  export interface CognitionRule {
    on: 'tool_call' | 'prompt' | 'tool_result';
    tool?: string;
    match?: string;
    action: 'deny' | 'ask' | 'rewrite' | 'transform' | 'redact';
    reason?: string;
    input?: Record<string, string>;
    text?: string;
    name?: string;
  }
  export type GateDecision =
    | { decision: 'allow' }
    | { decision: 'deny'; reason?: string; rule?: string }
    | { decision: 'rewrite'; input: Record<string, unknown>; rule?: string }
    | { decision: 'ask'; reason?: string; rule?: string };
  export function validateRules(raw: unknown): { valid: CognitionRule[]; errors: string[] };
  export function ruleMatches(rule: CognitionRule, payload: { kind: CognitionRule['on']; tool?: string; text?: string }): boolean;
  export function interpolateTemplate(tpl: string, original: Record<string, unknown>): string;
  export function evaluateGateRules(rules: CognitionRule[], payload: Parameters<ruleMatches>[1] & { input?: Record<string, unknown> }): GateDecision | null;
  export function applyRedact(content: Array<{ type: string; text?: string; [k: string]: unknown }>, redact: (s: string) => string): Array<{ type: string; text?: string; [k: string]: unknown }>;
  /** prompt transform 规则求值（input 门专用——transform 不进 GateDecision 枚举，裁决见 Step 3） */
  export function evaluateTransformRule(rules: CognitionRule[], payload: { text: string }): { text: string; rule?: string } | null;
  export const MATCH_TEXT_CAP = 10_240;  // 10KB
  ```

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/core/cognition-rules.test.ts
import {
  CognitionRule, validateRules, ruleMatches, interpolateTemplate,
  evaluateGateRules, applyRedact, MATCH_TEXT_CAP,
} from '../../../../src/core/cognition/rules';

describe('validateRules（C6 prompt+ask 拒绝；C8 坏正则跳过）', () => {
  it('合法规则集通过', () => {
    const r = validateRules([
      { on: 'tool_call', tool: 'bash', match: '^docker run', action: 'rewrite', input: { command: '{{command}} --rm' }, name: 'docker-rm' },
      { on: 'prompt', match: 'deploy', action: 'deny', reason: 'no prod' },
      { on: 'tool_result', action: 'redact' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(3);
  });
  it('prompt+ask 组合被拒（C6）', () => {
    const r = validateRules([{ on: 'prompt', match: 'x', action: 'ask' }]);
    expect(r.valid).toHaveLength(0);
    expect(r.errors[0]).toMatch(/ask.*prompt|prompt.*ask/i);
  });
  it('坏正则条目跳过 + error（C8 编译期）', () => {
    const r = validateRules([{ on: 'tool_call', match: '([unclosed', action: 'deny' }]);
    expect(r.valid).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
  });
  it('非对象条目跳过', () => {
    const r = validateRules(['nonsense', null, { on: 'tool_call', action: 'deny' }]);
    expect(r.valid).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
  });
});

describe('ruleMatches（on/tool/match 三级）', () => {
  const base = { on: 'tool_call', tool: 'bash', match: 'rm -rf', action: 'deny' } as CognitionRule;
  it('on/tool/match 全中', () => {
    expect(ruleMatches(base, { kind: 'tool_call', tool: 'bash', text: 'rm -rf /tmp/x' })).toBe(true);
  });
  it('tool 不匹配 → false', () => {
    expect(ruleMatches(base, { kind: 'tool_call', tool: 'edit', text: 'rm -rf' })).toBe(false);
  });
  it('kind 不匹配 → false', () => {
    expect(ruleMatches(base, { kind: 'prompt', tool: 'bash', text: 'rm -rf' })).toBe(false);
  });
  it('match 缺省 = 只按 on/tool 过滤', () => {
    const r = { ...base, match: undefined };
    expect(ruleMatches(r, { kind: 'tool_call', tool: 'bash', text: 'anything' })).toBe(true);
  });
  it('match 文本超帽截断（C8：超长文本不整段测试）', () => {
    const r = { ...base, match: `rm -rf${'x'.repeat(MATCH_TEXT_CAP)}` };
    expect(ruleMatches(r, { kind: 'tool_call', tool: 'bash', text: 'rm -rf' })).toBe(false); // 文本侧短——规则侧超长不命中
  });
});

describe('interpolateTemplate', () => {
  it('{{field}} 插值原值；缺字段→空串', () => {
    expect(interpolateTemplate('{{command}} --rm', { command: 'docker run nginx' })).toBe('docker run nginx --rm');
    expect(interpolateTemplate('a {{missing}} b', { command: 'x' })).toBe('a  b');
  });
});

describe('evaluateGateRules（首条命中；模板用原始 input 插值）', () => {
  it('deny 命中带 reason/rule', () => {
    const d = evaluateGateRules(
      [{ on: 'tool_call', tool: 'bash', match: 'rm -rf /', action: 'deny', reason: 'destructive', name: 'no-root-wipe' }],
      { kind: 'tool_call', tool: 'bash', text: 'rm -rf /', input: { command: 'rm -rf /' } },
    )!;
    expect(d.decision).toBe('deny');
    expect((d as any).rule).toBe('no-root-wipe');
  });
  it('rewrite：input 模板插值自原始 input', () => {
    const d = evaluateGateRules(
      [{ on: 'tool_call', tool: 'bash', match: '^docker run', action: 'rewrite', input: { command: '{{command}} --rm' } }],
      { kind: 'tool_call', tool: 'bash', text: 'docker run nginx', input: { command: 'docker run nginx' } },
    )!;
    expect(d.decision).toBe('rewrite');
    expect((d as any).input).toEqual({ command: 'docker run nginx --rm' });
  });
  it('无命中 → null', () => {
    expect(evaluateGateRules([{ on: 'tool_call', action: 'deny' }], { kind: 'prompt', text: 'x' })).toBeNull();
  });
  it('transform 规则不经 evaluateGateRules（input 门单独消费 evaluateTransformRule）', () => {
    expect(evaluateGateRules([{ on: 'prompt', match: 'x', action: 'transform', text: 't' }], { kind: 'prompt', text: 'x' })).toBeNull();
  });
});

describe('applyRedact（C7 图片透传）', () => {
  it('text 部件变换、image 部件原样在场（Review Focus #5）', () => {
    const content = [
      { type: 'text', text: 'key=sk-secret123' },
      { type: 'image', data: 'base64...', mimeType: 'image/png' },
      { type: 'text', text: 'clean' },
    ];
    const out = applyRedact(content, (s) => s.replace(/sk-\w+/g, '[REDACTED]'));
    expect(out[0].text).toBe('key=[REDACTED]');
    expect(out[1]).toEqual(content[1]);  // image 原样
    expect(out[2].text).toBe('clean');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/core/cognition-rules.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `gateway/src/core/cognition/rules.ts`**

- `validateRules`：数组遍历；条目非对象/on 非法/action 非法→error 跳过；`on:'prompt'&&action:'ask'`→error 跳过；`match` 存在时 `new RegExp(match)` try/catch（throw→error 跳过）
- `ruleMatches`：`rule.on === payload.kind` &&（`!rule.tool || rule.tool === payload.tool`）&&（`!rule.match || new RegExp(rule.match).test((payload.text ?? '').slice(0, MATCH_TEXT_CAP))`）
- `interpolateTemplate`：`tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(original[k] ?? ''))`
- `evaluateGateRules`：找首条 `ruleMatches` 命中；deny→`{decision:'deny', reason, rule: name}`；ask→同；rewrite→`{decision:'rewrite', input: Object.fromEntries(Object.entries(rule.input ?? {}).map(([k, tpl]) => [k, interpolateTemplate(tpl, payload.input ?? {})])), rule: name}`；transform 规则只在 prompt 求值时映射为 rewrite（`input: { text: interpolateTemplate(rule.text, { text: payload.text }) }`，宿主侧解包）——**裁决**：transform 不进 GateDecision 枚举（pi input handler 直接消费 transform 形状，见 Task 4），evaluateGateRules 只处理 deny/ask/rewrite；`evaluateTransformRule(rules, payload): { text: string } | null` 单独导出供 input 门
- `applyRedact`：map——`type==='text' && typeof text==='string'` → `{...p, text: redact(text)}`，其余原样返回

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/core/cognition-rules.test.ts`
Expected: PASS 全绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/cognition/rules.ts gateway/tests/unit/core/cognition-rules.test.ts
git commit -m "feat(cognition): declarative rule engine - validate (prompt+ask rejected, bad regex skipped), three-tier match with 10KB cap, template interpolation, gate decisions, image-passthrough redact"
```

---

### Task 2: CognitionGate 服务 + config 段

**Files:**
- Create: `gateway/src/core/cognition/cognition-gate.ts`
- Modify: `gateway/src/config.ts`（GatewayConfig 接口 + defaults + getter：`cognition: { rules: CognitionRule[] }`，默认 `{ rules: [] }`）
- Test: `gateway/tests/unit/core/cognition-gate.test.ts`

**Interfaces:**
- Consumes: Task 1 全部导出
- Produces:
  ```typescript
  // gateway/src/core/cognition/cognition-gate.ts
  export interface CognitionGateDeps {
    getRules: () => CognitionRule[];                       // 现读（C9）——index 注入 () => validateRules(config.cognition.rules).valid（缓存：按引用比较）
    isInternalSession: (sessionID: string) => boolean;     // C5 豁免
    onEvent?: (e: { sessionID: string; rule?: string; action: string; tool?: string; reason?: string }) => void;  // cognition_gate 可观测
  }
  export function createCognitionGate(deps: CognitionGateDeps): {
    gateToolCall(sessionID: string, payload: { tool: string; input: Record<string, unknown> }): GateDecision | null;
    gatePrompt(sessionID: string, text: string): { decision: 'allow' } | { decision: 'deny'; reason?: string; rule?: string } | { decision: 'transform'; text: string; rule?: string };
    applyToolResultRedact(sessionID: string, tool: string, content: Array<{ type: string; text?: string; [k: string]: unknown }>): Array<{ type: string; text?: string; [k: string]: unknown }>;
  }
  ```
  （三个方法全同步、全 try/catch fail-open——gateToolCall/gatePrompt 异常返 null/{decision:'allow'}，redact 异常返原 content）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/core/cognition-gate.test.ts
import { createCognitionGate } from '../../../../src/core/cognition/cognition-gate';
import { CognitionRule } from '../../../../src/core/cognition/rules';

function makeGate(rules: CognitionRule[], internal: string[] = []) {
  let src = rules;
  const events: any[] = [];
  const gate = createCognitionGate({
    getRules: () => src,
    isInternalSession: (sid) => internal.includes(sid),
    onEvent: (e) => events.push(e),
  });
  return { gate, events, setRules: (r: CognitionRule[]) => { src = r; } };
}

describe('CognitionGate（spec §5.3；C5 豁免）', () => {
  it('gateToolCall：deny 命中 + cognition_gate 事件', () => {
    const { gate, events } = makeGate([{ on: 'tool_call', tool: 'bash', match: 'rm -rf /', action: 'deny', reason: 'destructive', name: 'no-root-wipe' }]);
    const d = gate.gateToolCall('s_user', { tool: 'bash', input: { command: 'rm -rf /' } })!;
    expect(d.decision).toBe('deny');
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('deny');
    expect(events[0].rule).toBe('no-root-wipe');
  });
  it('gateToolCall：rewrite 输出插值 input', () => {
    const { gate } = makeGate([{ on: 'tool_call', tool: 'bash', match: '^docker run', action: 'rewrite', input: { command: '{{command}} --rm' } }]);
    const d = gate.gateToolCall('s_user', { tool: 'bash', input: { command: 'docker run nginx' } })!;
    expect(d.decision).toBe('rewrite');
    expect((d as any).input.command).toBe('docker run nginx --rm');
  });
  it('gatePrompt：内部会话恒 allow（C5/Review Focus #1）', () => {
    const { gate, events } = makeGate([{ on: 'prompt', match: 'deploy', action: 'deny' }], ['s_goal_node']);
    expect(gate.gatePrompt('s_goal_node', 'deploy to prod')).toEqual({ decision: 'allow' });
    expect(events).toHaveLength(0);  // 豁免不是事件
  });
  it('gatePrompt：用户会话 deny + transform', () => {
    const { gate } = makeGate([
      { on: 'prompt', match: 'deploy', action: 'deny', reason: 'needs goal' },
      { on: 'prompt', match: '^TODO:', action: 'transform', text: '{{text}}\n(queued)' },
    ]);
    const d = gate.gatePrompt('s_user', 'deploy prod');
    expect(d.decision).toBe('deny');
    const t = gate.gatePrompt('s_user', 'TODO: fix');
    expect(t.decision).toBe('transform');
    expect((t as any).text).toBe('TODO: fix\n(queued)');
  });
  it('gatePrompt：内部豁免不依赖规则集（空规则同豁免）', () => {
    const { gate } = makeGate([], ['s_manager']);
    expect(gate.gatePrompt('s_manager', 'anything')).toEqual({ decision: 'allow' });
  });
  it('gateToolCall：异常 fail-open 返 null（Review Focus #2 的服务层半）', () => {
    const gate = createCognitionGate({ getRules: () => { throw new Error('boom'); }, isInternalSession: () => false });
    expect(gate.gateToolCall('s', { tool: 'bash', input: {} })).toBeNull();
    expect(gate.gatePrompt('s', 'x')).toEqual({ decision: 'allow' });
  });
  it('applyToolResultRedact：命中 on:tool_result 规则才变换', () => {
    const { gate } = makeGate([{ on: 'tool_result', tool: 'bash', action: 'redact' }]);
    const out = gate.applyToolResultRedact('s_user', 'bash', [{ type: 'text', text: 'sk-abc' }]);
    expect(out[0].text).toBe('[REDACTED]');
    const untouched = gate.applyToolResultRedact('s_user', 'edit', [{ type: 'text', text: 'sk-abc' }]);
    expect(untouched[0].text).toBe('sk-abc');  // tool 不匹配——原样
  });
  it('规则现读：getRules 每次调用（热重载语义）', () => {
    const { gate, setRules } = makeGate([]);
    expect(gate.gatePrompt('s_user', 'deploy')).toEqual({ decision: 'allow' });
    setRules([{ on: 'prompt', match: 'deploy', action: 'deny' }]);
    expect(gate.gatePrompt('s_user', 'deploy').decision).toBe('deny');
  });
});
```

（redact 测试假定注入 redactSecrets 的行为——`sk-abc`→`[REDACTED]`；cognition-gate 构造 deps 增可选 `redact?: (s: string) => string` 默认 redactSecrets，测试可注入简单实现。**签名修正**：`CognitionGateDeps` 增 `redact?`。）

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/core/cognition/cognition-gate.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

- `createCognitionGate`：三方法全 try/catch；gatePrompt 先 `isInternalSession` 豁免（C5）；gateToolCall 的主文本 = `commandTextOf({ toolName, patterns: [], metadata: { args: input } }) ?? ''`；onEvent 在 deny/rewrite/transform 命中时发（allow/无命中不发）
- `config.ts`：接口 `cognition?: { rules?: unknown[] }`（宽松——validate 是权威）；defaults `cognition: { rules: [] }`；`get cognition()`；**规则解析缓存在 getRules 注入侧**（index.ts：`() => { const raw = config.cognition?.rules; if (raw === lastRaw) return lastValid; ... }`——引用比较，热重载换引用即失效）

- [ ] **Step 4: 运行确认通过**

Run: `cd gateway && npx jest tests/unit/core/cognition --silent`
Expected: 两套件全绿

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/cognition/cognition-gate.ts gateway/src/config.ts gateway/tests/unit/core/cognition-gate.test.ts
git commit -m "feat(cognition): CognitionGate service - internal-session prompt exemption, fail-open all-paths, live rule reads, observable events"
```

---

### Task 3: HTTP 动词 + route-catalog + 可观测接线

**Files:**
- Create: `gateway/src/routes/cognition.ts`
- Modify: `gateway/src/index.ts`（路由注册 + CognitionGate 实例 + cognition_gate broadcast + wirePiCognition 注入函数）
- Modify: `gateway/src/routes/route-catalog.ts`（3 行）+ SDK 契约重生成
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts:121`（`TAIL_ACCOUNTED_PREFIXES = ["plugin:", "cognition:"]`）
- Test: `gateway/tests/unit/runtime/cognition-http-wiring.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 `createCognitionGate`
- Produces:
  - 路由（deps 注入可单测，routes/cognition.ts）：`POST /api/cognition/gate`（body `{sessionID, kind, tool?, input?, text?}` → decision JSON；内部会话 kind:prompt 恒 allow——服务层已保证）；`POST /api/cognition/rewrite`（body `{sessionID, tool, input, output:{content,isError?}}` → 变换后 content）；`GET /api/cognition/rules`（validateRules 后的 valid 清单 + errors）
  - index.ts：`private cognitionGate = createCognitionGate({...})`（getRules 缓存注入 / isInternalSession: `(sid) => this.internalSessionRoles.has(sid)` / onEvent → `this.broadcast({ type: 'cognition_gate', sessionID, ...e })` 扁平直发）；`function wirePiCognition(runtime, gate)`（registry.setCognitionGate 通道——Task 4 在 pi-session 加）
  - cognition_gate 事件：**扁平 `{ type: 'cognition_gate', sessionID, rule?, action, tool?, reason? }`**（无 mafwBroadcast 信封——`runtime_switched` 扁平先例；经 broadcast 自动进 event_log）

- [ ] **Step 1: 写失败测试（wiring + 路由单测）**

```typescript
// gateway/tests/unit/runtime/cognition-http-wiring.test.ts
// 路由单测（deps 注入模式，参考 routes/ 域内既有测试）：
import { handleCognitionGate } from '../../../src/routes/cognition';

describe('POST /api/cognition/gate 路由（deps 注入）', () => {
  it('tool_call 载荷 → decision 透传', async () => {
    const res: any = { statusCode: 0, body: null, writeHead(c: number) { this.statusCode = c; return this; }, end(b: string) { this.body = JSON.parse(b); } };
    await handleCognitionGate({
      body: { sessionID: 's1', kind: 'tool_call', tool: 'bash', input: { command: 'rm -rf /' } },
      gate: { gateToolCall: () => ({ decision: 'deny', reason: 'destructive' }), gatePrompt: () => ({ decision: 'allow' }) } as any,
      res,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.decision).toBe('deny');
  });
  it('坏 kind → 400', async () => {
    const res: any = { statusCode: 0, writeHead(c: number) { this.statusCode = c; return this; }, end() {} };
    await handleCognitionGate({ body: { sessionID: 's', kind: 'bogus' }, gate: {} as any, res });
    expect(res.statusCode).toBe(400);
  });
});

// wiring 断言（index.ts 巨类源码模式）：
import { readFileSync } from 'fs';
import { join } from 'path';
const src = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');
describe('index.ts cognition 接线', () => {
  it('CognitionGate 实例 + isInternalSession 接 internalSessionRoles（C5）', () => {
    expect(src).toMatch(/createCognitionGate\(/);
    expect(src).toMatch(/internalSessionRoles\.has/);
  });
  it('cognition_gate 扁平事件经 broadcast（Review Focus #4）', () => {
    expect(src).toMatch(/type: 'cognition_gate'/);
  });
  it('HTTP 动词注册 + loopback 门', () => {
    expect(src).toMatch(/\/api\/cognition\/gate/);
  });
});
// desktop：TAIL_ACCOUNTED_PREFIXES 含 cognition:
const desktopSrc = readFileSync(join(__dirname, '../../../../packages/desktop/src/renderer/mafw/session-events.ts'), 'utf8');
describe('desktop cognition_gate 消费（builder check D 裁定）', () => {
  it('TAIL_ACCOUNTED_PREFIXES 含 cognition: 前缀', () => {
    expect(desktopSrc).toMatch(/TAIL_ACCOUNTED_PREFIXES = \["plugin:", "cognition:"\]/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/cognition-http-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

1. `routes/cognition.ts`：`handleCognitionGate(deps)` / `handleCognitionRewrite(deps)` / `handleCognitionRules(deps)`——纯 deps 注入（gate + res + body）；gate 路由 kind 校验（`tool_call|prompt`，bogus 400）；rewrite 路由调 `gate.applyToolResultRedact` 后返回 `{ content }`
2. `index.ts`：cognitionGate 实例（getRules 引用比较缓存——`let lastRaw: unknown; let lastValid: CognitionRule[] = [];`）+ 三路由（`/api/cognition*` 匹配在既有 api 路由区，loopback 门复用 `isLoopback` 检查模式）+ `onEvent` → `this.broadcast({ type: 'cognition_gate', sessionID: e.sessionID, rule: e.rule, action: e.action, tool: e.tool, reason: e.reason })`
3. `route-catalog.ts` 3 行（gate POST / rewrite POST / rules GET）+ `npm run emit:openapi` + SDK `npm run gen:api` + SDK client 三方法（`cognition.gate/rewrite/rules`——契约死路由守卫会强制）
4. desktop `session-events.ts`：`TAIL_ACCOUNTED_PREFIXES = ["plugin:", "cognition:"]`
5. （HTTP 契约文档注释：decision 枚举含 ask 但 v1 仅 tool_call 产出——C6 的契约面）

- [ ] **Step 4: 运行确认通过 + 契约绿**

Run: `cd gateway && npx jest tests/unit/runtime/cognition-http-wiring.test.ts tests/unit/api-contract.test.ts --silent && npx tsc --noEmit`
Expected: PASS + 契约绿 + tsc 干净

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/cognition.ts gateway/src/index.ts gateway/src/routes/route-catalog.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts packages/desktop/src/renderer/mafw/session-events.ts gateway/tests/unit/runtime/cognition-http-wiring.test.ts
git commit -m "feat(cognition): HTTP verbs (gate/rewrite/rules) + cognition_gate flat event (broadcast→event_log) + SDK client + desktop cognition: prefix consumption"
```

---

### Task 4: pi 全接线（审批扩展 gate 步 + 宿主扩展两钩）

**Files:**
- Modify: `gateway/src/runtime/pi/pi-session.ts`（`PiSessionRegistryOptions` 增 `evaluateGate?` + `setCognitionGate` 方法——setPermissionEvaluator 同款）
- Modify: `gateway/src/runtime/pi/pi-approval-extension.ts`（gate 步插入 2 与 3 之间；第 7 参 `evaluateGate?`）
- Modify: `gateway/src/runtime/pi/pi-mafw-host-extension.ts`（tool_result redact 前置 + input 门新注册；`MafwHostDeps` 增 `evaluateGate?` / `gatePrompt?` / `applyRedact?`——统一为 `cognition?: { gateToolCall, gatePrompt, applyToolResultRedact }` deps 对象）
- Modify: `gateway/src/index.ts`（`wirePiCognition`——三处 runtime 接线点跟随 wirePiPermissionEvaluator；宿主扩展 deps 传递——找 createMafwHostExtension 的调用点补 cognition）
- Test: `gateway/tests/unit/runtime/pi-cognition.test.ts`（新建）

**Interfaces:**
- Consumes: Task 2 `createCognitionGate` 返回形状；Task 3 wirePiCognition
- Produces:
  - `PiSessionRegistryOptions.evaluateGate?: (sessionID: string, payload: { tool: string; input: Record<string, unknown> }) => GateDecision | null` + `setCognitionGate(fn)`（pi-session.ts）
  - 审批扩展 gate 步语义（C1/C2/C3/C4）：
    ```
    2.5 evaluateGate? —— try/catch 全包（C1：异常→undefined 继续链 + warn）
        deny   → return { block: true, reason }
        rewrite → Object.assign(event.input, d.input)（C2 逐键）→ 不 return（复评 C3）
        ask    → 落到 4（human）
        allow/null → 继续 3
    ```
  - 宿主扩展：`tool_result` 钩先 `cognition.applyToolResultRedact(sessionID, toolName, event.content)`（有变换才原地替换 `event.content`）→ 既有 observe；`input` 钩（新）：`cognition.gatePrompt`（内部豁免在服务层）→ deny→`{action:'handled'}`、transform→`{action:'transform', text}`、allow→`{action:'continue'}`；无 cognition deps → 两钩零行为（向后兼容——不传 cognition 的既有测试/调用方不破）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime/pi-cognition.test.ts
import { createMafwApprovalExtension } from '../../../src/runtime/pi/pi-approval-extension';
import { createMafwHostExtension } from '../../../src/runtime/pi/pi-mafw-host-extension';
import { GateDecision } from '../../../src/core/cognition/rules';

function fakeEmitter() {
  const handlers: Record<string, Function> = {};
  return { on: (n: string, fn: Function) => { handlers[n] = fn; }, handlers };
}

describe('审批扩展 gate 步（C1-C4；Review Focus #2/#3）', () => {
  function setup(evaluateGate?: Function, evaluatePermission?: Function) {
    const calls: string[] = [];
    const emit: any[] = [];
    const ext = createMafwApprovalExtension(
      { ask: async () => ({ decision: 'once' }) } as any,   // bridge
      (e: any) => emit.push(e),
      { autoApprove: [], autoDeny: [] },
      'ses_gateway',
      evaluatePermission as any,
      evaluateGate as any,                                    // 第 6 参（新）
    );
    const em = fakeEmitter();
    ext.on(em as any);
    return { handler: em.handlers['tool_call'], calls, emit };
  }
  it('规则 deny → block 且不走政策链（C4：更严终局）', async () => {
    const { handler } = setup(
      () => ({ decision: 'deny', reason: 'no-root-wipe' }) as GateDecision,
      () => { throw new Error('policy should not run after deny'); },
    );
    const ev = { toolName: 'bash', input: { command: 'rm -rf /' } };
    const r = await handler(ev, {});
    expect(r).toEqual({ block: true, reason: 'no-root-wipe' });
  });
  it('规则 rewrite → 逐键改 input 且继续政策链复评（C2/C3/Review Focus #3）', async () => {
    const seen: any[] = [];
    const { handler } = setup(
      () => ({ decision: 'rewrite', input: { command: 'docker run nginx --rm' } }) as GateDecision,
      (_sid: string, c: any) => { seen.push(c); return null; },
    );
    const ev = { toolName: 'bash', input: { command: 'docker run nginx' } };
    const r = await handler(ev, {});
    expect(r).toBeUndefined();                              // 未 block
    expect(ev.input.command).toBe('docker run nginx --rm'); // 原地改
    expect(seen[0].metadata.args.command).toBe('docker run nginx --rm'); // 政策收到改写后
  });
  it('规则 ask → 跳过政策直落 human（emit permission.asked）', async () => {
    const { handler, emit } = setup(() => ({ decision: 'ask' }) as GateDecision);
    await handler({ toolName: 'bash', input: {} }, {});
    expect(emit[0]?.payload?.type).toBe('permission.asked');
  });
  it('gate 步异常 → 放行继续链（C1/Review Focus #2：pi fail-CLOSED 被我方包裹）', async () => {
    let policyRan = false;
    const { handler } = setup(
      () => { throw new Error('gate boom'); },
      () => { policyRan = true; return null; },
    );
    const r = await handler({ toolName: 'bash', input: {} }, {});
    expect(r).toBeUndefined();
    expect(policyRan).toBe(true);
  });
  it('无 evaluateGate 注入 → 行为与现状一致（既有调用方零破坏）', async () => {
    const { handler } = setup(undefined, () => null);
    const r = await handler({ toolName: 'bash', input: {} }, {});
    expect(r).toBeUndefined();
  });
});

describe('宿主扩展 input/tool_result 钩', () => {
  function makeHost(cognition?: any) {
    const ext = createMafwHostExtension({
      sessionId: 's1', baseUrl: 'http://x',
      cognition,
    } as any);
    const em = fakeEmitter();
    ext.on(em as any);
    return em.handlers;
  }
  it('input：deny → handled；transform → 插值；allow → continue', async () => {
    const h = makeHost({
      gatePrompt: (_sid: string, text: string) =>
        text === 'deploy' ? { decision: 'deny', reason: 'needs goal' }
        : text.startsWith('TODO') ? { decision: 'transform', text: text + '\n(q)' }
        : { decision: 'allow' },
    });
    expect(await h['input']({ text: 'deploy' }, {})).toEqual({ action: 'handled' });
    expect(await h['input']({ text: 'TODO: x' }, {})).toEqual({ action: 'transform', text: 'TODO: x\n(q)' });
    expect(await h['input']({ text: 'hello' }, {})).toEqual({ action: 'continue' });
  });
  it('input：无 cognition deps → continue（向后兼容）', async () => {
    const h = makeHost(undefined);
    expect(await h['input']({ text: 'x' }, {})).toEqual({ action: 'continue' });
  });
  it('tool_result：redact 变换 content 后 observe；非文本透传（C7）', async () => {
    const observed: any[] = [];
    const h = makeHost({
      applyToolResultRedact: (_s: string, _t: string, content: any[]) =>
        content.map((c: any) => c.type === 'text' ? { ...c, text: c.text.replace(/sk-\w+/, '[R]') } : c),
      observeHook: undefined,
    });
    // host extension 内部 client.observe 走 HTTP——测试经 fetchImpl mock 捕获
    // 简化：直接断言 input handler 存在 + tool_result handler 变换行为经事件对象
    const ev = {
      toolName: 'bash', iserror: false, content: [
        { type: 'text', text: 'sk-abc' },
        { type: 'image', data: 'x' },
      ],
    };
    await h['tool_result'](ev, {});
    expect(ev.content[0].text).toBe('[R]');   // 原地变换
    expect(ev.content[1]).toEqual({ type: 'image', data: 'x' }); // 透传
  });
});
```

（tool_result 测试假设 redact 在 observe **之前**原地改 event.content——实现按此；observe 的 HTTP 调用经 fetchImpl stub 吞掉。）

- [ ] **Step 2: 运行确认失败**

Run: `cd gateway && npx jest tests/unit/runtime/pi-cognition.test.ts`
Expected: FAIL（第 6 参/钩不存在）

- [ ] **Step 3: 实现**

1. `pi-session.ts`：`PiSessionRegistryOptions` 增 `evaluateGate?`；`setCognitionGate(fn)` 方法（setPermissionEvaluator 同款赋 opts）
2. `pi-approval-extension.ts`：`createMafwApprovalExtension` 第 6 参 `evaluateGate?`；2.5 步全 try/catch（warn 一次/次）；deny→`return {block:true, reason: d.reason}`；rewrite→`Object.assign(event.input, d.input)` 不 return；ask→break 到 4（实现为跳过 3 的标志或提前 fallthrough——直接 `if (d.decision === 'ask') { /* fall to human */ }` 结构编排）；allow/null→继续
3. `pi-mafw-host-extension.ts`：`MafwHostDeps` 增 `cognition?: { gatePrompt; applyToolResultRedact }`（gateToolCall 由审批扩展走 registry opts，不经宿主 deps——两条通道分工）；`pi.on('input')` 新注册（cognition 缺省→恒 continue）；`pi.on('tool_result')` 既有 handler 前置 redact（`const red = deps.cognition?.applyToolResultRedact?.(sessionId, event.toolName, event.content); if (red && red !== event.content) event.content = red;`）→ observe 继续用变换后 content
4. `index.ts`：`wirePiCognition(runtime, this.cognitionGate)`（registry.setCognitionGate 通道——三处 wirePiPermissionEvaluator 跟随）+ 宿主扩展调用点补 cognition deps（`gatePrompt: (sid, t) => this.cognitionGate.gatePrompt(sid, t)` / `applyToolResultRedact: (sid, t, c) => this.cognitionGate.applyToolResultRedact(sid, t, c)`）——找 pi-session.ts 或 pi-runtime 插件文件里 createMafwHostExtension 的调用处

- [ ] **Step 4: 运行确认通过 + pi 域回归**

Run: `cd gateway && npx jest tests/unit/runtime/pi-cognition.test.ts tests/unit/runtime --silent 2>&1 | Select-String "Tests:"`
Expected: 新测试 PASS + runtime 套件全绿（既有 pi 测试不破——cognition 全可选）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pi/pi-session.ts gateway/src/runtime/pi/pi-approval-extension.ts gateway/src/runtime/pi/pi-mafw-host-extension.ts gateway/src/index.ts gateway/tests/unit/runtime/pi-cognition.test.ts
git commit -m "feat(cognition): pi full wiring - approval-ext gate step (deny/rewrite+re-eval/ask, self-guarded fail-open), host-ext input gate + tool_result redact, registry setCognitionGate channel"
```

---

### Task 5: 全量回归收口

**Files:** 无新文件（验证任务）

- [ ] **Step 1: gateway 全量 + tsc**

Run: `cd gateway && npx jest 2>&1 | Select-String "Test Suites:|Tests:"` → ≥349 套件全绿（344 基线 + 5 新）
Run: `cd gateway && npx tsc --noEmit` → 干净

- [ ] **Step 2: 其余四套**

Run:
```
cd packages/gateway-sdk && npm run build && npm test   # 契约 + client 全绿
cd packages/desktop && npm run typecheck && npm test   # typecheck（TAIL 前缀改动）+ 1174
cd packages/tui && node --test "tests/*.test.ts"       # 220
cd adapters/claude && npm test                          # 24
```

- [ ] **Step 3: 汇总 commit（如无遗留改动则空跑）**

```bash
git status --short   # 应干净（全部改动已在前四任务提交）
```

---

## 收口（执行者完成全部任务后）

1. 汇总：新增测试数 / 五套全量数（对照 C10 基线）
2. `cd gateway && npx tsc --noEmit` 必须干净
3. 向用户汇报：交付内容表 + 测试计数 + commit 列表
