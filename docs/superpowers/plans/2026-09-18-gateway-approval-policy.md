# Gateway Approval Policy Service — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 permission auto 模式（manual/auto + 25 次预算）下沉为 gateway 单一真相源：内部会话 fail-safe、事件富化（mafwPolicy）、持久白名单（config.yaml approval 段）、HTTP/SDK 面、desktop 迁移、TUI 接入。

**Architecture:** EventFacets 加 approval 切面（双 runtime 形状对齐）→ `gateway/src/core/approval/` 三模块（safety-classifier 纯函数 / policy-service 状态机 / allowlist-store）→ handleOpencodeEvent 钩子在 Mode A 广播前评估并富化 `properties.mafwPolicy`，auto 路径 fire-and-forget `permissionReply`。HTTP 面 deps 注入可单测；desktop/TUI 只消费富化事件与 API。

**Tech Stack:** TypeScript (gateway CJS + jest / desktop SolidJS + bun test / TUI pi-tui + node --test)、`~/.mafw/config.yaml`（persistOverrides，deepMerge 对数组是整组替换——已核实）、gateway.db kv_store。

**Spec:** `docs/superpowers/specs/2026-09-18-gateway-approval-policy-design.md`

## Global Constraints

- 契约层零改动：不新增 RuntimeCapabilities、不改 RuntimeClient 方法
- 评估顺序固定：内部会话 deny → 持久白名单 → manual → dangerous → 预算(25) → auto-approve
- 新会话 mode 恒 manual；显式 setMode('manual') / 预算回落 / 重启清零预算
- 路由注册：`/api/sessions/:sid/permission-mode` 与 `/api/approvals/allowlist` 必须在 `/api/permissions/:id/reply`（index.ts `pReplyMatch`，~line 4166）之前匹配
- 广播 wire 契约：顶层扁平、无 `data` 键（`opencodeBroadcast({ type, properties, sessionID })`）
- desktop 禁止裸 `<button>/<input>/title`，用 `@mafw/ui/v2/*`（ButtonV2/TextInputV2/ToastV2/TooltipV2）
- TUI 源码禁用 TS parameter properties；相对 import 带 `.ts` 后缀
- 每批 TDD 全绿 → 直接提交 main → 汇报测试数；最后一批 bump 版本并汇报版本号+commit
- gateway jest 全量：`cd gateway && npx jest --runInBand`；desktop：`cd packages/desktop && npx bun test`；TUI：`cd packages/tui && node --test tests/`

---

## Batch 1 — gateway 核心（切面 / 分类器 / 白名单 / 策略服务 / 钩子）

### Task 1: EventFacets approval 切面

**Files:**
- Modify: `gateway/src/runtime/normalize.ts`
- Test: `gateway/tests/unit/approval/normalize-approval-facet.test.ts`

**Interfaces:**
- Produces: `export interface ApprovalFacet { requestId: string; toolName: string; patterns: string[]; metadata?: Record<string, unknown> }`；`EventFacets.approval: ApprovalFacet | null`（非 asked 事件恒 null；asked 缺 id/permission/toolName 时也 null——畸形防御）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/approval/normalize-approval-facet.test.ts
import { normalizeOpencodeEvent } from '../../../src/runtime/normalize';

describe('EventFacets approval 切面（双 runtime 形状对齐）', () => {
  it('opencode 形状：id/permission/patterns/metadata', () => {
    const f = normalizeOpencodeEvent({
      type: 'permission.asked',
      properties: { id: 'req-1', sessionID: 'ses_1', permission: 'bash', patterns: ['git status*'], metadata: { impact: 'run command' } },
    });
    expect(f.approval).toEqual({
      requestId: 'req-1', toolName: 'bash', patterns: ['git status*'], metadata: { impact: 'run command' },
    });
  });

  it('pi 形状：requestId/toolName/args/risk 归一到 metadata', () => {
    const f = normalizeOpencodeEvent({
      payload: {
        type: 'permission.asked',
        properties: { sessionID: 'pi_1', requestId: 'uuid-1', toolName: 'bash', args: { command: 'npm test' }, risk: 'medium' },
      },
    });
    expect(f.approval).toEqual({
      requestId: 'uuid-1', toolName: 'bash', patterns: [], metadata: { args: { command: 'npm test' }, risk: 'medium' },
    });
  });

  it('非 asked 事件 → null', () => {
    const f = normalizeOpencodeEvent({ type: 'session.idle', properties: { sessionID: 's' } });
    expect(f.approval).toBeNull();
  });

  it('asked 缺 requestId 或 toolName → null（畸形防御）', () => {
    expect(normalizeOpencodeEvent({ type: 'permission.asked', properties: { sessionID: 's' } }).approval).toBeNull();
    expect(normalizeOpencodeEvent({ type: 'permission.asked', properties: { sessionID: 's', id: 'x' } }).approval).toBeNull();
  });

  it('opencode metadata 缺省时 metadata 为 undefined', () => {
    const f = normalizeOpencodeEvent({
      type: 'permission.asked',
      properties: { id: 'r', sessionID: 's', permission: 'edit', patterns: [] },
    });
    expect(f.approval?.metadata).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/approval/normalize-approval-facet.test.ts --runInBand`
Expected: FAIL（`f.approval` undefined / 类型不存在）

- [ ] **Step 3: 实现**

`gateway/src/runtime/normalize.ts`——在 `EventFacets` 接口 `toolCommand` 字段后加：

```typescript
/** permission.asked 切面：双 runtime 形状在此对齐（opencode: id/permission/patterns/metadata；pi: requestId/toolName/args/risk）。非 asked 或畸形（缺 requestId/toolName）恒 null。 */
approval: ApprovalFacet | null;
```

接口文件顶部（`RawRuntimeEvent` 之后）加：

```typescript
export interface ApprovalFacet {
  requestId: string;
  toolName: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
}
```

`normalizeOpencodeEvent` 内，在 compaction 提取块之后加：

```typescript
  // approval facet：permission.asked 双 runtime 形状对齐
  let approval: ApprovalFacet | null = null;
  if (type === 'permission.asked' && sessionID) {
    const requestId = props?.requestId ?? props?.id;
    const toolName = props?.permission ?? props?.toolName;
    if (requestId && toolName) {
      approval = {
        requestId: String(requestId),
        toolName: String(toolName),
        patterns: Array.isArray(props?.patterns) ? props.patterns : [],
        metadata: props?.metadata ?? (props?.args !== undefined || props?.risk !== undefined
          ? { args: props?.args, risk: props?.risk }
          : undefined),
      };
    }
  }
```

返回对象加 `approval`（import 处若同文件内引用需在顶部 export）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/approval/normalize-approval-facet.test.ts --runInBand`
Expected: PASS 5 例

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/normalize.ts gateway/tests/unit/approval/normalize-approval-facet.test.ts
git commit -m "feat(approval): approval facet in EventFacets — align opencode/pi asked shapes"
```

---

### Task 2: safety-classifier 纯函数

**Files:**
- Create: `gateway/src/core/approval/safety-classifier.ts`
- Test: `gateway/tests/unit/approval/safety-classifier.test.ts`

**Interfaces:**
- Produces: `export interface ApprovalCandidate { toolName: string; patterns: string[]; metadata?: { args?: unknown; risk?: string; [k: string]: unknown } }`；`export type SafetyVerdict = 'safe' | 'dangerous'`；`export function classifySafety(candidate: ApprovalCandidate): SafetyVerdict`；`export function commandTextOf(candidate: ApprovalCandidate): string`（Task 3/5 复用）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/approval/safety-classifier.test.ts
import { classifySafety, commandTextOf } from '../../../src/core/approval/safety-classifier';

describe('classifySafety（白名单 + 危险正则）', () => {
  it('只读白名单工具恒 safe（含大写）', () => {
    for (const t of ['read', 'grep', 'glob', 'ls', 'find', 'Read', 'GREP']) {
      expect(classifySafety({ toolName: t, patterns: [] })).toBe('safe');
    }
  });

  it('rm 带 -r/-f 旗标 → dangerous', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'rm -rf /tmp/x' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'rm -fr a' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'rm file.txt' } } })).toBe('safe');
  });

  it('git 破坏性命令 → dangerous', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git push --force origin main' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git push -f' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git reset --hard HEAD~3' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git clean -fd' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'git status' } } })).toBe('safe');
  });

  it('数据库/磁盘/系统命令 → dangerous', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'psql -c "drop table users"' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'TRUNCATE TABLE users' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'mkfs.ext4 /dev/sda1' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'shutdown /s /t 0' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'dd if=img.iso of=/dev/sdb' } } })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'format c:' } } })).toBe('dangerous');
  });

  it('fork bomb → dangerous', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: ':(){ :|:& };:' } } })).toBe('dangerous');
  });

  it('patterns 兜底：无 args 时用 patterns 判定', () => {
    expect(classifySafety({ toolName: 'bash', patterns: ['git push --force'] })).toBe('dangerous');
    expect(classifySafety({ toolName: 'bash', patterns: ['npm test'] })).toBe('safe');
  });

  it('写类安全命令 → safe', () => {
    expect(classifySafety({ toolName: 'bash', patterns: [], metadata: { args: { command: 'npm run build' } } })).toBe('safe');
    expect(classifySafety({ toolName: 'edit', patterns: ['src/app.ts'] })).toBe('safe');
  });

  it('commandTextOf：args.command 优先，args 字符串次之，patterns 兜底', () => {
    expect(commandTextOf({ toolName: 'bash', patterns: ['p'], metadata: { args: { command: 'cmd' } } })).toBe('cmd');
    expect(commandTextOf({ toolName: 'bash', patterns: ['p'], metadata: { args: 'raw string' } })).toBe('raw string');
    expect(commandTextOf({ toolName: 'bash', patterns: ['a', 'b'] })).toBe('a b');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/approval/safety-classifier.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// gateway/src/core/approval/safety-classifier.ts
// auto 模式安全判定（纯函数）：只读白名单直接 safe；写类工具按危险正则
// 匹配命令文本；其余 safe。spec §6.1 —— 单一真相源，desktop/TUI 不再自判。

export interface ApprovalCandidate {
  toolName: string;
  patterns: string[];
  metadata?: { args?: unknown; risk?: string; [k: string]: unknown };
}

export type SafetyVerdict = 'safe' | 'dangerous';

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob', 'ls', 'find']);

const DANGER_COMMAND_RE: RegExp[] = [
  /\brm\s+-[a-z]*[rf]/i,                       // rm -r / -f 任意组合
  /\bgit\s+push\s+.*(--force|-f)(\s|$)/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\b(drop|truncate)\s+(table|database)\b/i,
  /\bmkfs(\.|\b)/i,
  /:\(\)\s*\{\s*:\|\s*:&\s*\}\s*;:/,           // fork bomb
  /\b(shutdown|reboot|halt)\b/i,
  /\bdd\s+[^;]*of=\/dev\//i,
  /\bformat\s+[a-z]:/i,
];

export function commandTextOf(candidate: ApprovalCandidate): string {
  const args = candidate.metadata?.args;
  if (typeof args === 'string') return args;
  if (args && typeof args === 'object' && typeof (args as any).command === 'string') {
    return (args as any).command as string;
  }
  return candidate.patterns.join(' ');
}

export function classifySafety(candidate: ApprovalCandidate): SafetyVerdict {
  if (READ_ONLY_TOOLS.has(candidate.toolName.toLowerCase())) return 'safe';
  const text = commandTextOf(candidate);
  return DANGER_COMMAND_RE.some((re) => re.test(text)) ? 'dangerous' : 'safe';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/approval/safety-classifier.test.ts --runInBand`
Expected: PASS（9 describe 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/approval/safety-classifier.ts gateway/tests/unit/approval/safety-classifier.test.ts
git commit -m "feat(approval): safety classifier — read-only allowlist + danger regexes"
```

---

### Task 3: config approval 段 + AllowlistStore

**Files:**
- Modify: `gateway/src/config.ts`（GatewayConfig 接口 + 默认值 + getter）
- Create: `gateway/src/core/approval/allowlist-store.ts`
- Test: `gateway/tests/unit/approval/allowlist-store.test.ts`

**Interfaces:**
- Consumes: `commandTextOf`（Task 2）、`ApprovalCandidate`（Task 2）
- Produces: `export interface AllowlistEntry { tool: string; prefix?: string }`；`export class AllowlistStore { constructor(deps: AllowlistStoreDeps); list(): AllowlistEntry[]; add(entry): { ok: boolean; entries: AllowlistEntry[] }; remove(entry): { ok: boolean; entries: AllowlistEntry[] }; matches(toolName: string, candidate: ApprovalCandidate): boolean }`；`export function parseEntry(raw: string): AllowlistEntry | null`
- config 段形状：`approval: { allowlist: string[] }`（条目 `"read"` 或 `"bash:git status"`；deepMerge 对数组整组替换，已核实）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/approval/allowlist-store.test.ts
import { AllowlistStore, parseEntry, AllowlistEntry } from '../../../src/core/approval/allowlist-store';

function makeStore(initial: unknown = []) {
  let raw: unknown = initial;
  const persisted: any[] = [];
  const store = new AllowlistStore({
    readRawAllowlist: () => raw,
    persist: (o) => { persisted.push(o); raw = (o as any).approval.allowlist; return { changed: ['approval'] }; },
  });
  return { store, persisted, getRaw: () => raw };
}

describe('parseEntry', () => {
  it('裸工具名', () => { expect(parseEntry('read')).toEqual({ tool: 'read' }); });
  it('tool:prefix（尾部 * 剥离）', () => {
    expect(parseEntry('bash:git status*')).toEqual({ tool: 'bash', prefix: 'git status' });
  });
  it('空/无效 → null', () => {
    expect(parseEntry('')).toBeNull();
    expect(parseEntry(':x')).toBeNull();
  });
});

describe('AllowlistStore', () => {
  it('list 解析条目并过滤无效', () => {
    const { store } = makeStore(['read', 'bash:git status', '', 'ls']);
    expect(store.list()).toEqual([
      { tool: 'read' }, { tool: 'bash', prefix: 'git status' }, { tool: 'ls' },
    ]);
  });

  it('add 去重 + 持久化（整组替换数组）', () => {
    const { store, persisted } = makeStore(['read']);
    const r1 = store.add({ tool: 'bash', prefix: 'git status' });
    expect(r1.ok).toBe(true);
    expect(persisted[0]).toEqual({ approval: { allowlist: ['read', 'bash:git status'] } });
    const r2 = store.add({ tool: 'bash', prefix: 'git status' }); // 重复
    expect(r2.ok).toBe(true);
    expect(persisted.length).toBe(1); // 未再写
  });

  it('add 无效 tool → ok:false 不写', () => {
    const { store, persisted } = makeStore([]);
    expect(store.add({ tool: '' } as any).ok).toBe(false);
    expect(persisted.length).toBe(0);
  });

  it('remove 未命中 → ok:false；命中 → 移除', () => {
    const { store } = makeStore(['read', 'bash:git status']);
    expect(store.remove({ tool: 'edit' }).ok).toBe(false);
    expect(store.remove({ tool: 'bash', prefix: 'git status' }).ok).toBe(true);
    expect(store.list()).toEqual([{ tool: 'read' }]);
  });

  it('matches：裸工具名 = 整工具；prefix = 命令前缀或 pattern 前缀', () => {
    const { store } = makeStore(['read', 'bash:git status']);
    expect(store.matches('read', { toolName: 'read', patterns: [] })).toBe(true);
    expect(store.matches('bash', { toolName: 'bash', patterns: [], metadata: { args: { command: 'git status --porcelain' } } })).toBe(true);
    expect(store.matches('bash', { toolName: 'bash', patterns: ['git status*'] })).toBe(true);
    expect(store.matches('bash', { toolName: 'bash', patterns: ['npm test'] })).toBe(false);
    expect(store.matches('edit', { toolName: 'edit', patterns: ['a.ts'] })).toBe(false);
  });

  it('matches 大小写不敏感', () => {
    const { store } = makeStore(['Read']);
    expect(store.matches('read', { toolName: 'read', patterns: [] })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/approval/allowlist-store.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`gateway/src/config.ts`——`GatewayConfig` 接口（`usage` 段之后）加：

```typescript
  approval: {
    /** 持久白名单：条目为裸工具名（"read"）或 "tool:prefix"（"bash:git status"） */
    allowlist: string[];
  };
```

默认值对象（`pluginConfig: {}` 所在的 defaults，config.ts ~line 376 同层）加：

```typescript
      approval: { allowlist: [] },
```

getter（`get usage()` 旁）加：

```typescript
  get approval() { return this.data.approval; }
```

`gateway/src/core/approval/allowlist-store.ts`：

```typescript
import { ApprovalCandidate, commandTextOf } from './safety-classifier';

export interface AllowlistEntry { tool: string; prefix?: string }

export interface AllowlistStoreDeps {
  /** 懒读 config（经 config.raw 保证 watcher 热生效）；非数组 fail-open 当空表 */
  readRawAllowlist(): unknown;
  /** config.persistOverrides —— deepMerge 对数组整组替换 */
  persist(overrides: Record<string, any>): { changed: string[] };
}

export function parseEntry(raw: string): AllowlistEntry | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const idx = s.indexOf(':');
  if (idx <= 0) return { tool: s };
  const tool = s.slice(0, idx).trim();
  const prefix = s.slice(idx + 1).trim().replace(/\*+$/, '').trim();
  if (!tool) return null;
  return prefix ? { tool, prefix } : { tool };
}

export class AllowlistStore {
  constructor(private deps: AllowlistStoreDeps) {}

  private rawList(): string[] {
    const raw = this.deps.readRawAllowlist();
    return Array.isArray(raw) ? raw.map((x) => String(x)) : [];
  }

  list(): AllowlistEntry[] {
    return this.rawList().map(parseEntry).filter((e): e is AllowlistEntry => !!e);
  }

  add(entry: AllowlistEntry): { ok: boolean; entries: AllowlistEntry[] } {
    if (!entry?.tool || typeof entry.tool !== 'string') return { ok: false, entries: this.list() };
    const raw = this.rawList();
    const serialized = entry.prefix ? `${entry.tool}:${entry.prefix}` : entry.tool;
    if (raw.includes(serialized)) return { ok: true, entries: this.list() };
    raw.push(serialized);
    this.deps.persist({ approval: { allowlist: raw } });
    return { ok: true, entries: this.list() };
  }

  remove(entry: AllowlistEntry): { ok: boolean; entries: AllowlistEntry[] } {
    const raw = this.rawList();
    const serialized = entry.prefix ? `${entry.tool}:${entry.prefix}` : entry.tool;
    const next = raw.filter((e) => e !== serialized);
    if (next.length === raw.length) return { ok: false, entries: this.list() };
    this.deps.persist({ approval: { allowlist: next } });
    return { ok: true, entries: this.list() };
  }

  matches(toolName: string, candidate: ApprovalCandidate): boolean {
    return this.list().some((e) => {
      if (e.tool.toLowerCase() !== toolName.toLowerCase()) return false;
      if (!e.prefix) return true;
      const prefix = e.prefix.toLowerCase();
      const text = commandTextOf(candidate).toLowerCase();
      const patterns = candidate.patterns.map((p) => p.toLowerCase().replace(/\*+$/, ''));
      return text.startsWith(prefix) || patterns.some((p) => p.startsWith(prefix));
    });
  }
}
```

注意：`AllowlistStoreDeps.persist` 只写 `approval` 段——**不得**把其他段一起传（persistOverrides 会整份 config 落盘，传入的 overrides 只含 approval 即可）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/approval/allowlist-store.test.ts --runInBand`
Expected: PASS（11 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/config.ts gateway/src/core/approval/allowlist-store.ts gateway/tests/unit/approval/allowlist-store.test.ts
git commit -m "feat(approval): config approval section + persistent allowlist store"
```

---

### Task 4: ApprovalPolicyService（评估顺序 + kv + 预算）

**Files:**
- Create: `gateway/src/core/approval/policy-service.ts`
- Test: `gateway/tests/unit/approval/policy-service.test.ts`

**Interfaces:**
- Consumes: `classifySafety` / `ApprovalCandidate` / `SafetyVerdict`（Task 2）
- Produces: `export type SessionPermissionMode = 'manual' | 'auto'`；`export const AUTO_APPROVE_BUDGET = 25`；`export interface PolicyDecision { action: 'auto-approve' | 'auto-deny' | 'human'; verdict: SafetyVerdict; reason: string }`；`export class ApprovalPolicyService { evaluate(sessionID, candidate): PolicyDecision /* 同步 */; getMode(sessionID): Promise<SessionPermissionMode>; setMode(sessionID, mode): Promise<void>; getAutoApprovals(sessionID): number }`

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/approval/policy-service.test.ts
import {
  ApprovalPolicyService, ApprovalPolicyDeps, AUTO_APPROVE_BUDGET, PolicyDecision,
} from '../../../src/core/approval/policy-service';

function makeDeps(overrides: Partial<ApprovalPolicyDeps> = {}) {
  const calls: { mode: [string, 'manual' | 'auto'][]; broadcasts: { sid: string; mode: string; reason: string }[] } = {
    mode: [], broadcasts: [],
  };
  const deps: ApprovalPolicyDeps = {
    getInternalRole: () => undefined,
    allowlistMatches: () => false,
    loadMode: async () => 'manual' as const,
    saveMode: async (sid, mode) => { calls.mode.push([sid, mode]); },
    onModeChanged: (sid, mode, reason) => { calls.broadcasts.push({ sid, mode, reason }); },
    ...overrides,
  };
  return { deps, calls };
}

const SAFE = { toolName: 'bash', patterns: [], metadata: { args: { command: 'npm test' } } };
const DANGEROUS = { toolName: 'bash', patterns: [], metadata: { args: { command: 'rm -rf /' } } };

describe('评估顺序（spec §6.2，逐条短路）', () => {
  it('1. 内部会话 → auto-deny（即使 dangerous / 白名单命中）', async () => {
    const { deps } = makeDeps({ getInternalRole: () => 'extract' });
    const svc = new ApprovalPolicyService(deps);
    const d = svc.evaluate('s1', SAFE);
    expect(d.action).toBe('auto-deny');
    expect(d.reason).toContain('role=extract');
  });

  it('2. 持久白名单命中 → auto-approve（manual 模式也放行）', async () => {
    const { deps } = makeDeps({ allowlistMatches: (tool) => tool === 'bash' });
    const svc = new ApprovalPolicyService(deps);
    expect(svc.evaluate('s1', SAFE).action).toBe('auto-approve');
  });

  it('3. manual（缺省）→ human', async () => {
    const { deps } = makeDeps();
    const svc = new ApprovalPolicyService(deps);
    const d = svc.evaluate('s1', SAFE);
    expect(d.action).toBe('human');
    expect(d.verdict).toBe('safe');
  });

  it('4. auto 模式 + dangerous → human（高危永不自动放行）', async () => {
    const { deps } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1'); // 触发懒加载
    const d = svc.evaluate('s1', DANGEROUS);
    expect(d.action).toBe('human');
    expect(d.verdict).toBe('dangerous');
  });

  it('5. 预算耗尽 → 回落 manual + 广播 + 清零', async () => {
    const { deps, calls } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    for (let i = 0; i < AUTO_APPROVE_BUDGET; i++) {
      expect(svc.evaluate('s1', SAFE).action).toBe('auto-approve');
    }
    expect(svc.getAutoApprovals('s1')).toBe(AUTO_APPROVE_BUDGET);
    const d = svc.evaluate('s1', SAFE); // 第 26 次
    expect(d.action).toBe('human');
    expect(d.reason).toContain('budget');
    expect(calls.broadcasts.some((b) => b.sid === 's1' && b.mode === 'manual')).toBe(true);
    expect(calls.mode.some(([sid, m]) => sid === 's1' && m === 'manual')).toBe(true);
    expect(svc.getAutoApprovals('s1')).toBe(0);
    // 回落后维持 manual
    expect(svc.evaluate('s1', SAFE).action).toBe('human');
  });

  it('6. auto + safe → auto-approve 计数递增', async () => {
    const { deps } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    const d = svc.evaluate('s1', SAFE) as PolicyDecision;
    expect(d.action).toBe('auto-approve');
    expect(d.reason).toContain('1/25');
    expect(svc.getAutoApprovals('s1')).toBe(1);
  });
});

describe('mode 持久化与预算重置', () => {
  it('evaluate 在 mode 未加载完成时按 manual 保守处理', () => {
    let resolveLoad: (m: 'manual' | 'auto') => void = () => {};
    const { deps } = makeDeps({ loadMode: () => new Promise<'manual' | 'auto'>((r) => { resolveLoad = r; }) });
    const svc = new ApprovalPolicyService(deps);
    expect(svc.evaluate('s1', SAFE).action).toBe('human'); // 未加载 → manual
    resolveLoad('auto');
  });

  it('getMode 懒加载 kv 值', async () => {
    const { deps } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    expect(await svc.getMode('s1')).toBe('auto');
  });

  it('setMode：内存 + kv + 广播 + 预算清零；显式切 manual 重置预算', async () => {
    const { deps, calls } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    svc.evaluate('s1', SAFE); // count=1
    await svc.setMode('s1', 'manual');
    expect(calls.mode).toContainEqual(['s1', 'manual']);
    expect(calls.broadcasts.some((b) => b.mode === 'manual' && b.reason === 'user toggled')).toBe(true);
    expect(svc.getAutoApprovals('s1')).toBe(0);
    await svc.setMode('s1', 'auto');
    expect(svc.evaluate('s1', SAFE).reason).toContain('1/25'); // 预算重新计
  });

  it('kv 写失败 fail-open：内存态仍生效', async () => {
    const { deps } = makeDeps({ saveMode: async () => { throw new Error('db down'); } });
    const svc = new ApprovalPolicyService(deps);
    await expect(svc.setMode('s1', 'auto')).resolves.toBeUndefined();
    expect(await svc.getMode('s1')).toBe('auto');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/approval/policy-service.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// gateway/src/core/approval/policy-service.ts
// 评估顺序（spec §6.2，逐条短路）：
//   1. 内部会话 → auto-deny + warn（deny instead of prompt，Claude dontAsk 语义）
//   2. MAFW 持久白名单命中 → auto-approve
//   3. session mode === manual → human
//   4. classifySafety === dangerous → human（高危永不自动放行）
//   5. 预算耗尽（25 次连续 auto）→ 回落 manual + 广播 → human
//   6. 其余 → auto-approve（计数 +1）
// evaluate 必须同步（handleOpencodeEvent 是同步路径）；kv 懒加载，未完成时按 manual 保守。

import { ApprovalCandidate, SafetyVerdict, classifySafety } from './safety-classifier';

export type SessionPermissionMode = 'manual' | 'auto';
export const AUTO_APPROVE_BUDGET = 25;

export interface PolicyDecision {
  action: 'auto-approve' | 'auto-deny' | 'human';
  verdict: SafetyVerdict;
  reason: string;
}

export interface ApprovalPolicyDeps {
  getInternalRole(sessionID: string): string | undefined;
  allowlistMatches(toolName: string, candidate: ApprovalCandidate): boolean;
  loadMode(sessionID: string): Promise<SessionPermissionMode>;
  saveMode(sessionID: string, mode: SessionPermissionMode): Promise<void>;
  onModeChanged(sessionID: string, mode: SessionPermissionMode, reason: string): void;
}

export class ApprovalPolicyService {
  private modes = new Map<string, SessionPermissionMode>();
  private counts = new Map<string, number>();
  private loadPromises = new Map<string, Promise<void>>();

  constructor(private deps: ApprovalPolicyDeps) {}

  private ensureLoaded(sessionID: string): Promise<void> {
    if (this.modes.has(sessionID)) return Promise.resolve();
    let p = this.loadPromises.get(sessionID);
    if (!p) {
      p = this.deps.loadMode(sessionID)
        .then((m) => { if (m === 'auto' || m === 'manual') this.modes.set(sessionID, m); })
        .catch(() => { /* fail-open：保持 manual 缺省 */ })
        .finally(() => { this.loadPromises.delete(sessionID); });
      this.loadPromises.set(sessionID, p);
    }
    return p;
  }

  evaluate(sessionID: string, candidate: ApprovalCandidate): PolicyDecision {
    // 1. 内部会话 fail-safe
    const role = this.deps.getInternalRole(sessionID);
    if (role) {
      return {
        action: 'auto-deny',
        verdict: classifySafety(candidate),
        reason: `internal session (role=${role}) — denied by fail-safe policy`,
      };
    }
    void this.ensureLoaded(sessionID); // fire-and-forget：本次按缺省 manual 保守处理
    // 2. 持久白名单
    if (this.deps.allowlistMatches(candidate.toolName, candidate)) {
      return { action: 'auto-approve', verdict: classifySafety(candidate), reason: 'persistent allowlist match' };
    }
    // 3. manual → human
    const mode = this.modes.get(sessionID) ?? 'manual';
    if (mode !== 'auto') {
      return { action: 'human', verdict: classifySafety(candidate), reason: `session mode=${mode}` };
    }
    // 4. dangerous 永不自动放行
    const verdict = classifySafety(candidate);
    if (verdict === 'dangerous') {
      return { action: 'human', verdict, reason: 'dangerous command pattern' };
    }
    // 5. 预算
    const used = this.counts.get(sessionID) ?? 0;
    if (used >= AUTO_APPROVE_BUDGET) {
      this.modes.set(sessionID, 'manual');
      this.counts.delete(sessionID);
      void this.deps.saveMode(sessionID, 'manual').catch(() => {});
      this.deps.onModeChanged(sessionID, 'manual', `auto-approve budget (${AUTO_APPROVE_BUDGET}) exhausted — fell back to manual`);
      return { action: 'human', verdict, reason: 'budget exhausted, mode fell back to manual' };
    }
    // 6. auto-approve
    this.counts.set(sessionID, used + 1);
    return { action: 'auto-approve', verdict, reason: `auto mode (${used + 1}/${AUTO_APPROVE_BUDGET})` };
  }

  async getMode(sessionID: string): Promise<SessionPermissionMode> {
    await this.ensureLoaded(sessionID);
    return this.modes.get(sessionID) ?? 'manual';
  }

  getAutoApprovals(sessionID: string): number {
    return this.counts.get(sessionID) ?? 0;
  }

  async setMode(sessionID: string, mode: SessionPermissionMode): Promise<void> {
    this.modes.set(sessionID, mode);
    this.counts.delete(sessionID); // 显式切换 = 预算重置（spec §6.2）
    this.deps.onModeChanged(sessionID, mode, 'user toggled');
    try { await this.deps.saveMode(sessionID, mode); } catch { /* fail-open：内存态已生效 */ }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/approval/policy-service.test.ts --runInBand`
Expected: PASS（10 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/approval/policy-service.ts gateway/tests/unit/approval/policy-service.test.ts
git commit -m "feat(approval): policy service — fixed evaluation order, kv mode, 25-budget fallback"
```

---

### Task 5: 事件钩子 + mafwPolicy 富化

**Files:**
- Create: `gateway/src/core/approval/hook.ts`
- Modify: `gateway/src/index.ts`（handleOpencodeEvent ~line 933 后插钩子；服务实例化）
- Test: `gateway/tests/unit/approval/hook.test.ts`

**Interfaces:**
- Consumes: `ApprovalPolicyService`（Task 4）、`ApprovalFacet`（Task 1）、`AgentRuntime`（现有契约）
- Produces: `export function applyApprovalPolicy(policy: ApprovalPolicyService, runtime: AgentRuntime | null, facet: ApprovalFacet, sessionID: string, props: Record<string, any>): void`——评估 → `props.mafwPolicy = decision` → auto 路径 fire-and-forget `permissionReply`；**index.ts 唯一调用点在 internal 过滤（memoryWorker drop）之前**

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/approval/hook.test.ts
import { applyApprovalPolicy } from '../../../src/core/approval/hook';
import { ApprovalPolicyService, ApprovalPolicyDeps } from '../../../src/core/approval/policy-service';
import { ApprovalFacet } from '../../../src/runtime/normalize';
import { AgentRuntime } from '../../../src/runtime/contract';

function makePolicy(overrides: Partial<ApprovalPolicyDeps> = {}): ApprovalPolicyService {
  return new ApprovalPolicyService({
    getInternalRole: () => undefined,
    allowlistMatches: () => false,
    loadMode: async () => 'auto',
    saveMode: async () => {},
    onModeChanged: () => {},
    ...overrides,
  });
}

function makeRuntime() {
  const replies: Array<[string, string, string]> = [];
  const rt = {
    session: {
      permissionReply: async (sid: string, rid: string, reply: string) => {
        replies.push([sid, rid, reply]);
        return true;
      },
    },
  } as unknown as AgentRuntime;
  return { rt, replies };
}

const FACET: ApprovalFacet = { requestId: 'req-1', toolName: 'bash', patterns: [], metadata: { args: { command: 'npm test' } } };

describe('applyApprovalPolicy', () => {
  it('auto+safe → mafwPolicy 附加 + permissionReply("once") fire-and-forget', async () => {
    const policy = makePolicy();
    const { rt, replies } = makeRuntime();
    const props: any = {};
    applyApprovalPolicy(policy, rt, FACET, 's1', props);
    expect(props.mafwPolicy.action).toBe('auto-approve');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toContainEqual(['s1', 'req-1', 'once']);
  });

  it('internal session → mafwPolicy.auto-deny + permissionReply("reject")', async () => {
    const policy = makePolicy({ getInternalRole: () => 'btw' });
    const { rt, replies } = makeRuntime();
    const props: any = {};
    applyApprovalPolicy(policy, rt, FACET, 's1', props);
    expect(props.mafwPolicy.action).toBe('auto-deny');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies).toContainEqual(['s1', 'req-1', 'reject']);
  });

  it('dangerous → mafwPolicy.human + 不回复（人答复）', async () => {
    const policy = makePolicy();
    const { rt, replies } = makeRuntime();
    const props: any = {};
    applyApprovalPolicy(policy, rt, { ...FACET, metadata: { args: { command: 'rm -rf /' } } }, 's1', props);
    expect(props.mafwPolicy.action).toBe('human');
    expect(props.mafwPolicy.verdict).toBe('dangerous');
    await new Promise((r) => setTimeout(r, 10));
    expect(replies.length).toBe(0);
  });

  it('permissionReply 抛错 → 不抛出（fail-open，props.mafwPolicy 保留）', async () => {
    const policy = makePolicy();
    const rt = { session: { permissionReply: async () => { throw new Error('bridge gone'); } } } as unknown as AgentRuntime;
    const props: any = {};
    expect(() => applyApprovalPolicy(policy, rt, FACET, 's1', props)).not.toThrow();
    expect(props.mafwPolicy.action).toBe('auto-approve');
  });

  it('evaluate 抛错 → 不附加 mafwPolicy（当 human 处理）', () => {
    const policy = makePolicy({ getInternalRole: () => { throw new Error('boom'); } });
    const { rt } = makeRuntime();
    const props: any = {};
    expect(() => applyApprovalPolicy(policy, rt, FACET, 's1', props)).not.toThrow();
    expect(props.mafwPolicy).toBeUndefined();
  });

  it('runtime 无 permissionReply（能力缺失）→ 不抛出', () => {
    const policy = makePolicy();
    const props: any = {};
    expect(() => applyApprovalPolicy(policy, null, FACET, 's1', props)).not.toThrow();
    expect(props.mafwPolicy.action).toBe('auto-approve');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/approval/hook.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// gateway/src/core/approval/hook.ts
// handleOpencodeEvent 的 approval 钩子：同步评估 → 富化广播 props.mafwPolicy
// → auto 路径 fire-and-forget permissionReply（失败 warn 不重试，桌面 5s 对账兜底）。
// 调用点必须在 internal 过滤（memoryWorker drop）之前 —— 内部会话 deny 先于事件丢弃。

import { AgentRuntime } from '../../runtime/contract';
import { ApprovalFacet } from '../../runtime/normalize';
import { log } from '../../core/utils/logger';
import { ApprovalPolicyService } from './policy-service';

export function applyApprovalPolicy(
  policy: ApprovalPolicyService,
  runtime: AgentRuntime | null,
  facet: ApprovalFacet,
  sessionID: string,
  props: Record<string, any>,
): void {
  try {
    const decision = policy.evaluate(sessionID, {
      toolName: facet.toolName,
      patterns: facet.patterns,
      metadata: facet.metadata,
    });
    props.mafwPolicy = decision;
    if (decision.action !== 'human') {
      const reply = decision.action === 'auto-approve' ? 'once' : 'reject';
      void runtime?.session?.permissionReply?.(sessionID, facet.requestId, reply, decision.reason)
        .catch((err: any) => log.warn(`[Approval] auto-reply failed (${decision.action}): ${err?.message ?? err}`));
    }
  } catch (err: any) {
    // 评估器异常 → 不富化（下游当 human 处理）：宁多问不误放行
    log.warn(`[Approval] evaluate failed (fail-open → human): ${err?.message ?? err}`);
  }
}
```

`gateway/src/index.ts` 接线（两处）：

(a) 类字段 + 实例化（`budgetGuards` 声明旁 + `initServices` 或构造处，与其他 service 相同时机）：

```typescript
  private approvalPolicy!: ApprovalPolicyService;
  private allowlistStore!: AllowlistStore;
```

初始化（`getPool()`/`initServices` 风格，在 gatewayDb 可用后）：

```typescript
    this.allowlistStore = new AllowlistStore({
      readRawAllowlist: () => (config.raw as any)?.approval?.allowlist,
      persist: (o) => { config.persistOverrides(o as any); },
    });
    this.approvalPolicy = new ApprovalPolicyService({
      getInternalRole: (sid) => this.internalSessionRoles.get(sid),
      allowlistMatches: (toolName, candidate) => this.allowlistStore.matches(toolName, candidate),
      loadMode: async (sid) => this.getGatewayDb().kvGet<string>('perm-mode', sid) ?? 'manual',
      saveMode: async (sid, mode) => { this.getGatewayDb().kvSet('perm-mode', sid, mode); },
      onModeChanged: (sid, mode, reason) => {
        this.broadcast(opencodeBroadcast({ type: 'permission_mode', properties: { mode, reason }, sessionID: sid }));
      },
    });
```

import 加：
```typescript
import { ApprovalPolicyService } from './core/approval/policy-service';
import { AllowlistStore } from './core/approval/allowlist-store';
import { applyApprovalPolicy } from './core/approval/hook';
```

(b) `handleOpencodeEvent` 内，`const { type, properties: props, sessionID } = f;`（line 933）之后、`const role = ...`（line 940 internal 过滤）**之前**插入：

```typescript
    // Approval policy：asked 事件先于 internal 过滤与 Mode A 广播评估（内部会话
    // fail-safe 需在 memoryWorker drop 之前生效）；决策附在广播 properties.mafwPolicy，
    // 三端据此分流（非 human = 直接渲染已决记录，不弹交互卡）。
    if (f.approval && sessionID) {
      applyApprovalPolicy(this.approvalPolicy, this.runtime, f.approval, sessionID, props);
    }
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd gateway && npx jest tests/unit/approval --runInBand && npx jest --runInBand`
Expected: approval 套件 PASS（6 例）+ 全量绿（现有基线无回归）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/approval/hook.ts gateway/src/index.ts gateway/tests/unit/approval/hook.test.ts
git commit -m "feat(approval): event hook — enrich asked broadcast with mafwPolicy, auto-reply fire-and-forget"
```

---

## Batch 2 — 接口面（HTTP 路由 / SDK / persist 扩展）

### Task 6: permission-mode HTTP 路由

**Files:**
- Create: `gateway/src/routes/permission-mode.ts`
- Modify: `gateway/src/index.ts`（注册在 pReplyMatch `~line 4166` 之前）
- Test: `gateway/tests/unit/approval/routes-permission-mode.test.ts`

**Interfaces:**
- Consumes: `ApprovalPolicyService`（Task 4）、`AUTO_APPROVE_BUDGET`（Task 4）
- Produces:
  - `GET /api/sessions/:sessionID/permission-mode` → `{ mode, autoApprovals, budget }`
  - `POST /api/sessions/:sessionID/permission-mode` body `{ mode: 'manual'|'auto' }` → `{ mode, autoApprovals: 0, budget }`（400 枚举错误）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/approval/routes-permission-mode.test.ts
import { IncomingMessage, ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { handlePermissionModeGet, handlePermissionModeSet, PermissionModeDeps } from '../../../src/routes/permission-mode';

function makeRes() {
  const res = new EventEmitter() as any as ServerResponse;
  (res as any).writeHead = (status: number, headers?: any) => { (res as any).statusCode = status; return res; };
  (res as any).end = (body?: any) => { (res as any).body = body; (res as any).ended = true; };
  return res as any as ServerResponse & { statusCode: number; body?: string; ended: boolean };
}

function makeReq(body: any): IncomingMessage {
  const req = new EventEmitter() as any as IncomingMessage;
  process.nextTick(() => { req.emit('data', JSON.stringify(body)); req.emit('end'); });
  return req;
}

function makeDeps(overrides: Partial<PermissionModeDeps> = {}): PermissionModeDeps {
  return {
    policy: {
      getMode: async () => 'auto' as const,
      setMode: async () => {},
      getAutoApprovals: () => 7,
    },
    budget: 25,
    ...overrides,
  };
}

describe('GET /api/sessions/:sid/permission-mode', () => {
  it('返回 mode + 计数 + 预算', async () => {
    const res = makeRes();
    await handlePermissionModeGet(res, 's1', makeDeps());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toEqual({ mode: 'auto', autoApprovals: 7, budget: 25 });
  });
});

describe('POST /api/sessions/:sid/permission-mode', () => {
  it('合法 mode → setMode + 返回', async () => {
    const res = makeRes();
    const setCalls: string[] = [];
    await handlePermissionModeSet(makeReq({ mode: 'manual' }), res, 's1', makeDeps({
      policy: { getMode: async () => 'manual', setMode: async (_s, m) => { setCalls.push(m); }, getAutoApprovals: () => 0 },
    }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).mode).toBe('manual');
    expect(setCalls).toEqual(['manual']);
  });

  it('非法 mode → 400', async () => {
    const res = makeRes();
    await handlePermissionModeSet(makeReq({ mode: 'yolo' }), res, 's1', makeDeps());
    expect(res.statusCode).toBe(400);
  });

  it('坏 JSON → 400', async () => {
    const req = new EventEmitter() as any as IncomingMessage;
    const res = makeRes();
    process.nextTick(() => { req.emit('data', '{oops'); req.emit('end'); });
    await handlePermissionModeSet(req, res, 's1', makeDeps());
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/approval/routes-permission-mode.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// gateway/src/routes/permission-mode.ts
// per-session 审批模式 HTTP 面（deps 注入可单测）。注册顺序：必须在
// /api/permissions/:id 通配匹配之前（triage 吞噬教训）。

import * as http from 'http';
import { SessionPermissionMode } from '../core/approval/policy-service';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export interface PermissionModeDeps {
  policy: {
    getMode(sessionID: string): Promise<SessionPermissionMode>;
    setMode(sessionID: string, mode: SessionPermissionMode): Promise<void>;
    getAutoApprovals(sessionID: string): number;
  };
  budget: number;
}

export async function handlePermissionModeGet(
  res: http.ServerResponse,
  sessionID: string,
  deps: PermissionModeDeps,
): Promise<void> {
  try {
    const mode = await deps.policy.getMode(sessionID);
    json(res, 200, { mode, autoApprovals: deps.policy.getAutoApprovals(sessionID), budget: deps.budget });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handlePermissionModeSet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionID: string,
  deps: PermissionModeDeps,
): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch (err: any) {
    json(res, 400, { error: `invalid JSON: ${err.message}` });
    return;
  }
  if (body?.mode !== 'manual' && body?.mode !== 'auto') {
    json(res, 400, { error: "mode must be 'manual'|'auto'" });
    return;
  }
  try {
    await deps.policy.setMode(sessionID, body.mode);
    json(res, 200, { mode: body.mode, autoApprovals: 0, budget: deps.budget });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
```

`index.ts` 注册（`pReplyMatch` 块**之前**插入）：

```typescript
        // per-session 审批模式（manual/auto）—— 必须在 /api/permissions/:id 之前匹配
        const permModeMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/permission-mode(?:\?|$)/);
        if (permModeMatch && (req.method === 'GET' || req.method === 'POST')) {
          const deps = { policy: this.approvalPolicy, budget: AUTO_APPROVE_BUDGET };
          if (req.method === 'GET') await handlePermissionModeGet(res, permModeMatch[1], deps);
          else await handlePermissionModeSet(req, res, permModeMatch[1], deps);
          return;
        }
```

import：`import { handlePermissionModeGet, handlePermissionModeSet } from './routes/permission-mode';` 与 `import { AUTO_APPROVE_BUDGET } from './core/approval/policy-service';`（与 Task 5 import 合并）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/approval/routes-permission-mode.test.ts --runInBand`
Expected: PASS（4 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/permission-mode.ts gateway/src/index.ts gateway/tests/unit/approval/routes-permission-mode.test.ts
git commit -m "feat(approval): GET/POST /api/sessions/:sid/permission-mode"
```

---

### Task 7: allowlist HTTP CRUD 路由

**Files:**
- Create: `gateway/src/routes/allowlist.ts`
- Modify: `gateway/src/index.ts`（注册在 pReplyMatch 之前，紧随 Task 6 路由）
- Test: `gateway/tests/unit/approval/routes-allowlist.test.ts`

**Interfaces:**
- Consumes: `AllowlistStore`（Task 3）
- Produces: `GET /api/approvals/allowlist` → `{ entries }`；`POST` body `{ tool, prefix? }` → `{ success, entries }`（tool 缺失 400）；`DELETE` body `{ tool, prefix? }` → `{ success, entries }`（未命中 404）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/approval/routes-allowlist.test.ts
import { ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { handleAllowlistGet, handleAllowlistPost, handleAllowlistDelete, AllowlistRouteDeps } from '../../../src/routes/allowlist';

function makeRes() {
  const res = new EventEmitter() as any as ServerResponse;
  (res as any).writeHead = (status: number) => { (res as any).statusCode = status; return res; };
  (res as any).end = (body?: any) => { (res as any).body = body; };
  return res as any as ServerResponse & { statusCode: number; body?: string };
}
function makeReq(body: any) {
  const { EventEmitter: EM } = require('events');
  const req = new EM() as any;
  process.nextTick(() => { req.emit('data', JSON.stringify(body)); req.emit('end'); });
  return req;
}

function makeDeps(): AllowlistRouteDeps & { added: any[]; removed: any[] } {
  const added: any[] = [];
  const removed: any[] = [];
  return {
    store: {
      list: () => [{ tool: 'read' }],
      add: async (e: any) => { added.push(e); return { ok: true, entries: [{ tool: 'read' }, e] }; },
      remove: async (e: any) => { removed.push(e); return { ok: true, entries: [{ tool: 'read' }] }; },
    },
    added, removed,
  } as any;
}

describe('allowlist routes', () => {
  it('GET → entries', async () => {
    const res = makeRes();
    await handleAllowlistGet(res, makeDeps());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toEqual({ entries: [{ tool: 'read' }] });
  });

  it('POST 合法条目 → success + entries', async () => {
    const res = makeRes();
    const deps = makeDeps();
    await handleAllowlistPost(makeReq({ tool: 'bash', prefix: 'git status' }), res, deps);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).success).toBe(true);
    expect(deps.added).toEqual([{ tool: 'bash', prefix: 'git status' }]);
  });

  it('POST 缺 tool → 400', async () => {
    const res = makeRes();
    await handleAllowlistPost(makeReq({ prefix: 'x' }), res, makeDeps());
    expect(res.statusCode).toBe(400);
  });

  it('DELETE 未命中 → 404', async () => {
    const res = makeRes();
    const deps = makeDeps();
    (deps as any).store.remove = async () => ({ ok: false, entries: [] });
    await handleAllowlistDelete(makeReq({ tool: 'edit' }), res, deps);
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/approval/routes-allowlist.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// gateway/src/routes/allowlist.ts
// 持久白名单 CRUD（Config 页编辑器 / TUI 持久允许共用）。deps 注入可单测。

import * as http from 'http';
import { AllowlistEntry, AllowlistStore } from '../core/approval/allowlist-store';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export interface AllowlistRouteDeps {
  store: Pick<AllowlistStore, 'list' | 'add' | 'remove'>;
}

function parseEntryBody(body: any): AllowlistEntry | null {
  const tool = typeof body?.tool === 'string' ? body.tool.trim() : '';
  if (!tool) return null;
  const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : '';
  return prefix ? { tool, prefix } : { tool };
}

export async function handleAllowlistGet(res: http.ServerResponse, deps: AllowlistRouteDeps): Promise<void> {
  json(res, 200, { entries: deps.store.list() });
}

export async function handleAllowlistPost(req: http.IncomingMessage, res: http.ServerResponse, deps: AllowlistRouteDeps): Promise<void> {
  let entry: AllowlistEntry | null = null;
  try {
    entry = parseEntryBody(JSON.parse(await readBody(req) || '{}'));
  } catch {
    json(res, 400, { error: 'invalid JSON' });
    return;
  }
  if (!entry) { json(res, 400, { error: 'tool is required (non-empty string); prefix optional' }); return; }
  const result = deps.store.add(entry);
  json(res, 200, { success: result.ok, entries: result.entries });
}

export async function handleAllowlistDelete(req: http.IncomingMessage, res: http.ServerResponse, deps: AllowlistRouteDeps): Promise<void> {
  let entry: AllowlistEntry | null = null;
  try {
    entry = parseEntryBody(JSON.parse(await readBody(req) || '{}'));
  } catch {
    json(res, 400, { error: 'invalid JSON' });
    return;
  }
  if (!entry) { json(res, 400, { error: 'tool is required' }); return; }
  const result = deps.store.remove(entry);
  if (!result.ok) { json(res, 404, { error: 'allowlist entry not found' }); return; }
  json(res, 200, { success: true, entries: result.entries });
}
```

`index.ts` 注册（Task 6 路由块之后、pReplyMatch 之前）：

```typescript
        // 持久白名单 CRUD —— 同样必须在 /api/permissions/:id 之前
        const allowlistMatch = req.url?.match(/^\/api\/approvals\/allowlist(?:\?|$)/);
        if (allowlistMatch) {
          const deps = { store: this.allowlistStore };
          if (req.method === 'GET') await handleAllowlistGet(res, deps);
          else if (req.method === 'POST') await handleAllowlistPost(req, res, deps);
          else if (req.method === 'DELETE') await handleAllowlistDelete(req, res, deps);
          else { res.writeHead(405); res.end(); }
          return;
        }
```

import：`import { handleAllowlistGet, handleAllowlistPost, handleAllowlistDelete } from './routes/allowlist';`

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/approval/routes-allowlist.test.ts --runInBand`
Expected: PASS（4 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/allowlist.ts gateway/src/index.ts gateway/tests/unit/approval/routes-allowlist.test.ts
git commit -m "feat(approval): allowlist CRUD endpoints /api/approvals/allowlist"
```

---

### Task 8: reply persist 扩展（always + persist → 写白名单）

**Files:**
- Modify: `gateway/src/routes/permission.ts`（新增导出 `persistAlwaysToAllowlist`）
- Modify: `gateway/src/index.ts`（pReply 路由块，`const ok = await ...permissionReply!` 成功后调用）
- Test: `gateway/tests/unit/approval/persist-always.test.ts`

**Interfaces:**
- Consumes: `AllowlistStore`（Task 3）
- Produces: `export function persistAlwaysToAllowlist(store: { add(entry: { tool: string; prefix?: string }): { ok: boolean; entries: unknown[] } }, found: { permission?: string; toolName?: string; patterns?: string[] }): { tool: string; prefix?: string } | null`——patterns[0] 去尾部 `*` 为 prefix；patterns 空 → 裸工具名
- 语义：`POST /api/permissions/:id/reply` body `{ reply: 'always', persist?: true }` → 照常 runtime reply，成功后写白名单（**只在该路由**——它有 permissionList 反查；`routes/permission.ts` 的 sessionID 直连路由不支持 persist，契约注释记录）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/approval/persist-always.test.ts
import { persistAlwaysToAllowlist } from '../../../src/routes/permission';

function makeStore() {
  const added: Array<{ tool: string; prefix?: string }> = [];
  return {
    added,
    store: { add: async (e: any) => { added.push(e); return { ok: true, entries: [] }; } },
  };
}

describe('persistAlwaysToAllowlist', () => {
  it('opencode 形状：permission + patterns[0] 去尾部 * 为 prefix', () => {
    const { store, added } = makeStore();
    const r = persistAlwaysToAllowlist(store as any, { permission: 'bash', patterns: ['git status*'] });
    expect(r).toEqual({ tool: 'bash', prefix: 'git status' });
    expect(added).toEqual([{ tool: 'bash', prefix: 'git status' }]);
  });

  it('patterns 空 → 裸工具名', () => {
    const { store, added } = makeStore();
    const r = persistAlwaysToAllowlist(store as any, { permission: 'bash', patterns: [] });
    expect(r).toEqual({ tool: 'bash' });
    expect(added).toEqual([{ tool: 'bash' }]);
  });

  it('pi 形状：toolName 兜底', () => {
    const { store } = makeStore();
    const r = persistAlwaysToAllowlist(store as any, { toolName: 'webfetch', patterns: [] });
    expect(r).toEqual({ tool: 'webfetch' });
  });

  it('tool 全空 → null 不写', () => {
    const { store, added } = makeStore();
    expect(persistAlwaysToAllowlist(store as any, { patterns: ['x'] })).toBeNull();
    expect(added.length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/approval/persist-always.test.ts --runInBand`
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现**

`routes/permission.ts` 末尾追加：

```typescript
/** 'always' + persist 的白名单写回：patterns[0] 去尾部 * 为 prefix，patterns 空则裸工具名。
 *  仅供 /api/permissions/:id/reply 路由（有 permissionList 反查）；sessionID 直连路由不支持 persist。 */
export function persistAlwaysToAllowlist(
  store: { add(entry: { tool: string; prefix?: string }): { ok: boolean; entries: unknown[] } },
  found: { permission?: string; toolName?: string; patterns?: string[] },
): { tool: string; prefix?: string } | null {
  const tool = String(found?.permission ?? found?.toolName ?? '').trim();
  if (!tool) return null;
  const firstPattern = Array.isArray(found?.patterns) ? String(found.patterns[0] ?? '').trim() : '';
  const prefix = firstPattern.replace(/\*+$/, '').trim();
  const entry = prefix ? { tool, prefix } : { tool };
  store.add(entry);
  return entry;
}
```

`index.ts` pReply 路由块（`const ok = await runtime.session.permissionReply!(...)` 与 `if (!ok)` 之后、`res.end(JSON.stringify({ status: 'ok' }))` 之前）插入：

```typescript
            if (body.persist === true && reply === 'always') {
              try {
                persistAlwaysToAllowlist(this.allowlistStore, found);
              } catch (persistErr: any) {
                log.warn(`[Permission] persist always to allowlist failed (non-fatal): ${persistErr.message}`);
              }
            }
```

import：`import { persistAlwaysToAllowlist } from './routes/permission';`（若已有该文件 import 则合并）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/approval/persist-always.test.ts --runInBand`
Expected: PASS（4 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/permission.ts gateway/src/index.ts gateway/tests/unit/approval/persist-always.test.ts
git commit -m "feat(approval): reply persist extension — always+persist writes allowlist"
```

---

### Task 9: SDK permissions 命名空间扩展

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`（PermissionsNamespace 接口，~line 602）
- Modify: `packages/gateway-sdk/src/client.ts`（permissions 对象，~line 723）
- Test: `packages/gateway-sdk/src/client.test.ts`（追加 describe）

**Interfaces:**
- Produces（SDK 面，desktop/TUI 消费）：
  - `permissions.getMode(sessionID): Promise<{ mode: 'manual' | 'auto'; autoApprovals: number; budget: number }>`
  - `permissions.setMode(sessionID, mode): Promise<void>`
  - `permissions.listAllowlist(): Promise<{ entries: Array<{ tool: string; prefix?: string }> }>`
  - `permissions.addAllowlist(entry): Promise<{ success: boolean; entries: ... }>`
  - `permissions.removeAllowlist(entry): Promise<{ success: boolean; entries: ... }>`
  - `permissions.reply(id, reply, message?, persist?)` —— 追加第 4 参数
- Desktop preload：`packages/desktop/src/preload/mafw-api.ts`（permissions 命名空间 ~line 163）+ `packages/desktop/src/preload/mafw-types.ts`（~line 134）加同名方法（走既有 `invoke("permissions", ...)` 通用派发）

- [ ] **Step 1: 写失败测试**（client.test.ts 追加；沿用该文件既有的 request mock 模式——若现有测试用 fetch mock，按同样方式断言 URL/method/body）

```typescript
describe('permissions namespace — approval policy face', () => {
  it('getMode GET /api/sessions/:sid/permission-mode', async () => {
    // 按文件既有 mock 模式拦截：GET /api/sessions/s1/permission-mode → { mode: 'auto', autoApprovals: 2, budget: 25 }
    const r = await client.permissions.getMode('s1');
    expect(r.mode).toBe('auto');
  });

  it('setMode POST body { mode }', async () => {
    await client.permissions.setMode('s1', 'manual');
    // 断言 POST /api/sessions/s1/permission-mode，body 含 {"mode":"manual"}
  });

  it('listAllowlist GET /api/approvals/allowlist', async () => {
    const r = await client.permissions.listAllowlist();
    expect(Array.isArray(r.entries)).toBe(true);
  });

  it('addAllowlist / removeAllowlist POST/DELETE', async () => {
    await client.permissions.addAllowlist({ tool: 'bash', prefix: 'git status' });
    await client.permissions.removeAllowlist({ tool: 'bash', prefix: 'git status' });
  });

  it('reply 追加 persist 参数', async () => {
    await client.permissions.reply('id1', 'always', undefined, true);
    // 断言 body 为 { reply: 'always', message: undefined, persist: true }
  });
});
```

（实现时按 `client.test.ts` 既有 mock 基建补全断言细节——mock 不足则补 mock。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/gateway-sdk && npx jest client.test.ts`（或项目既有 test script——`node --test` 则用对应命令）
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现**

`types.ts` PermissionsNamespace 扩展：

```typescript
  reply(id: string, reply: 'once' | 'always' | 'reject', message?: string, persist?: boolean): Promise<void>
  getMode(sessionID: string): Promise<{ mode: 'manual' | 'auto'; autoApprovals: number; budget: number }>
  setMode(sessionID: string, mode: 'manual' | 'auto'): Promise<void>
  listAllowlist(): Promise<{ entries: Array<{ tool: string; prefix?: string }> }>
  addAllowlist(entry: { tool: string; prefix?: string }): Promise<{ success: boolean; entries: Array<{ tool: string; prefix?: string }> }>
  removeAllowlist(entry: { tool: string; prefix?: string }): Promise<{ success: boolean; entries: Array<{ tool: string; prefix?: string }> }>
```

`client.ts` permissions 对象扩展（reply 加第 4 参）：

```typescript
    reply: async (id: string, reply: 'once' | 'always' | 'reject', message?: string, persist?: boolean): Promise<void> => {
      await this.request(`/api/permissions/${encodeURIComponent(id)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply, message, persist }),
      });
    },
    getMode: async (sessionID: string) => {
      return this.request(`/api/sessions/${encodeURIComponent(sessionID)}/permission-mode`);
    },
    setMode: async (sessionID: string, mode: 'manual' | 'auto'): Promise<void> => {
      await this.request(`/api/sessions/${encodeURIComponent(sessionID)}/permission-mode`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
    },
    listAllowlist: async () => {
      return this.request('/api/approvals/allowlist');
    },
    addAllowlist: async (entry: { tool: string; prefix?: string }) => {
      return this.request('/api/approvals/allowlist', { method: 'POST', body: JSON.stringify(entry) });
    },
    removeAllowlist: async (entry: { tool: string; prefix?: string }) => {
      return this.request('/api/approvals/allowlist', { method: 'DELETE', body: JSON.stringify(entry) });
    },
```

Desktop preload `mafw-api.ts` permissions 命名空间追加：

```typescript
      getMode: (sid: string) => invoke("permissions", "getMode", sid),
      setMode: (sid: string, mode: "manual" | "auto") => invoke("permissions", "setMode", sid, mode),
      listAllowlist: () => invoke("permissions", "listAllowlist"),
      addAllowlist: (entry: { tool: string; prefix?: string }) => invoke("permissions", "addAllowlist", entry),
      removeAllowlist: (entry: { tool: string; prefix?: string }) => invoke("permissions", "removeAllowlist", entry),
```

`reply` 行改为 `reply: (id, reply, message?, persist?) => invoke("permissions", "reply", id, reply, message, persist),`；`mafw-types.ts` 同步类型声明。

- [ ] **Step 4: 跑测试确认通过 + SDK 全量**

Run: `cd packages/gateway-sdk && npm test`（按既有命令；此前基线 71 例）
Expected: PASS（新增 5+ 例）

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/client.test.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(sdk): permissions namespace — getMode/setMode/allowlist CRUD + reply persist"
```

---

## Batch 3 — Desktop 迁移

### Task 10: permission-card-mapping 纯函数模块（含 mafwPolicy 合并）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/permission-card-mapping.ts`
- Create: `packages/desktop/src/renderer/mafw/components/permission-card-mapping.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（mapPermissionCard/actionTypeOf/riskOf/dangerousPartsOf 改为 import，~line 987-1051）

**Interfaces:**
- Produces: `export function mapPermissionCard(req: any, createdAt: number, agentTitle: string): PermissionCardData`（`mafwPolicy` 合并：`action:auto-approve` → status `allowed-once` + `autoResolved:'auto'`；`auto-deny` → `denied` + `autoResolved:'internal'`；`human` → pending + verdict 决定 risk）；`export function actionTypeOf / riskOf / dangerousPartsOf`（从 MafwShell 平移）
- `PermissionCardData` 增 `autoResolved?: "auto" | "internal"`（Task 12 消费）

- [ ] **Step 1: 写失败测试**

```typescript
// packages/desktop/src/renderer/mafw/components/permission-card-mapping.test.ts
import { describe, expect, test } from "bun:test";
import { mapPermissionCard } from "./permission-card-mapping";

const baseReq = {
  id: "r1", sessionID: "s1", permission: "bash", patterns: ["npm test"],
  metadata: { impact: "run command" },
};

describe("mapPermissionCard — mafwPolicy 合并", () => {
  test("无 mafwPolicy → pending + 本地 risk 启发式", () => {
    const c = mapPermissionCard(baseReq, 1, "Agent");
    expect(c.status).toBe("pending");
    expect(c.autoResolved).toBeUndefined();
    expect(c.risk).toBe("medium");
  });

  test("auto-approve → allowed-once + autoResolved:auto", () => {
    const c = mapPermissionCard({ ...baseReq, mafwPolicy: { action: "auto-approve", verdict: "safe", reason: "auto mode (1/25)" } }, 1, "Agent");
    expect(c.status).toBe("allowed-once");
    expect(c.autoResolved).toBe("auto");
  });

  test("auto-deny → denied + autoResolved:internal", () => {
    const c = mapPermissionCard({ ...baseReq, mafwPolicy: { action: "auto-deny", verdict: "safe", reason: "internal session" } }, 1, "Agent");
    expect(c.status).toBe("denied");
    expect(c.autoResolved).toBe("internal");
  });

  test("human + verdict dangerous → pending + risk high（gateway 判定优先于本地启发式）", () => {
    const c = mapPermissionCard({ ...baseReq, mafwPolicy: { action: "human", verdict: "dangerous", reason: "dangerous command pattern" } }, 1, "Agent");
    expect(c.status).toBe("pending");
    expect(c.risk).toBe("high");
  });

  test("human + verdict safe → pending + risk medium（即使本地启发式判 high）", () => {
    const c = mapPermissionCard(
      { ...baseReq, permission: "unlink", patterns: [], mafwPolicy: { action: "human", verdict: "safe", reason: "" } },
      1, "Agent",
    );
    expect(c.risk).toBe("medium");
  });

  test("pi 形状（toolName/args）经 mafwPolicy 正常合并", () => {
    const c = mapPermissionCard(
      { id: "r2", sessionID: "s1", toolName: "bash", args: { command: "npm test" }, mafwPolicy: { action: "auto-approve", verdict: "safe", reason: "persistent allowlist match" } },
      1, "Agent",
    );
    expect(c.status).toBe("allowed-once");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && npx bun test src/renderer/mafw/components/permission-card-mapping.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

把 MafwShell 的 `actionTypeOf`（987-996）、`riskOf`（998-1004）、`dangerousPartsOf`（1006-1012）原样平移到新文件，加 `mapPermissionCard`（对齐 MafwShell 1031-1051，差异：`agentTitle` 参数化 + mafwPolicy 合并）：

```typescript
// packages/desktop/src/renderer/mafw/components/permission-card-mapping.ts
// 纯函数（bun 可测）：asked 事件 / permissionList 项 → PermissionCardData。
// mafwPolicy（gateway 富化）优先：auto-approve/auto-deny 直接出生即 resolved
// （非交互记录，不进串行队列不发通知）；human 时 verdict 覆盖本地 risk 启发式。
import type { PermissionCardData } from "./PermissionCard";

export function actionTypeOf(permission: string): { type: string; title: string } {
  const p = permission.toLowerCase()
  if (p.includes("bash") || p.includes("shell") || p.includes("terminal") || p.includes("command")) {
    return { type: "shell", title: "执行 Shell 命令" }
  }
  if (p.includes("unlink") || p.includes("delete")) return { type: "file-delete", title: "删除文件" }
  if (p.includes("write") || p.includes("edit")) return { type: "file-write", title: "写入文件" }
  if (p.includes("network") || p.includes("webfetch") || p.includes("http")) return { type: "network", title: "访问网络" }
  return { type: "custom", title: permission }
}

export function riskOf(permission: string, patterns: string[]): "medium" | "high" {
  const p = permission.toLowerCase()
  const joined = patterns.join(" ").toLowerCase()
  if (p.includes("unlink") || p.includes("delete")) return "high"
  if (p.includes("bash") && /\b(rm|del|format)\b/.test(joined)) return "high"
  return "medium"
}

export function dangerousPartsOf(permission: string, patterns: string[]): string[] {
  const parts: string[] = []
  for (const pat of patterns) {
    if (/\b(rm|del|format|mv|dd)\b/.test(pat.toLowerCase())) parts.push(pat)
  }
  return parts
}

export function mapPermissionCard(req: any, createdAt: number, agentTitle: string): PermissionCardData {
  const patterns = Array.isArray(req.patterns) ? req.patterns : []
  const permission = req.permission ?? req.toolName ?? ""
  const { type, title } = actionTypeOf(permission)
  const policy = req.mafwPolicy as { action?: string; verdict?: string } | undefined
  const status: PermissionCardData["status"] =
    policy?.action === "auto-approve" ? "allowed-once"
    : policy?.action === "auto-deny" ? "denied"
    : "pending"
  const risk: PermissionCardData["risk"] =
    policy?.verdict === "dangerous" ? "high"
    : policy?.verdict === "safe" && policy?.action === "human" ? "medium"
    : riskOf(permission, patterns)
  return {
    id: req.id,
    sessionID: req.sessionID,
    agentName: agentTitle || "Agent",
    status,
    risk,
    autoResolved: policy?.action === "auto-approve" ? "auto" : policy?.action === "auto-deny" ? "internal" : undefined,
    action: {
      type,
      title,
      payload: patterns.join(" && ") || permission,
      dangerousParts: dangerousPartsOf(permission, patterns),
    },
    impact: req.metadata?.impact as string | undefined,
    createdAt,
    messageID: req.tool?.messageID,
    callID: req.tool?.callID,
  }
}
```

MafwShell：删除本地四个函数，`import { mapPermissionCard } from "./components/permission-card-mapping"`；调用点改为 `mapPermissionCard(req, Date.now(), sessions().find(s => s.id === req.sessionID)?.title || "Agent")`（三处：reconcileFlowCards ~1060、asked 轮询 ~1318、SSE asked ~1414）。

`PermissionCardData`（PermissionCard.tsx line 7-25）加 `autoResolved?: "auto" | "internal"`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/desktop && npx bun test src/renderer/mafw/components/permission-card-mapping.test.ts`
Expected: PASS（6 例）

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/permission-card-mapping.ts packages/desktop/src/renderer/mafw/components/permission-card-mapping.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/PermissionCard.tsx
git commit -m "feat(desktop): extract permission card mapping pure module with mafwPolicy merge"
```

---

### Task 11: MafwShell 迁移（删 renderer auto 块 / SSE 驱动 mode / 5s 对账兜底）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/permission-mode.ts` + `permission-mode.test.ts`
- Test: `packages/desktop/src/renderer/mafw/components/permission-mode-migration.test.ts`（新，纯函数部分）

**Interfaces:**
- Consumes: `window.api.mafw.permissions.getMode/setMode`（Task 9 preload）、`mapPermissionCard`（Task 10）
- Produces: SSE `permission_mode` 分支（`event.properties.mode` → `setPermissionModes`）；`syncPermissionMode(sid)` helper；🛡 toggle 乐观更新 + 失败回滚

- [ ] **Step 1: 写失败测试**（迁移涉及 MafwShell 内部接线——可单测的纯决策抽到测试文件）

```typescript
// packages/desktop/src/renderer/mafw/components/permission-mode-migration.test.ts
import { describe, expect, test } from "bun:test";

// 从 MafwShell 抽出的纯决策（实现放 MafwShell 顶部或独立小模块）：
// 1) nextMode(prev)  2) shouldNotify(card) —— autoResolved 卡不发 OS 通知
export function nextMode(prev: "manual" | "auto"): "manual" | "auto" {
  return prev === "manual" ? "auto" : "manual"
}
export function shouldNotify(card: { autoResolved?: string }): boolean {
  return !card.autoResolved
}

describe("permission mode migration helpers", () => {
  test("nextMode 循环", () => {
    expect(nextMode("manual")).toBe("auto")
    expect(nextMode("auto")).toBe("manual")
  })
  test("autoResolved 卡不发通知；human 卡发", () => {
    expect(shouldNotify({ autoResolved: "auto" })).toBe(false)
    expect(shouldNotify({ autoResolved: "internal" })).toBe(false)
    expect(shouldNotify({})).toBe(true)
  })
})
```

（TDD 红：先只写测试文件，helpers 实现随后与 MafwShell 改动一并提交。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && npx bun test src/renderer/mafw/components/permission-mode-migration.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 MafwShell 改动**

(a) **删除 renderer auto-approve**：SSE `permission.asked` 分支（~1393-1407）改为：

```typescript
      if (event.type === "permission.asked") {
        console.log("[mafw] SSE permission.asked", sid, event.properties?.id, event.properties?.permission)
        const card = mapPermissionCard(event.properties || {}, Date.now(), sessions().find(s => s.id === sid)?.title || "Agent")
        upsertCard(sid, { kind: "permission", data: card })
        if (!card.autoResolved) {
          notifyIfHidden("MAFW：需要权限审批", String(event.properties?.permission?.tool || "工具调用").slice(0, 80))
        } else {
          // auto 决策兜底：5s 后对账服务端真值（auto-reply 失败时卡片回 pending 可手动答复）
          setTimeout(() => reconcileFlowCards(), 5000)
        }
        return
      }
```

同时删除：`shouldAutoApprove` import、`autoApprovalCounts`（line 348）、`permission-mode.ts` import、整个 auto-approve 块（1398-1405）。

(b) **SSE `permission_mode` 分支**（onmessage 内，与 `permission.replied` 分支同层）：

```typescript
      if (event.type === "permission_mode") {
        const pmSid = event.sessionID || event.properties?.sessionID
        const pmMode = event.properties?.mode
        if (pmSid && (pmMode === "manual" || pmMode === "auto")) setPermissionModes(pmSid, pmMode)
        return
      }
```

(c) **初始拉取**：`openSessionTab`（line 215）末尾加：

```typescript
    void window.api.mafw.permissions.getMode(sid)
      .then((m: any) => { if (m?.mode === "manual" || m?.mode === "auto") setPermissionModes(sid, m.mode) })
      .catch(() => {})
```

加 helper（`reconcileFlowCards` 旁）：

```typescript
  // mode 初始同步：reconcile 时对有卡会话补拉（覆盖非 tab 打开路径，如全局 Approvals 页）
  const syncPermissionModes = () => {
    for (const sid of Object.keys(flowCards())) {
      void window.api.mafw.permissions.getMode(sid)
        .then((m: any) => { if (m?.mode === "manual" || m?.mode === "auto") setPermissionModes(sid, m.mode) })
        .catch(() => {})
    }
  }
```

`reconcileFlowCards` 开头调 `syncPermissionModes()`。

(d) **🛡 toggle 改 API 化**（~line 2521-2522）：

```typescript
                          permissionMode={permissionModes[leaf.sid] || "manual"}
                          onTogglePermissionMode={() => {
                            const prev = (permissionModes[leaf.sid] || "manual") as "manual" | "auto"
                            const next = prev === "manual" ? "auto" : "manual"
                            setPermissionModes(leaf.sid, next) // 乐观更新
                            window.api.mafw.permissions.setMode(leaf.sid, next).catch(() => {
                              setPermissionModes(leaf.sid, prev) // 回滚
                              showToastV2({ description: "切换审批模式失败", duration: 2000 })
                            })
                          }}
```

(e) **删除** `components/permission-mode.ts` 与 `permission-mode.test.ts`（`shouldAutoApprove`/`AUTO_APPROVE_BUDGET` 语义已由 gateway policy-service 承接；`nextPermissionMode` 由内联三元替代）。migration.test.ts 的两个 helper（nextMode/shouldNotify）实现放 `permission-card-mapping.ts` 并导出（就近原则，测试 import 路径同步改）。

- [ ] **Step 4: 跑测试 + typecheck + build**

Run: `cd packages/desktop && npx bun test && npx tsgo -b . 2>&1 | Select-Object -First 20 ; npx electron-vite build`
Expected: bun test 全绿（migration 2 例 + 既有）；typecheck 无新增错误（存量 i18n 5 个基线错误除外）；build 成功

- [ ] **Step 5: Commit**

```bash
git add -A packages/desktop/src/renderer/mafw
git commit -m "feat(desktop): migrate permission mode to gateway — SSE-driven, auto block removed, 5s reconcile fallback"
```

---

### Task 12: PermissionCard 持久允许 + autoResolved 徽标

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/PermissionCard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（onPermReply 签名 + onAllowPersist 接线，~line 105/1584）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（permReply 加 persist 参数）

**Interfaces:**
- Produces: `onPermReply(card, reply, message?, persist?)`；PermissionCard props 增 `onAllowPersist?: () => void`；StatusBadge 对 `autoResolved` 显示「已自动放行」/「已自动拒绝 · 内部」

- [ ] **Step 1-5: TDD 徽标纯逻辑**（autoResolved → 徽标文案的映射抽纯函数 `autoBadgeText(autoResolved)` 放 PermissionCard.tsx 顶部并导出，bun 测试 3 例：auto→"已自动放行"、internal→"已自动拒绝 · 内部"、undefined→null）

StatusBadge 修改：

```tsx
function StatusBadge(props: { status: string; autoResolved?: "auto" | "internal" }) {
  if (props.autoResolved === "internal") {
    return <span class="mafw-flow-badge mafw-flow-badge-danger">已自动拒绝 · 内部</span>
  }
  if (props.status === "allowed-once" || props.status === "allowed-always") {
    if (props.autoResolved === "auto") return <span class="mafw-flow-badge mafw-flow-badge-ok">已自动放行</span>
    return <span class="mafw-flow-badge mafw-flow-badge-ok">{props.status === "allowed-always" ? "始终允许" : "已允许"}</span>
  }
  // ...原 denied/expired/pending 分支不变
}
```

（`<StatusBadge status={props.data.status} autoResolved={props.data.autoResolved} />` 调用点同步。）

Footer 动作区（「本会话始终允许」按钮旁）加：

```tsx
            <ButtonV2
              variant="ghost" size="small" class="mafw-flow-btn-ghost"
              aria-label="持久允许（跨会话记住）"
              onClick={() => props.onAllowPersist?.()}
            >
              持久允许
            </ButtonV2>
```

keyhint 行改：`Y 允许一次 · A 始终允许 · P 持久允许 · N 拒绝`；键盘分支加 `else if (k === "p") { e.preventDefault(); props.onAllowPersist?.() }`。

ChatPane：`onPermReply: (card, reply, message?, persist?) => void`（line 105）；PermissionCard 调用处（~1584）加 `onAllowPersist={() => props.onPermReply(c.data, "always", undefined, true)}`。

MafwShell `permReply`（~1127）：

```typescript
  const permReply = async (card: PermissionCardData, reply: "once" | "always" | "reject", message?: string, persist?: boolean) => {
    try {
      await window.api.mafw.permissions.reply(card.id, reply, message, persist)
      resolveCard(card.sessionID, card.id, {
        status: reply === "always" ? "allowed-always" : reply === "reject" ? "denied" : "allowed-once",
      })
    } catch (e) {
      console.warn("[mafw] permission reply failed:", e)
      showToastV2({ description: "操作失败", duration: 2000 })
    }
  }
```

Run: `cd packages/desktop && npx bun test src/renderer/mafw/components/`
Expected: 新增 3 例 PASS + 既有绿

Commit: `feat(desktop): persistent-allow action + autoResolved badges on permission card`

---

### Task 13: Config 页「审批 Approvals」区块

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ApprovalsSection.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`（Runtime/Models 等卡片同层渲染 `<ApprovalsSection />`）
- Test: 条目序号化纯函数 `sortAllowlistEntries`（tool 字典序、有 prefix 在后）bun 测试 3 例

**Interfaces:**
- Consumes: `window.api.mafw.permissions.listAllowlist/addAllowlist/removeAllowlist`（Task 9）

实现要点（组件骨架）：

```tsx
export function ApprovalsSection() {
  const [entries, setEntries] = createSignal<Array<{ tool: string; prefix?: string }>>([])
  const [tool, setTool] = createSignal("")
  const [prefix, setPrefix] = createSignal("")
  const refresh = () => window.api.mafw.permissions.listAllowlist()
    .then((r: any) => setEntries(sortAllowlistEntries(r?.entries ?? [])))
    .catch(() => {})
  onMount(refresh)
  const add = async () => {
    const t = tool().trim(); if (!t) return
    const entry = prefix().trim() ? { tool: t, prefix: prefix().trim() } : { tool: t }
    try { await window.api.mafw.permissions.addAllowlist(entry); setTool(""); setPrefix(""); refresh() }
    catch { showToastV2({ description: "添加失败", duration: 2000 }) }
  }
  const remove = async (e: { tool: string; prefix?: string }) => {
    try { await window.api.mafw.permissions.removeAllowlist(e); refresh() }
    catch { showToastV2({ description: "删除失败", duration: 2000 }) }
  }
  // 渲染：section 卡片（对齐 Config 页既有卡片样式）——标题「审批 Approvals」+
  // 说明文案「白名单条目在评估顺序第 2 步生效：内部会话拒绝 → 持久白名单 → 会话模式 → 人工」+
  // 表格（tool / prefix / 删除 ButtonV2 ghost）+ 添加行（TextInputV2 ×2 + ButtonV2）+ 空态文案
}
```

UI 约束：全部 `@mafw/ui/v2`（ButtonV2/TextInputV2/ToastV2），禁裸 button/input；无裸 `title` 属性（用 TooltipV2 `openDelay: 300`）。

Run: `cd packages/desktop && npx bun test && npx electron-vite build`
Expected: 全绿 + build 成功

Commit: `feat(desktop): approvals allowlist editor section in Config page`

---

## Batch 4 — TUI 接入

### Task 14: PermissionModeStore + /perm 命令 + 状态栏徽标

**Files:**
- Create: `packages/tui/src/store/permission-mode.ts`
- Modify: `packages/tui/src/ui/command-registry.ts`（命令表加 `permissions`）
- Modify: `packages/tui/src/ui/slash-commands.ts`（SlashDeps + case）
- Modify: `packages/tui/src/ui/app.ts`（store 实例 / 初始加载 / SSE / slash 实现）
- Modify: `packages/tui/src/ui/status-bar.ts`（StatusState + render）
- Modify: `packages/tui/src/store/connection.ts`（订阅事件列表加 `permission_mode`，line ~21 旁）
- Test: `packages/tui/tests/permission-mode.test.ts`

**Interfaces:**
- Produces: `export class PermissionModeStore { get(sid): 'manual'|'auto'; set(sid, mode); load(sid): Promise<void>; toggle(sid): Promise<'manual'|'auto'> }`（构造注入 `{ permissions: { getMode; setMode } }` 形状的 client 片段）
- StatusState 增 `permAuto?: boolean`；render 增 `if (s.permAuto) parts.push(theme.warn('🛡 auto'))`（busy 之后）

- [ ] **Step 1: 写失败测试**

```typescript
// packages/tui/tests/permission-mode.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionModeStore } from '../src/store/permission-mode.ts';

function makeClient() {
  const calls: Array<{ sid: string; mode: string }> = [];
  return {
    calls,
    permissions: {
      getMode: async (sid: string) => (sid === 's-auto' ? { mode: 'auto', autoApprovals: 0, budget: 25 } : { mode: 'manual', autoApprovals: 0, budget: 25 }),
      setMode: async (sid: string, mode: string) => { calls.push({ sid, mode }); },
    },
  };
}

test('缺省 manual；load 拉取 kv 值', async () => {
  const c = makeClient();
  const s = new PermissionModeStore(c as any);
  assert.equal(s.get('s-auto'), 'manual');
  await s.load('s-auto');
  assert.equal(s.get('s-auto'), 'auto');
});

test('toggle 切换并 setMode', async () => {
  const c = makeClient();
  const s = new PermissionModeStore(c as any);
  const next = await s.toggle('s1');
  assert.equal(next, 'auto');
  assert.equal(s.get('s1'), 'auto');
  assert.deepEqual(c.calls, [{ sid: 's1', mode: 'auto' }]);
  const next2 = await s.toggle('s1');
  assert.equal(next2, 'manual');
});

test('load 失败 fail-open 保持缺省', async () => {
  const c = makeClient();
  c.permissions.getMode = async () => { throw new Error('down'); };
  const s = new PermissionModeStore(c as any);
  await s.load('s1');
  assert.equal(s.get('s1'), 'manual');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/tui && node --test tests/permission-mode.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// packages/tui/src/store/permission-mode.ts
export interface PermissionModeClient {
  permissions: {
    getMode(sessionID: string): Promise<{ mode: 'manual' | 'auto' }>;
    setMode(sessionID: string, mode: 'manual' | 'auto'): Promise<void>;
  };
}

/** per-session 审批模式状态（gateway kv 为真相源；SSE permission_mode 事件驱动更新）。 */
export class PermissionModeStore {
  private modes = new Map<string, 'manual' | 'auto'>();
  constructor(private client: PermissionModeClient) {}
  get(sid: string): 'manual' | 'auto' { return this.modes.get(sid) ?? 'manual'; }
  set(sid: string, mode: 'manual' | 'auto'): void { this.modes.set(sid, mode); }
  async load(sid: string): Promise<void> {
    try { this.set(sid, (await this.client.permissions.getMode(sid)).mode); } catch { /* fail-open */ }
  }
  async toggle(sid: string): Promise<'manual' | 'auto'> {
    const next = this.get(sid) === 'manual' ? 'auto' : 'manual';
    await this.client.permissions.setMode(sid, next);
    this.set(sid, next);
    return next;
  }
}
```

command-registry.ts 加：`{ name: 'permissions', description: '切换审批模式 manual/auto', category: '会话', aliases: ['perm'], immediate: true },`

slash-commands.ts SlashDeps 加 `/** /permissions（别名 /perm）：切换审批模式；返回提示文本。 */ togglePermissionMode(): Promise<string>`；createSlashHandler 加 case：

```typescript
      case 'permissions':
        return deps.togglePermissionMode()
```

app.ts 接线：

```typescript
  const permStore = new PermissionModeStore(client)
  if (managerSessionID) void permStore.load(managerSessionID)
  // onEvent 增分支（与 permission.asked 同层）：
  //   if (type === 'permission_mode') {
  //     const sid = data?.sessionID ?? data?.properties?.sessionID
  //     const mode = data?.properties?.mode
  //     if (sid && (mode === 'manual' || mode === 'auto')) {
  //       permStore.set(sid, mode)
  //       setStatus({ permAuto: mode === 'auto' })
  //     }
  //   }
  // slash deps 实现：
  //   togglePermissionMode: async () => {
  //     if (!managerSessionID) return '未连接会话'
  //     try {
  //       const next = await permStore.toggle(managerSessionID)
  //       setStatus({ permAuto: next === 'auto' })
  //       return next === 'auto' ? '审批模式：auto（安全命令自动放行，预算 25 次）' : '审批模式：manual（每次询问）'
  //     } catch { return '切换失败（gateway 不可达）' }
  //   },
```

status-bar.ts：`StatusState` 加 `/** 审批模式 auto（gateway policy） */ permAuto?: boolean`；render 在 `if (s.busy)` 之后加 `if (s.permAuto) parts.push(theme.warn('🛡 auto'))`。

connection.ts 订阅事件列表加 `'permission_mode'`。

- [ ] **Step 4: 跑测试确认通过 + TUI 全量**

Run: `cd packages/tui && node --test tests/permission-mode.test.ts && node --test tests/`
Expected: 新增 3 例 PASS + 全量绿（基线 1 例冒烟跳过除外）

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src packages/tui/tests
git commit -m "feat(tui): /permissions command + permission mode store + status bar badge"
```

---

### Task 15: TUI overlay 门控 + 持久允许选项

**Files:**
- Modify: `packages/tui/src/ui/overlays.ts`（第四选项 + reply 类型扩展）
- Modify: `packages/tui/src/ui/app.ts`（asked 门控 + persist 接线 + hint 提示）
- Test: `packages/tui/tests/permission-overlay.test.ts`

**Interfaces:**
- Produces: `permissionToItems()` 四项（once/always/persist/reject）；`showPermissionOverlay(tui, req, reply: (r: 'once' | 'always' | 'persist' | 'reject') => Promise<void>)`；app.ts asked 分支：`req.mafwPolicy?.action` 非 'human' 不弹 overlay（hint 短暂提示），human 弹 overlay 且 persist → `client.permissions.reply(req.id, 'always', undefined, true)`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/tui/tests/permission-overlay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionToItems, shouldShowOverlay } from '../src/ui/overlays.ts';

test('选项含持久允许（第四项）', () => {
  const items = permissionToItems();
  assert.equal(items.length, 4);
  assert.deepEqual(
    items.map((i) => i.value),
    ['once', 'always', 'persist', 'reject'],
  );
});

test('shouldShowOverlay：human 才弹；auto-approve/auto-deny 不弹', () => {
  assert.equal(shouldShowOverlay({ mafwPolicy: { action: 'human' } }), true);
  assert.equal(shouldShowOverlay({ mafwPolicy: { action: 'auto-approve' } }), false);
  assert.equal(shouldShowOverlay({ mafwPolicy: { action: 'auto-deny' } }), false);
  assert.equal(shouldShowOverlay({}), true); // 无富化（旧 gateway）保守弹
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/tui && node --test tests/permission-overlay.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

overlays.ts：

```typescript
export function permissionToItems(): SelectItem[] {
  return [
    { value: 'once', label: '允许一次', description: '仅本次' },
    { value: 'always', label: '总是允许', description: '本会话内' },
    { value: 'persist', label: '持久允许', description: '跨会话记住' },
    { value: 'reject', label: '拒绝', description: '拒绝此请求' },
  ]
}

/** gateway 已自动答复（mafwPolicy.action !== 'human'）的 asked 不弹 overlay。 */
export function shouldShowOverlay(req: { mafwPolicy?: { action?: string } }): boolean {
  const action = req.mafwPolicy?.action
  return !action || action === 'human'
}
```

`showPermissionOverlay` 的 `reply` 参数类型改 `(r: 'once' | 'always' | 'persist' | 'reject') => Promise<void>`（其余不变）。

app.ts onEvent asked 分支改：

```typescript
    if (type === 'permission.asked') {
      const req: any = data?.properties ?? data
      if (req?.id) {
        if (shouldShowOverlay(req)) {
          showPermissionOverlay(tui, req, (r) => {
            if (r === 'persist') return client.permissions.reply(req.id, 'always', undefined, true)
            return client.permissions.reply(req.id, r)
          })
        } else {
          // gateway 已自动放行/拒绝 —— 状态栏短提示，不弹 overlay
          const label = req.mafwPolicy?.action === 'auto-approve' ? '已自动放行' : '已自动拒绝(内部)'
          const tool = req.permission ?? req.toolName ?? 'tool'
          setStatus({ hint: `${label}: ${tool} (gateway policy)` })
          setTimeout(() => setStatus({ hint: undefined }), 3000)
        }
      }
    }
```

（import `shouldShowOverlay`；TUI 相对 import 带 `.ts` 后缀。）

- [ ] **Step 4: 跑全量测试 + 三包回归 + 汇报**

Run: `cd packages/tui && node --test tests/`；`cd gateway && npx jest --runInBand`；`cd packages/desktop && npx bun test`
Expected: 全绿

- [ ] **Step 5: 版本号 bump + 交付汇报**

- 根 `package.json` version bump（minor，如 `4.12.0`）
- Commit: `feat: approval policy service — full delivery (gateway + desktop + TUI)`
- 汇报：版本号 + commit 哈希 + 新增测试数（gateway ~50 / desktop ~11 / TUI ~5-6）+ 三包全量通过数

---

## Self-Review（计划完成后自查记录）

1. **Spec 覆盖**：§5.1 切面→Task 1；§5.2 kv→Task 4/5；§5.3 config 段→Task 3；§6.1 分类器→Task 2；§6.2 评估顺序→Task 4；§6.3 allowlist→Task 3/7；§6.4 钩子+富化→Task 5；§7 HTTP→Task 6/7/8；§8 SDK→Task 9；§9.1 desktop→Task 10/11/12；§9.2 TUI→Task 14/15；§9.3 Config 页→Task 13；§10 错误处理→Task 4/5（fail-open 分支有测试）；§12 分批→Batch 1-4。无缺口。
2. **占位符**：Task 9 SDK 测试的 mock 断言标注"按既有 mock 基建补全"（文件已有基建，非 TBD）；Task 13 Config.tsx 接入点给出区块层级的明确定位。无其他占位符。
3. **类型一致性**：`ApprovalCandidate`（Task 2 定义，3/4/5 消费）；`PolicyDecision`（Task 4 定义，5/10 消费，desktop 读 `mafwPolicy.action/verdict` 字段名一致）；`AllowlistEntry`（Task 3 定义，7/8/9/13 消费）；`reply` persist 第 4 参（9 定义，12/15 消费）；`permission_mode` 事件形状 `{ type, properties: { mode, reason }, sessionID }`（Task 5 广播，11/14 消费一致）。
