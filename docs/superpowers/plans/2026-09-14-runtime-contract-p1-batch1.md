# Runtime 契约 P1 批次 1 实施计划：Approval 三值化、Delivery 语义、Structured Output、Session 媒体附件

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P1 spec（2026-09-14-runtime-contract-p1-batch-design.md）批次 1 的契约层四项：A permission 三值化+question 通道、B delivery/expectReply、C completion responseFormat、F session 媒体附件。

**Architecture:** 契约面先行（直接改 `permissionReply` 签名，破坏性，编译器兜底两实现），opencode 走 v2 SDK 原生三值/question 端点，pi 经 ApprovalBridge decision 化 + 动态 allowlist；媒体经 `mafw-media` extension 在 `before_provider_request` 改写 wire（复用 `fixMediaPayload`）。

**Tech Stack:** TypeScript (CJS)、Jest（`npm test --prefix gateway`，--runInBand）、@opencode-ai/sdk v2（`client.session.permission.reply` / `client.session.question.*`，扁平参数）、pi extension 机制。

**Spec:** `docs/superpowers/specs/2026-09-14-runtime-contract-p1-batch-design.md`

## Global Constraints

- gateway CJS；import pi 只能 ESM 桥。
- **新增/未跟踪文件必须立即随所在 task commit**（工作流约束 mem_vo49u7，不留未跟踪文件）。
- mock 直接风格（P0 教训 mem_erhk9q）：不套 `{data:...}` 信封。
- `@opencode-ai/sdk/v2` 在 jest 中经 moduleNameMapper 解析到 stub（P0 已配），测试内 `jest.mock` 工厂接管。
- `expectReply=false` 在 pi 全路径降级 + 每会话单次 warn（已拍板，不建队列）。
- pi `'always'` = 运行时 push `policy.autoApprove`（session 级、不落盘）。
- C 的 responseFormat：pi fail-open 忽略；契约注释与 `cacheable` 哲学一致。
- HTTP 路由正则兼容 query string：`(?:\?|$)`。
- 每个 task：失败测试 → 实现 → 通过 → commit（新文件同 commit）。

---

### Task 1: 契约面扩展 + 既有测试连带修复

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Modify: `gateway/tests/unit/runtime/contract.test.ts`
- Modify: `gateway/tests/unit/runtime/opencode-runtime.test.ts`（fullCapabilities 断言连带）

**Interfaces（后续任务依赖）:**
- `permissionReply(sessionID, requestId, reply: 'once'|'always'|'reject', message?: string): Promise<boolean>`
- `RuntimeCapabilities.questionApi?: boolean`（fullCapabilities=true / minimal=false）
- `session.question?: { list/reply/reject }`（可选）
- `SessionPromptOpts.delivery?: 'steer'|'followup'`、`expectReply?: boolean`；`noReply` 标 @deprecated
- `CompletionRequest.responseFormat?: { type:'json_schema'; name; schema; strict? }`

- [ ] **Step 1: 写失败测试**（contract.test.ts 追加）

```ts
  it('fullCapabilities declares questionApi', () => {
    expect(fullCapabilities().questionApi).toBe(true);
    expect(minimalCapabilities().questionApi).toBe(false);
  });

  it('SessionPromptOpts supports delivery and expectReply', () => {
    const opts: SessionPromptOpts = {
      sessionID: 's1',
      delivery: 'steer',
      expectReply: false,
    };
    expect(opts.delivery).toBe('steer');
    expect(opts.expectReply).toBe(false);
  });

  it('CompletionRequest supports responseFormat json_schema', () => {
    const req: CompletionRequest = {
      model: { providerID: 'p', modelID: 'm' },
      user: [{ type: 'text', text: 'q' }],
      responseFormat: { type: 'json_schema', name: 'verdict', schema: { type: 'object' }, strict: true },
    };
    expect(req.responseFormat?.type).toBe('json_schema');
  });
```

顶部 import 补 `SessionPromptOpts`。既有 fullCapabilities/minimalCapabilities 的 `toEqual` 对象加 `questionApi: true/false`。opencode-runtime.test.ts 的 capabilities `toEqual` 加 `questionApi: true`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- contract opencode-runtime`
Expected: FAIL（questionApi undefined / toEqual 差异）

- [ ] **Step 3: 实现 contract.ts**

`RuntimeCapabilities` 追加：

```ts
  /** runtime 提供原生 question API（question.list/reply/reject） */
  questionApi?: boolean;
```

fullCapabilities 加 `questionApi: true,`；minimalCapabilities 加 `questionApi: false,`。

`permissionReply` 签名替换：

```ts
    /** 回复权限请求。'once'=仅本次放行；'always'=放行并持久化规则（opencode 原生规则 /
     *  pi session 级动态 allowlist）；'reject'=拒绝。message 为给 agent 的可选说明。 */
    permissionReply(
      sessionID: string,
      requestId: string,
      reply: 'once' | 'always' | 'reject',
      message?: string,
    ): Promise<boolean>;
```

`session` 接口 `unrevert` 之后追加：

```ts
    /** 原生 question 通道（questionApi 能力）。opencode 实现；pi 无 question API 不实现。 */
    question?: {
      list(opts?: { directory?: string }): Promise<any[]>;
      reply(opts: { requestID: string; answers: Array<Record<string, unknown>> }): Promise<void>;
      reject(opts: { requestID: string }): Promise<void>;
    };
```

`SessionPromptOpts` 的 `noReply` 上方加 `@deprecated` 注释与两个新字段：

```ts
  /** busy 会话的消息投递时机：'steer'=当前工具批后送达（纠偏），'followup'=全部完成后。
   *  opencode 无原生概念（忽略声明）；pi 映射 streamingBehavior（busy 时生效）。 */
  delivery?: 'steer' | 'followup';
  /** 期望本条消息触发 LLM 回复。false = 落历史免回复（opencode noReply 语义）。
   *  pi 无原生等价——全路径降级为普通消息（busy 时 followUp），每会话 warn 一次。 */
  expectReply?: boolean;
  /** @deprecated 用 expectReply: false 替代；消费方迁移完成后删除 */
  noReply?: boolean;
```

`CompletionRequest` 追加：

```ts
  /** 约束输出为 JSON Schema。实现方映射到自己 provider 的机制（OpenAI response_format）；
   *  映射不了则忽略（fail-open）——结果仍可能非 JSON，消费方自解析兜底。 */
  responseFormat?: {
    type: 'json_schema';
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
```

`SessionPromptOpts.parts` 字段加语义注释：

```ts
  /** 消息部件。{type:'file', url, mime?, filename?} 为一等媒体附件载体（dataURL 或
   *  工件引用），mime 决定模态（image/video/audio）——runtime 必须作为多模态输入
   *  递给模型，不得文本拍平丢弃。 */
  parts?: Array<{ type: string; text?: string; [k: string]: any }>;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- contract opencode-runtime`
Expected: PASS（此时 pi-runtime.ts 的 `permissionReply` 实现签名不符会**编译失败**——ts-jest diagnostics 关闭可跑，但为让 CI 干净，本步允许先在 pi-runtime.ts:146-147 做最小签名适配 `(sessionID, requestId, reply, message?) => registry.permissionReply(sessionID, requestId, reply === 'reject' ? false : true, message)`，Task 2 再真实现）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/tests/unit/runtime/contract.test.ts gateway/tests/unit/runtime/opencode-runtime.test.ts
git commit -m "feat(runtime): contract P1 — permissionReply tri-state, questionApi, delivery/expectReply, responseFormat"
```

---

### Task 2: pi ApprovalBridge 三值化 + always 动态 allowlist

**Files:**
- Modify: `gateway/src/runtime/pi/pi-approval-bridge.ts`
- Modify: `gateway/src/runtime/pi/pi-approval-extension.ts`
- Modify: `gateway/src/runtime/pi/pi-session.ts`（registry.permissionReply 透传）
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（真实现）
- Test: `gateway/tests/unit/runtime/pi-approval-bridge.test.ts`（追加）、`gateway/tests/unit/runtime/pi-approval-extension.test.ts`（追加）；既有 gateway-permission.test.ts / pi-*.test.ts 连带修

**Interfaces:**
- `bridge.reply(requestId, decision: 'once'|'always'|'reject', message?): boolean`
- `bridge.lastDecision(requestId): { decision, message? } | null`（extension 回查用）
- extension：`always` → `policy.autoApprove.push(toolName)`；`reject` 的 message 进 block reason

- [ ] **Step 1: 写失败测试**

`pi-approval-bridge.test.ts` 追加：

```ts
  it('reply stores decision + message for always/reject', () => {
    const bridge = new ApprovalBridge();
    const p1 = bridge.request('r1');
    expect(bridge.reply('r1', 'always')).toBe(true);
    expect(bridge.lastDecision('r1')).toEqual({ decision: 'always', message: undefined });
    const p2 = bridge.request('r2');
    bridge.reply('r2', 'reject', 'too risky');
    expect(bridge.lastDecision('r2')).toEqual({ decision: 'reject', message: 'too risky' });
  });

  it('bool-style reply still resolves (legacy callers)', () => {
    const bridge = new ApprovalBridge();
    const p = bridge.request('r3');
    expect(bridge.reply('r3', true as any)).toBe(true);
    expect(bridge.lastDecision('r3')?.decision).toBe('once');
  });
```

`pi-approval-extension.test.ts` 追加（按该文件既有 fake emitter/policy 风格适配）：

```ts
  it('always decision pushes tool into policy.autoApprove (session-level allowlist)', async () => {
    const policy = { autoApprove: ['read'], autoDeny: [] };
    const bridge = new ApprovalBridge();
    const emitted: any[] = [];
    const ext = createMafwApprovalExtension(bridge, (e) => emitted.push(e), policy);
    const handlers: Record<string, Function> = {};
    ext.on({ on: (n: string, f: Function) => { handlers[n] = f; } });
    const p = handlers['tool_call']({ toolName: 'bash', input: { command: 'ls' } }, { sessionId: 's1' });
    bridge.reply(bridgeRequestId(emitted), 'always');
    await p;
    expect(policy.autoApprove).toContain('bash');
    // 第二次调用免审：不再 emit permission.asked
    emitted.length = 0;
    await handlers['tool_call']({ toolName: 'bash', input: { command: 'pwd' } }, { sessionId: 's1' });
    expect(emitted).toHaveLength(0);
  });

  it('reject decision blocks with message as reason', async () => {
    const policy = { autoApprove: [], autoDeny: [] };
    const bridge = new ApprovalBridge();
    const emitted: any[] = [];
    const ext = createMafwApprovalExtension(bridge, (e) => emitted.push(e), policy);
    const handlers: Record<string, Function> = {};
    ext.on({ on: (n: string, f: Function) => { handlers[n] = f; } });
    const p = handlers['tool_call']({ toolName: 'bash', input: {} }, { sessionId: 's1' });
    bridge.reply(bridgeRequestId(emitted), 'reject', '危险命令');
    const result = await p;
    expect(result).toEqual({ block: true, reason: '危险命令' });
  });
```

辅助函数 `bridgeRequestId(emitted)` = 从 emitted 的 `permission.asked` 事件取 `properties.requestId`（既有测试若已有等价 helper 则复用）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- pi-approval`
Expected: FAIL（reply 第二参是 boolean / lastDecision 不存在 / autoApprove 未增长）

- [ ] **Step 3: 实现**

`pi-approval-bridge.ts` 替换：

```ts
interface PendingRequest {
  resolve: (approved: boolean) => void;
  timeout: NodeJS.Timeout;
}

export type ApprovalDecision = 'once' | 'always' | 'reject';

export interface DecisionRecord {
  decision: ApprovalDecision;
  message?: string;
}

export class ApprovalBridge {
  private pending = new Map<string, PendingRequest>();
  private decisions = new Map<string, DecisionRecord>();
  private timeoutMs: number;

  constructor(timeoutMs: number = 300_000) {
    this.timeoutMs = timeoutMs;
  }

  request(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(false);
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, timeout });
    });
  }

  /** 三值回复；兼容旧 boolean 调用（true→once / false→reject）。 */
  reply(requestId: string, decision: ApprovalDecision | boolean, message?: string): boolean {
    const req = this.pending.get(requestId);
    if (!req) return false;

    const normalized: ApprovalDecision =
      typeof decision === 'boolean' ? (decision ? 'once' : 'reject') : decision;
    clearTimeout(req.timeout);
    this.pending.delete(requestId);
    this.decisions.set(requestId, { decision: normalized, message });
    req.resolve(normalized !== 'reject');
    return true;
  }

  /** extension 回查决策（always → 动态 allowlist；reject → block reason）。 */
  lastDecision(requestId: string): DecisionRecord | null {
    return this.decisions.get(requestId) ?? null;
  }

  dispose(): void {
    for (const { resolve, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      resolve(false);
    }
    this.pending.clear();
  }
}
```

`pi-approval-extension.ts` 的 tool_call handler 尾部替换：

```ts
        const approved = await bridge.request(requestId);
        const decision = bridge.lastDecision(requestId)?.decision ?? (approved ? 'once' : 'reject');
        const message = bridge.lastDecision(requestId)?.message;

        emitEvent({
          payload: {
            type: 'permission.replied',
            properties: {
              sessionID,
              requestId,
              approved,
              ...(decision !== 'once' ? { decision, ...(message ? { message } : {}) } : {}),
            },
          },
        });

        if (decision === 'always') {
          // session 级动态 allowlist：policy 是共享引用，后续 tool_call 即时免审
          if (!policy.autoApprove.includes(toolName)) policy.autoApprove.push(toolName);
          return;
        }

        if (!approved) {
          return { block: true, reason: message || 'rejected by user' };
        }
```

`pi-session.ts` registry：

```ts
  async permissionReply(
    sessionID: string,
    requestId: string,
    reply: 'once' | 'always' | 'reject' | boolean,
    message?: string,
  ): Promise<boolean> {
    const bridge = this.approvalBridges.get(sessionID);
    if (!bridge) return false;
    return bridge.reply(requestId, reply as any, message);
  }
```

`pi-runtime.ts` sessionAPI（Task 1 的临时适配替换为真透传）：

```ts
    permissionReply: (sessionID: string, requestId: string, reply: 'once' | 'always' | 'reject', message?: string) =>
      registry.permissionReply(sessionID, requestId, reply, message),
```

- [ ] **Step 4: 跑测试确认通过 + 连带修**

Run: `npm test --prefix gateway -- pi-approval gateway-permission pi-runtime`
Expected: PASS（既有 bool 调用经兼容路径不破；若 pi-runtime.test.ts 断言旧签名按新签名修）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pi/pi-approval-bridge.ts gateway/src/runtime/pi/pi-approval-extension.ts gateway/src/runtime/pi/pi-session.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/tests/unit/runtime/pi-approval-bridge.test.ts gateway/tests/unit/runtime/pi-approval-extension.test.ts gateway/tests/unit/gateway-permission.test.ts
git commit -m "feat(runtime): pi approval tri-state with session-level dynamic allowlist"
```

---

### Task 3: opencode adapter 三值 + question 通道

**Files:**
- Modify: `gateway/src/opencode-adapter.ts`
- Test: `gateway/tests/unit/runtime/opencode-branch.test.ts`（追加）

**Interfaces:**
- `permissionReply` → `client.session.permission.reply({ sessionID, requestID, reply, message })`（v2 SDK，body `{response}` 不适用——**实施探针**：若 v2 session.permission.reply 参数名与 d.ts 不符（`reply` vs `response`），以实测 400 修正）
- `session.question.list/reply/reject` → `client.session.question.*`

- [ ] **Step 1: 写失败测试**（opencode-branch.test.ts 追加；mockClient 补 `permission: { reply: jest.fn() }` 与 `question: { list/reply/reject: jest.fn() }`）

```ts
  it('permissionReply maps tri-state to SDK', async () => {
    mockClient.session.permission.reply.mockResolvedValueOnce({});
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const ok = await client.session.permissionReply!('ses_1', 'req_1', 'always', 'ok for session');
    expect(mockClient.session.permission.reply).toHaveBeenCalledWith({
      sessionID: 'ses_1', requestID: 'req_1', reply: 'always', message: 'ok for session',
    });
    expect(ok).toBe(true);
  });

  it('question list/reply/reject pass through', async () => {
    mockClient.session.question.list.mockResolvedValueOnce({ items: [{ id: 'q1' }] });
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    const items = await client.session.question!.list();
    expect(items).toEqual([{ id: 'q1' }]);
    await client.session.question!.reply({ requestID: 'q1', answers: [[{ type: 'text', text: 'a' }]] });
    expect(mockClient.session.question.reply).toHaveBeenCalledWith({ requestID: 'q1', answers: [[{ type: 'text', text: 'a' }]] });
    await client.session.question!.reject({ requestID: 'q1' });
    expect(mockClient.session.question.reject).toHaveBeenCalledWith({ requestID: 'q1' });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- opencode-branch`
Expected: FAIL

- [ ] **Step 3: 实现**（opencode-adapter.ts session 内）

```ts
      async permissionReply(
        sessionID: string,
        requestId: string,
        reply: 'once' | 'always' | 'reject',
        message?: string,
      ): Promise<boolean> {
        const result = await (client.session as any).permission.reply({
          sessionID,
          requestID: requestId,
          reply,
          ...(message ? { message } : {}),
        });
        if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
          throw new Error(String((result as any).error));
        }
        return true;
      },

      question: {
        async list(opts?: { directory?: string }) {
          const result = await (client.session as any).question.list(
            opts?.directory ? { directory: opts.directory } : undefined,
          );
          const data = unwrap<any>(result);
          return Array.isArray(data) ? data : data?.items ?? [];
        },
        async reply(opts: { requestID: string; answers: Array<Record<string, unknown>> }) {
          const result = await (client.session as any).question.reply({
            requestID: opts.requestID,
            answers: opts.answers,
          });
          if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
            throw new Error(String((result as any).error));
          }
        },
        async reject(opts: { requestID: string }) {
          const result = await (client.session as any).question.reject({ requestID: opts.requestID });
          if (result && typeof result === 'object' && 'error' in result && (result as any).error) {
            throw new Error(String((result as any).error));
          }
        },
      },
```

同时删掉旧 `permissionReply` bool 实现（若有；现 adapter 无此方法——P0 前从未实现，确认后跳过）。`opencode-runtime.ts` 无需改（fullCapabilities 已含 questionApi）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- opencode-branch`
Expected: PASS（旧 4 例 + 新 2 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/opencode-adapter.ts gateway/tests/unit/runtime/opencode-branch.test.ts
git commit -m "feat(runtime): opencode permissionReply tri-state + question channel via v2 SDK"
```

---

### Task 4: routes/permission 三值兼容 + question 能力门

**Files:**
- Modify: `gateway/src/routes/permission.ts`
- Modify: `gateway/src/index.ts`（/api/questions* capGuard 判定）
- Test: `gateway/tests/unit/permission-route.test.ts`（新建）

**Interfaces:**
- body 优先 `{reply, message?}`，兼容 `{approved}`（true→once / false→reject）
- `/api/questions*` 的 `capGuard('nativeApprovals')` → `questionApi ?? nativeApprovals` 判

- [ ] **Step 1: 写失败测试**

```ts
import { handlePermissionReply } from '../../src/routes/permission';
import * as http from 'http';

function mockRes() {
  const res: any = { status: 0, body: '', writeHead(s: number) { this.status = s; }, end(b?: string) { this.body = b ?? ''; } };
  return res as http.ServerResponse & { status: number; body: string };
}
function mockReq(body: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = { method: 'POST', on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); } };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

describe('permission route tri-state body', () => {
  it('accepts {reply, message} and forwards', async () => {
    const permissionReply = jest.fn(async () => true);
    const res = mockRes();
    await handlePermissionReply(
      { capabilities: {}, session: { permissionReply } } as any,
      mockReq({ reply: 'always', message: 'ok' }), res, 's1', 'r1',
    );
    expect(permissionReply).toHaveBeenCalledWith('s1', 'r1', 'always', 'ok');
    expect(res.status).toBe(200);
  });

  it('accepts legacy {approved: false} as reject', async () => {
    const permissionReply = jest.fn(async () => true);
    const res = mockRes();
    await handlePermissionReply(
      { capabilities: {}, session: { permissionReply } } as any,
      mockReq({ approved: false }), res, 's1', 'r2',
    );
    expect(permissionReply).toHaveBeenCalledWith('s1', 'r2', 'reject', undefined);
  });

  it('rejects invalid reply value with 400', async () => {
    const res = mockRes();
    await handlePermissionReply(
      { capabilities: {}, session: { permissionReply: jest.fn() } } as any,
      mockReq({ reply: 'forever' }), res, 's1', 'r3',
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- permission-route`
Expected: FAIL

- [ ] **Step 3: 实现**

`routes/permission.ts` body 解析段替换：

```ts
    const body = JSON.parse(body_ || '{}');
    let reply: 'once' | 'always' | 'reject' | undefined = body.reply;
    let message: string | undefined = body.message;
    if (typeof body.approved === 'boolean' && !reply) {
      reply = body.approved ? 'once' : 'reject'; // legacy bool callers
    }
    if (reply !== 'once' && reply !== 'always' && reply !== 'reject') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "reply must be 'once'|'always'|'reject'" }));
      return;
    }
    const result = await runtime.session.permissionReply(sessionID, requestId, reply, message);
```

（`const body = await readBody(req)` 的结果改名 `body_` 传 JSON.parse。）runtime 缺 `permissionReply` 的 503 分支保留。

`index.ts` 两处 question 端点（3753/3771/3792 行附近）的 `if (this.capGuard(res, 'nativeApprovals')) return;` 改为：

```ts
          if (!(this.runtimeCaps.questionApi ?? this.runtimeCaps.nativeApprovals)) {
            res.writeHead(503);
            res.end(JSON.stringify({ error: "capability 'questionApi' not available" }));
            return;
          }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- permission-route gateway-permission`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/permission.ts gateway/src/index.ts gateway/tests/unit/permission-route.test.ts
git commit -m "feat(api): permission route tri-state body + question capability gate"
```

---

### Task 5: B delivery/expectReply 实现 + gateway 消费方迁移

**Files:**
- Modify: `gateway/src/opencode-adapter.ts`（promptAsync/prompt noReply 映射）
- Modify: `gateway/src/runtime/pi/pi-session.ts`（delivery + expectReply 降级）
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（透传新参数）
- Modify: `gateway/src/index.ts`（BudgetGuard notify `index.ts:1398` 附近 + milestone `promptNoReply` `index.ts:6014` 附近改 `expectReply: false`）
- Test: `gateway/tests/unit/runtime/pi-branch.test.ts`（追加）、`opencode-branch.test.ts`（追加）

**Interfaces:**
- adapter：`noReply: opts.noReply ?? (opts.expectReply === false ? true : undefined)`
- registry：`promptAsync(id, text, opts?{ ..., delivery?, expectReply? })`；busy → `deliverAs: delivery === 'steer' ? 'steer' : 'followUp'`；非 busy → `streamingBehavior` 同映射；`expectReply === false || noReply` → `warnNoReplyOnce(id)`

- [ ] **Step 1: 写失败测试**

`pi-branch.test.ts` 追加：

```ts
  it('busy promptAsync maps delivery and warns noReply once per session', async () => {
    const calls: any[] = [];
    const warns: string[] = [];
    const src = fakeSession({
      isStreaming: true,
      sendUserMessage: jest.fn(async (content: any, o: any) => { calls.push(o); }),
    });
    const registry = makeRegistry(async () => ({ session: src }));
    const { id } = await registry.create('/cwd', {});
    await registry.promptAsync(id, 'hello', { delivery: 'steer', expectReply: false, logWarn: (m: string) => warns.push(m) });
    expect(calls[0]).toEqual({ deliverAs: 'steer' });
    await registry.promptAsync(id, 'again', { expectReply: false, logWarn: (m: string) => warns.push(m) });
    expect(calls[1]).toEqual({ deliverAs: 'followUp' });
    expect(warns).toHaveLength(1); // 每会话仅一次
  });

  it('non-busy prompt passes streamingBehavior to pi prompt opts', async () => {
    const src = fakeSession();
    const registry = makeRegistry(async () => ({ session: src }));
    const { id } = await registry.create('/cwd', {});
    await registry.prompt(id, 'q', { delivery: 'steer' });
    expect(src.prompt).toHaveBeenCalledWith('q', expect.objectContaining({ streamingBehavior: 'steer' }));
  });
```

`opencode-branch.test.ts` 追加：

```ts
  it('promptAsync maps expectReply=false to noReply', async () => {
    mockClient.session.promptAsync = jest.fn(async () => ({}));
    const client = await createOpencodeAdapter({ baseUrl: 'http://x' });
    await client.session.promptAsync({ sessionID: 's1', message: 'hi', expectReply: false });
    expect(mockClient.session.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ noReply: true }));
    await client.session.promptAsync({ sessionID: 's1', message: 'hi', expectReply: true });
    expect(mockClient.session.promptAsync).toHaveBeenLastCalledWith(expect.objectContaining({ noReply: undefined }));
  });
```

（mockClient 需补 `promptAsync`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- pi-branch opencode-branch`
Expected: FAIL

- [ ] **Step 3: 实现**

adapter promptAsync/prompt 的 noReply 行替换：

```ts
          noReply: opts.noReply ?? (opts.expectReply === false ? true : undefined),
```

`pi-session.ts`：

- 类字段 `private warnedNoReply = new Set<string>();`
- `promptAsync`/`prompt` 的 opts 类型加 `delivery?: 'steer'|'followup'; expectReply?: boolean; logWarn?: (msg: string) => void;`
- 共享私有方法：

```ts
  private resolveDelivery(opts?: { delivery?: 'steer' | 'followup' }): 'steer' | 'followUp' {
    return opts?.delivery === 'steer' ? 'steer' : 'followUp';
  }

  private warnNoReplyOnce(id: string, logWarn?: (m: string) => void): void {
    if (this.warnedNoReply.has(id)) return;
    this.warnedNoReply.add(id);
    (logWarn ?? ((m: string) => {}))(`[PiRuntime] expectReply=false has no native pi equivalent — message delivered as normal (session ${id}, warned once)`);
  }
```

- `promptAsync` busy 分支：`sendUserMessage(content, { deliverAs: this.resolveDelivery(opts) })`；调用前 `if (opts?.expectReply === false || opts?.noReply) this.warnNoReplyOnce(id, opts?.logWarn);`
- `prompt`/非 busy 分支：`piOpts.streamingBehavior = this.resolveDelivery(opts)`；同样 warn 调用；`buildPiPromptOpts` 保留 noReply 透传（兼容）。
- `delete()` 里 `this.warnedNoReply.delete(id);`；`disposeAll()` 清空。

`pi-runtime.ts` promptAsync/prompt 透传：opts 加 `delivery?: 'steer'|'followup'; expectReply?: boolean;`，registry 调用带 `delivery: opts.delivery, expectReply: opts.expectReply`。

`index.ts` 两处消费方迁移：`noReply: true` → `expectReply: false`（BudgetGuard notify 1398 行、milestone promptNoReply 6014 行）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- pi-branch opencode-branch milestone-push budget-guard`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/opencode-adapter.ts gateway/src/runtime/pi/pi-session.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/src/index.ts gateway/tests/unit/runtime/pi-branch.test.ts gateway/tests/unit/runtime/opencode-branch.test.ts
git commit -m "feat(runtime): delivery/expectReply semantics with pi noReply downgrade (warn once)"
```

---

### Task 6: C responseFormat 映射

**Files:**
- Modify: `gateway/src/runtime/completion-http.ts`
- Test: `gateway/tests/unit/runtime/completion-http.test.ts`（追加）

**Interfaces:**
- body 加 `response_format: { type: 'json_schema', json_schema: { name, schema, strict } }`（仅当 `req.responseFormat` 存在）

- [ ] **Step 1: 写失败测试**（按该文件既有 mock fetch 风格追加）

```ts
  it('maps responseFormat to OpenAI response_format json_schema', async () => {
    // mock fetch 捕获 body（复用文件内既有模式）
    // req.responseFormat = { type:'json_schema', name:'v', schema:{type:'object'}, strict:true }
    // 断言 JSON.parse(capturedBody).response_format 等于
    // { type:'json_schema', json_schema:{ name:'v', schema:{type:'object'}, strict:true } }
  });

  it('omits response_format when responseFormat absent', async () => {
    // 断言 capturedBody 无 response_format 键
  });
```

（实施时按 completion-http.test.ts 现有 mock 写法展开为完整代码，断言体如注释所述。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- completion-http`
Expected: FAIL

- [ ] **Step 3: 实现**（httpComplete body 构造处）

```ts
      body: JSON.stringify({
        model: req.model.modelID,
        messages,
        temperature: req.temperature ?? 0,
        max_tokens: req.maxTokens ?? 4096,
        ...(req.responseFormat
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: req.responseFormat.name,
                  schema: req.responseFormat.schema,
                  ...(req.responseFormat.strict !== undefined ? { strict: req.responseFormat.strict } : {}),
                },
              },
            }
          : {}),
      }),
```

pi runtime complete 不改（fail-open，契约注释已声明）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test --prefix gateway -- completion-http`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/completion-http.ts gateway/tests/unit/runtime/completion-http.test.ts
git commit -m "feat(runtime): completion responseFormat json_schema mapping (opencode transport)"
```

---

### Task 7: F session 媒体附件（探针 + 收集 + mafw-media extension）

**Files:**
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`（partsToPromptInput + 透传）
- Modify: `gateway/src/runtime/pi/pi-session.ts`（registry pendingMedia + mafw-media extension）
- Test: `gateway/tests/unit/runtime/pi-branch.test.ts`（追加）、`gateway/tests/unit/runtime/pi-media.test.ts`（新建）

**Interfaces:**
- `partsToPromptInput(parts?)` 返回扩展 `{ text?, images?, media?: Array<{ type: 'video'|'audio'; url: string; mime: string; filename?: string }> }`——video/audio 不再静默丢弃
- registry：`attachMedia(id, media[])`（pending 队列）+ `mafw-media` extension：`before_provider_request` 事件取 pending 注入 provider payload 最后一条 user message content（`{type:'video_url', video_url:{url}}` / `{type:'input_audio', input_audio:{data:url}}`，即 fixMediaPayload 的目标形状）后清空；复用 `fixMediaPayload` 对整个 payload 兜底改写

- [ ] **Step 0: 探针（不写测试，记录结论到实现注释）**

读 `gateway/src/runtime/plugins/pi-runtime.ts` 现版 `promptAsync/prompt`：确认 image file part 已转 ImageContent（`partsToPromptInput`）且 registry busy 分支 `sendUserMessage` 带 images——若属实，note-board 记忆 mem_1788891049274 所指 bug 已不成立，把结论写进 `partsToPromptInput` 注释并在 `mafw_mafw_add_memory` 更新该记忆（supersedes）；若仍有拍平路径，本 task 一并修复。

- [ ] **Step 1: 写失败测试**

`pi-media.test.ts`（新建，fake session + fake pi emitter）：

```ts
import { PiSessionRegistry } from '../../../src/runtime/pi/pi-session';
import { partsToPromptInput } from '../../../src/runtime/plugins/pi-runtime';

describe('session media attachments', () => {
  it('partsToPromptInput collects video/audio instead of dropping', () => {
    const out = partsToPromptInput([
      { type: 'text', text: 'look' },
      { type: 'file', url: 'data:video/mp4;base64,AAA', mime: 'video/mp4', filename: 'clip.mp4' },
      { type: 'file', url: 'data:audio/wav;base64,BBB', mime: 'audio/wav' },
    ]);
    expect(out.media).toHaveLength(2);
    expect(out.media![0]).toMatchObject({ type: 'video', mime: 'video/mp4' });
    expect(out.images).toBeUndefined();
  });

  it('registry.attachMedia + before_provider_request injects and clears pending', () => {
    const handlers: Record<string, Function> = {};
    let capturedFactories: any[] = [];
    const registry = new PiSessionRegistry({
      createSession: async (opts: any) => {
        capturedFactories = opts.extensionFactories ?? [];
        return { session: { isStreaming: false, messages: [], prompt: jest.fn(async () => {}), waitForIdle: jest.fn(async () => {}), dispose: jest.fn(async () => {}) } };
      },
    });
    registry.create('/cwd', {}).then(() => {
      const ext = capturedFactories.find((f) => f.name === 'mafw-media');
      expect(ext).toBeDefined();
      registry.attachMedia('<id>', [{ type: 'video', url: 'data:video/mp4;base64,AAA', mime: 'video/mp4' }]);
      const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }] }] };
      const rewritten: any = ext.factory({ on: (n: string, f: Function) => { handlers[n] = f; } }) || payload;
      const out = handlers['before_provider_request'](payload) as any;
      const content = out.messages[0].content;
      expect(content.some((c: any) => c.type === 'video_url')).toBe(true);
      // pending 清空：再次触发不重复注入
      const out2 = handlers['before_provider_request'](payload) as any;
      expect(out2.messages[0].content.some((c: any) => c.type === 'video_url')).toBe(false);
    });
  });
});
```

（`<id>` 用 create 返回值；测试写法按既有 pi-branch fake 风格 async 化，此处示意断言意图，实施时保持一致。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test --prefix gateway -- pi-media`
Expected: FAIL（media undefined / mafw-media 不存在）

- [ ] **Step 3: 实现**

`pi-runtime.ts` `partsToPromptInput` 扩展：

```ts
export function partsToPromptInput(parts?: any[]): {
  text?: string;
  images?: Array<{ type: 'image'; data: string; mimeType: string }>;
  media?: Array<{ type: 'video' | 'audio'; url: string; mime: string; filename?: string }>;
} {
  if (!parts?.length) return {};
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];
  const media: Array<{ type: 'video' | 'audio'; url: string; mime: string; filename?: string }> = [];
  const texts: string[] = [];
  for (const p of parts) {
    if (p?.type === 'file' && typeof p.url === 'string' && p.url) {
      const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(p.url);
      const mime = m?.[1] || p.mime || '';
      const data = m?.[3];
      if (mime.startsWith('image/') && data) {
        images.push({ type: 'image', mimeType: mime, data });
      } else if (mime.startsWith('video/') || mime.startsWith('audio/')) {
        media.push({ type: mime.startsWith('video/') ? 'video' : 'audio', url: p.url, mime, filename: p.filename });
      }
      // 既有分支（p.mime 字符串直存 image）保留不动
    } else if (typeof p?.text === 'string' && p.text) {
      texts.push(p.text);
    }
  }
  return {
    text: texts.length ? texts.join('\n') : undefined,
    images: images.length ? images : undefined,
    media: media.length ? media : undefined,
  };
}
```

`pi-runtime.ts` promptAsync/prompt：`converted.media?.length` → `registry.attachMedia(opts.sessionID, converted.media)`。

`pi-session.ts`：

- 字段 `private pendingMedia = new Map<string, Array<{ type: 'video'|'audio'; url: string; mime: string; filename?: string }>>();`
- 方法：

```ts
  attachMedia(id: string, media: Array<{ type: 'video'|'audio'; url: string; mime: string; filename?: string }>): void {
    const list = this.pendingMedia.get(id) ?? [];
    list.push(...media);
    this.pendingMedia.set(id, list);
  }

  private takePendingMedia(id: string) {
    const list = this.pendingMedia.get(id);
    this.pendingMedia.delete(id);
    return list ?? [];
  }
```

- `create()` 的 allExtensions 追加（sessionID 闭包同 compaction）：

```ts
    const mediaExtension = {
      name: 'mafw-media',
      factory: (pi: any) => {
        pi.on('before_provider_request', (event: any) => {
          const media = this.takePendingMedia(id);
          if (media.length === 0) return undefined;
          const payload: any = event?.payload;
          if (!payload || !Array.isArray(payload.messages)) return undefined;
          const lastUser = [...payload.messages].reverse().find((m: any) => m?.role === 'user');
          if (!lastUser) return undefined;
          const content = Array.isArray(lastUser.content) ? lastUser.content : (lastUser.content = [{ type: 'text', text: String(lastUser.content ?? '') }]);
          for (const m of media) {
            content.push(
              m.type === 'video'
                ? { type: 'video_url', video_url: { url: m.url } }
                : { type: 'input_audio', input_audio: { data: m.url } },
            );
          }
          return payload;
        });
      },
    };
```

（`before_provider_request` 返回新 payload 即替换——`BeforeProviderRequestEventResult = unknown`，"Can replace the payload"。）`fork()` 的 extensionFactories 同样补 `mediaExtension`（newId 闭包）。`delete()`/`disposeAll()` 清 pendingMedia。

- [ ] **Step 4: 跑测试确认通过 + 探针记忆更新**

Run: `npm test --prefix gateway -- pi-media pi-branch pi-runtime`
Expected: PASS。探针结论按 Step 0 处理（若 bug 已修复：`mafw_add_memory` supersedes mem_1788891049274，sticky 下架）。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/plugins/pi-runtime.ts gateway/src/runtime/pi/pi-session.ts gateway/tests/unit/runtime/pi-media.test.ts gateway/tests/unit/runtime/pi-branch.test.ts
git commit -m "feat(runtime): session media attachments — video/audio via before_provider_request rewrite"
```

---

### Task 8: AGENTS.md 更新 + 全量回归

**Files:**
- Modify: `AGENTS.md` §5.19

- [ ] **Step 1: 更新 AGENTS.md §5.19**（在 P0 追加段之后补）

```markdown
- `permissionReply(sessionID, requestId, 'once'|'always'|'reject', message?)` — 三值签名（P1 破坏性变更）；
  pi 'always' = session 级动态 allowlist（运行时 push policy.autoApprove，不落盘）
- `questionApi?: boolean` + `session.question.{list,reply,reject}` — 原生 question 通道（opencode v2 SDK
  直连；pi 无 question API 不实现）；/api/questions* 能力门按 `questionApi ?? nativeApprovals`
- `SessionPromptOpts.delivery/expectReply` — busy 投递时机（pi 映射 streamingBehavior；opencode 忽略）
  与免回复（opencode noReply 等价；pi 全路径降级 + 每会话 warn 一次）；`noReply` 已 @deprecated
- `CompletionRequest.responseFormat` — json_schema 约束输出（opencode 直连映射 OpenAI response_format；
  pi fail-open 忽略）
- session 媒体附件：file part（image/video/audio）一等载体；pi video/audio 经 `mafw-media` extension 在
  `before_provider_request` 注入小米 wire 格式（复用 fixMediaPayload）
```

- [ ] **Step 2: 全量回归 + 构建**

```bash
npm test --prefix gateway
cd packages/gateway-sdk && npm run typecheck
npm run build
```

Expected: 全绿 + exit 0。汇报新增测试数与全量通过数。

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md runtime contract P1 batch 1 (approval tri-state, delivery, responseFormat, media parts)"
```

---

## Self-Review 记录

- **Spec 覆盖**：A→Task 1/2/3/4；B→Task 1/5；C→Task 1/6；F→Task 1/7。D/E 属批次 2/3，不在本 plan。✓
- **类型一致**：`'once'|'always'|'reject'` 全程一致；`delivery` 值域 `'steer'|'followup'`（契约）↔ pi `'steer'|'followUp'`（原生大写 U——registry 内映射点唯一）；`media` 元素形状契约↔registry 一致。✓
- **已知探针**：Task 3 opencode v2 `session.permission.reply` 参数名（`reply` vs `response`）；Task 7 Step 0 image bug 核实 + 记忆更新；Task 6 测试按既有 mock 风格展开。✓
