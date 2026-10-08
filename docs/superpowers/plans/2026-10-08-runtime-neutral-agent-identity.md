# Runtime 中立 Agent 身份（IdentityRegistry）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MAFW agent 身份（manager / memory-curator）收敛到 gateway 持有的 IdentityRegistry，经物化（materialization）+ agent 参数绑定进入任意 runtime，护栏由网关策略层统一评估。

**Architecture:** IdentityRegistry 是身份单一事实源（systemPrompt + policy）；启动时遍历注册表调 `agents.install`（= 物化，opencode/pi 现役实现零重写）；`IdentityState` 内存跟踪 session→identity 绑定与 (runtime, identity) 物化状态；prompt 包装器按物化状态注入/剥离 agent 参数；`ApprovalPolicyService.evaluate` 增加身份维度（先于 internal blanket-deny）；`applyApprovalPolicy` 既有自动应答器零改动自动生效。

**Tech Stack:** TypeScript (gateway, CommonJS), jest, 无新依赖。

**Spec:** `docs/superpowers/specs/2026-10-08-runtime-neutral-agent-identity-design.md`（含 §3.3 评估顺序修正）

## Global Constraints

- 版本：v4.20.0 → v4.21.0（Task 7 bump）
- 测试基线：**240 suites / 1628 tests**——每个 Task 结束 `cd gateway; npx jest --runInBand` 全绿，不得低于基线（只增不减）
- **jest 不 typecheck `gateway/src/index.ts`**——改后必须 `npm run build`（root）验证编译
- `git add` 路径必须 repo 根相对；中文内容只经 write/edit 工具（PowerShell 管道损坏 UTF-8）
- TDD：先写失败测试再实现；每 Task 一个 commit
- 现有行为保持：opencode/pi 上物化产物（agent md / prompts+extension）与今天逐字节等价（nativePermissions 逃生舱保证）
- 车道 2/3（injectSystem 身份块 / 消息位）本期**不实现**（spec §2 非目标）

---

### Task 1: IdentitySpec 类型 + 内置注册表 + toAgentDefinition + 类别解析

**Files:**
- Create: `gateway/src/runtime/identity-registry.ts`
- Test: `gateway/tests/unit/runtime/identity-registry.test.ts`

**Interfaces:**
- Consumes: `AgentDefinition`（`gateway/src/runtime/agent-definition.ts`）、`MANAGER_IDENTITY_SYSTEM_PROMPT`（`gateway/src/skills/manager-identity.ts`）、`MAFW_TOOL_ALLOWLIST`（`gateway/src/skills/manager-agent-config.ts`）、`MEMORY_CURATOR_BASE_PROMPT`/`MEMORY_CURATOR_TOOLS`（`gateway/src/skills/memory-curator-agent.ts`）
- Produces（后续 Task 依赖的精确签名）:
  - `interface IdentityPolicy { deny: string[]; allowlist?: string[] }`
  - `interface IdentitySpec { name: string; description: string; scope: 'primary' | 'worker'; systemPrompt: string; model?: { providerID: string; modelID: string }; policy: IdentityPolicy; nativePermissions?: Partial<AgentDefinition['permissions']> & { tools?: Record<string, boolean> } }`
  - `interface IdentityRegistry { list(): IdentitySpec[]; get(name: string): IdentitySpec | undefined }`
  - `function createBuiltinIdentityRegistry(): IdentityRegistry`
  - `function toAgentDefinition(spec: IdentitySpec): AgentDefinition`
  - `type ToolCategory = 'file-edit' | 'shell' | 'subagent' | 'web' | 'readonly'`
  - `function resolveToolCategory(toolName: string, runtimeName: string): ToolCategory | null`
  - `function policyDecides(policy: IdentityPolicy, toolName: string, categoryOf: (t: string) => ToolCategory | null): 'allow' | 'deny' | null`——null = 白名单不存在且未命中 deny（落穿）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime/identity-registry.test.ts
import {
  createBuiltinIdentityRegistry, toAgentDefinition, resolveToolCategory, policyDecides,
} from '../../../../src/runtime/identity-registry';

const registry = createBuiltinIdentityRegistry();
const manager = registry.get('manager')!;
const curator = registry.get('memory-curator')!;

describe('builtin identities', () => {
  it('has manager (primary) and memory-curator (worker)', () => {
    expect(registry.list().map((i) => i.name).sort()).toEqual(['manager', 'memory-curator']);
    expect(manager.scope).toBe('primary');
    expect(curator.scope).toBe('worker');
    expect(manager.systemPrompt).toContain('MAFW');
  });

  it('manager policy denies file-edit/subagent, allowlists mafw_*/shell/readonly', () => {
    expect(manager.policy.deny.sort()).toEqual(['file-edit', 'subagent']);
    for (const e of ['mafw_*', 'question', 'plan_exit', 'shell', 'readonly']) {
      expect(manager.policy.allowlist).toContain(e);
    }
  });

  it('memory-curator policy aligns with MEMORY_CURATOR_TOOLS', () => {
    expect(curator.policy.deny.sort()).toEqual(['file-edit', 'shell', 'web']);
    expect(curator.policy.allowlist).toContain('mafw_add_memory');
    expect(curator.policy.allowlist).toContain('mafw_search_hybrid');
    expect(curator.policy.allowlist).toContain('mafw_supersede_memory');
    expect(curator.policy.allowlist).toContain('readonly');
  });
});

describe('toAgentDefinition (materialization derivation)', () => {
  it('manager derives byte-equivalent opencode permissions vs today', () => {
    const def = toAgentDefinition(manager);
    expect(def.description).toBe('编排 · 分解任务与调度');
    expect(def.mode).toBe('primary');
    expect(def.permissions.edit).toBe('deny');
    expect(def.permissions.task).toEqual({ general: 'deny' });
    expect(def.tools).toEqual(expect.objectContaining({ mafw_set_goal: true, question: true, plan_exit: true }));
  });

  it('memory-curator derives tools with * disabled (hard layer intact)', () => {
    const def = toAgentDefinition(curator);
    expect(def.mode).toBe('subagent');
    expect(def.permissions).toEqual({ edit: 'deny', bash: 'deny' });
    expect(def.tools).toEqual(expect.objectContaining({ '*': false, mafw_add_memory: true, read: true }));
  });

  it('deny categories map to native permission keys', () => {
    // manager deny=[file-edit, subagent] → edit deny + task general deny
    const spec = { ...manager, policy: { deny: ['shell', 'web'], allowlist: undefined }, nativePermissions: undefined };
    const def = toAgentDefinition(spec);
    expect(def.permissions.bash).toBe('deny');
    expect(def.permissions.edit).toBeUndefined();
  });
});

describe('resolveToolCategory', () => {
  it('opencode names', () => {
    expect(resolveToolCategory('edit', 'opencode')).toBe('file-edit');
    expect(resolveToolCategory('apply_patch', 'opencode')).toBe('file-edit');
    expect(resolveToolCategory('bash', 'opencode')).toBe('shell');
    expect(resolveToolCategory('task', 'opencode')).toBe('subagent');
    expect(resolveToolCategory('webfetch', 'opencode')).toBe('web');
    expect(resolveToolCategory('read', 'opencode')).toBe('readonly');
    expect(resolveToolCategory('glob', 'opencode')).toBe('readonly');
    expect(resolveToolCategory('mafw_set_goal', 'opencode')).toBeNull();
  });

  it('pi names + unknown runtime', () => {
    expect(resolveToolCategory('bash', 'pi')).toBe('shell');
    expect(resolveToolCategory('grep', 'pi')).toBe('readonly');
    expect(resolveToolCategory('bash', 'claude')).toBeNull(); // 未内置表 → null
  });
});

describe('policyDecides', () => {
  const cat = (t: string) => resolveToolCategory(t, 'opencode');
  it('deny wins over allowlist', () => {
    expect(policyDecides(manager.policy, 'edit', cat)).toBe('deny');
    expect(policyDecides(manager.policy, 'task', cat)).toBe('deny');
  });
  it('allowlist prefix wildcard + category entries', () => {
    expect(policyDecides(manager.policy, 'mafw_set_goal', cat)).toBe('allow');
    expect(policyDecides(manager.policy, 'bash', cat)).toBe('allow');       // via shell
    expect(policyDecides(manager.policy, 'read', cat)).toBe('allow');       // via readonly
    expect(policyDecides(manager.policy, 'question', cat)).toBe('allow');   // verbatim
  });
  it('unlisted tool denied when allowlist present', () => {
    expect(policyDecides(manager.policy, 'webfetch', cat)).toBe('deny');
    expect(policyDecides(curator.policy, 'bash', cat)).toBe('deny');
  });
  it('null fallthrough when no allowlist and no deny match', () => {
    expect(policyDecides({ deny: ['file-edit'] }, 'bash', cat)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/runtime/identity-registry.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 identity-registry.ts**

```typescript
// gateway/src/runtime/identity-registry.ts
// IdentityRegistry —— MAFW agent 身份的单一事实源（spec 2026-10-08-runtime-neutral-agent-identity）。
// 身份注入走物化（materialization）+ 绑定；本模块只提供数据与纯派生，无副作用。
import { AgentDefinition, AgentPermissions } from './agent-definition';
import { MANAGER_IDENTITY_SYSTEM_PROMPT } from '../skills/manager-identity';
import { MAFW_TOOL_ALLOWLIST } from '../skills/manager-agent-config';
import { MEMORY_CURATOR_BASE_PROMPT, MEMORY_CURATOR_TOOLS } from '../skills/memory-curator-agent';

export interface IdentityPolicy {
  /** 绝对拒绝：类别标签（file-edit/shell/subagent/web/readonly）或工具名 */
  deny: string[];
  /** 白名单存在时未列出即拒：工具名（支持 mafw_* 前缀通配）或类别标签 */
  allowlist?: string[];
}

export interface IdentitySpec {
  name: string;
  description: string;
  scope: 'primary' | 'worker';
  systemPrompt: string;
  model?: { providerID: string; modelID: string };
  policy: IdentityPolicy;
  /** 物化逃生舱：policy 无法逐字节表达的原生权限（保持现有 opencode/pi 产物不变） */
  nativePermissions?: Partial<AgentPermissions> & { tools?: Record<string, boolean> };
}

export interface IdentityRegistry {
  list(): IdentitySpec[];
  get(name: string): IdentitySpec | undefined;
}

export type ToolCategory = 'file-edit' | 'shell' | 'subagent' | 'web' | 'readonly';

/** v1 内置类别表：opencode + pi（工具名 → 中立类别）。未来 runtime 经 loader extras 声明。 */
const TOOL_CATEGORY_TABLES: Record<string, Record<string, ToolCategory>> = {
  opencode: {
    edit: 'file-edit', write: 'file-edit', apply_patch: 'file-edit', multiedit: 'file-edit',
    bash: 'shell',
    task: 'subagent',
    webfetch: 'web',
    read: 'readonly', grep: 'readonly', glob: 'readonly', ls: 'readonly', list: 'readonly',
  },
  pi: {
    edit: 'file-edit', write: 'file-edit', apply_patch: 'file-edit',
    bash: 'shell',
    task: 'subagent',
    webfetch: 'web',
    read: 'readonly', grep: 'readonly', glob: 'readonly', ls: 'readonly', list: 'readonly',
  },
};

export function resolveToolCategory(toolName: string, runtimeName: string): ToolCategory | null {
  return TOOL_CATEGORY_TABLES[runtimeName]?.[toolName] ?? null;
}

/** deny 类别 → 原生权限键（物化派生用；policy 与 nativePermissions 都不覆盖的键不产出） */
const DENY_CATEGORY_TO_NATIVE: Record<ToolCategory, (p: AgentPermissions) => void> = {
  'file-edit': (p) => { p.edit = 'deny'; },
  shell: (p) => { p.bash = 'deny'; },
  subagent: (p) => { p.task = { ...(p.task ?? {}), general: 'deny' }; },
  web: () => { /* opencode 无 web 键——webfetch 经 tools 禁；无操作 */ },
  readonly: () => { /* 拒只读无意义 */ },
};

/** 纯策略判定：'deny' | 'allow' | null（落穿——白名单不存在且未命中 deny） */
export function policyDecides(
  policy: IdentityPolicy,
  toolName: string,
  categoryOf: (t: string) => ToolCategory | null,
): 'allow' | 'deny' | null {
  const cat = categoryOf(toolName);
  if (policy.deny.includes(toolName) || (cat !== null && policy.deny.includes(cat))) return 'deny';
  if (!policy.allowlist) return null;
  const listed = policy.allowlist.some((e) =>
    e.endsWith('*') ? toolName.startsWith(e.slice(0, -1)) : e === toolName || e === cat,
  );
  return listed ? 'allow' : 'deny';
}

const MANAGER_SPEC: IdentitySpec = {
  name: 'manager',
  description: '编排 · 分解任务与调度',
  scope: 'primary',
  systemPrompt: MANAGER_IDENTITY_SYSTEM_PROMPT,
  policy: {
    deny: ['file-edit', 'subagent'],
    allowlist: ['mafw_*', 'question', 'plan_exit', 'shell', 'readonly'],
  },
  nativePermissions: {
    edit: 'deny',
    task: { general: 'deny' },
    tools: { question: true, plan_exit: true, ...Object.fromEntries(MAFW_TOOL_ALLOWLIST.map((t) => [t, true])) },
  },
};

const MEMORY_CURATOR_SPEC: IdentitySpec = {
  name: 'memory-curator',
  description: 'Memory pipeline worker: curates memories, read-only on the repo',
  scope: 'worker',
  systemPrompt: MEMORY_CURATOR_BASE_PROMPT,
  policy: {
    deny: ['file-edit', 'shell', 'web'],
    allowlist: ['mafw_add_memory', 'mafw_search_hybrid', 'mafw_supersede_memory', 'readonly'],
  },
  nativePermissions: { edit: 'deny', bash: 'deny', tools: MEMORY_CURATOR_TOOLS },
};

const BUILTIN: IdentitySpec[] = [MANAGER_SPEC, MEMORY_CURATOR_SPEC];

export function createBuiltinIdentityRegistry(): IdentityRegistry {
  return {
    list: () => BUILTIN.slice(),
    get: (name) => BUILTIN.find((s) => s.name === name),
  };
}

export function toAgentDefinition(spec: IdentitySpec): AgentDefinition {
  const permissions: AgentPermissions = {};
  for (const entry of spec.policy.deny) {
    const applier = DENY_CATEGORY_TO_NATIVE[entry as ToolCategory];
    if (applier && !spec.nativePermissions) applier(permissions);
  }
  if (spec.nativePermissions) Object.assign(permissions, spec.nativePermissions);
  return {
    description: spec.description,
    mode: spec.scope === 'primary' ? 'primary' : 'subagent',
    ...(spec.model ? { model: spec.model.modelID } : {}),
    systemPrompt: spec.systemPrompt,
    permissions,
    ...(spec.nativePermissions?.tools ? { tools: spec.nativePermissions.tools } : {}),
  };
}
```

注意：`MAFW_TOOL_ALLOWLIST` 当前是 `as const` 只读数组——若类型报错，在 `manager-agent-config.ts` 去掉 `as const` 或在本文件用 `readonly string[]` 兼容。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/runtime/identity-registry.test.ts --runInBand`
Expected: PASS（全 describe 绿）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/identity-registry.ts gateway/tests/unit/runtime/identity-registry.test.ts
git commit -m "feat(identity): IdentityRegistry builtin specs, toAgentDefinition derivation, tool category tables"
```

---

### Task 2: ApprovalPolicyService identity 维度

**Files:**
- Modify: `gateway/src/core/approval/policy-service.ts`
- Test: `gateway/tests/unit/core/approval/policy-service-identity.test.ts`（新建；现有 `policy-service` 测试文件不动）

**Interfaces:**
- Consumes: Task 1 的 `IdentityPolicy`/`policyDecides`/`ToolCategory`
- Produces:
  - `ApprovalPolicyDeps` 新增**可选**依赖（全部可选——既有测试构造零改动）：`getIdentity?(sessionID: string): { name: string; internal: boolean } | undefined`、`getPolicy?(name: string): IdentityPolicy | undefined`、`runtimeName?(): string`（缺省回退 `'opencode'`）
  - `PolicyDecision` 不变形状（action/verdict/reason）——identity 决策的 reason 带 `identity policy (<name>)` 前缀

**评估顺序（spec §3.3，身份先于 internal）**：
```
1. binding = getIdentity(sid)；若有且 getPolicy 有策略：
   deny → auto-deny
   allow + internal（gateway 驱动）→ auto-approve（无人值守）
   allow + 非 internal → 落穿到既有 2-6 步（用户档位决定）
   null → 落穿
2. internal 无绑定 → auto-deny（不变）
3. 既有三档流程（不变）
```

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/core/approval/policy-service-identity.test.ts
import { ApprovalPolicyService, PolicyDecision } from '../../../../src/core/approval/policy-service';
import { createBuiltinIdentityRegistry } from '../../../../src/runtime/identity-registry';

const registry = createBuiltinIdentityRegistry();

function makePolicy(identity?: { name: string; internal: boolean }) {
  return new ApprovalPolicyService({
    getInternalRole: (sid) => (identity?.internal ? 'manager' : undefined),
    getIdentity: (sid) => (sid === 'sess-1' ? identity : undefined),
    getPolicy: (name) => registry.get(name)?.policy,
    runtimeName: () => 'opencode',
    allowlistMatches: () => false,
    loadMode: async () => 'read-only',
    saveMode: async () => {},
    onModeChanged: () => {},
  });
}

describe('identity evaluation order (spec 3.3)', () => {
  it('internal manager session: whitelisted tool auto-approves (unattended), not blanket-denied', () => {
    const svc = makePolicy({ name: 'manager', internal: true });
    expect(svc.evaluate('sess-1', { toolName: 'mafw_set_goal', patterns: [], metadata: {} }).action).toBe('auto-approve');
    expect(svc.evaluate('sess-1', { toolName: 'bash', patterns: [], metadata: {} }).action).toBe('auto-approve');
  });

  it('internal manager session: file-edit denied with identity-prefixed reason', () => {
    const svc = makePolicy({ name: 'manager', internal: true });
    const d: PolicyDecision = svc.evaluate('sess-1', { toolName: 'edit', patterns: [], metadata: {} });
    expect(d.action).toBe('auto-deny');
    expect(d.reason).toContain('identity policy (manager)');
  });

  it('internal manager session: unlisted tool denied (webfetch)', () => {
    const svc = makePolicy({ name: 'manager', internal: true });
    expect(svc.evaluate('sess-1', { toolName: 'webfetch', patterns: [], metadata: {} }).action).toBe('auto-deny');
  });

  it('user-driven identity pick: whitelisted tool falls through to mode (read-only keeps bash human)', () => {
    const svc = makePolicy({ name: 'manager', internal: false });
    // bash ∈ allowlist 但用户在场 → 落三档；read-only 档下 bash=human
    expect(svc.evaluate('sess-1', { toolName: 'bash', patterns: [], metadata: {} }).action).toBe('human');
    // 但 file-edit 仍被身份拒
    expect(svc.evaluate('sess-1', { toolName: 'edit', patterns: [], metadata: {} }).action).toBe('auto-deny');
  });

  it('internal session WITHOUT identity binding still blanket-denied (unchanged)', () => {
    const svc = makePolicy(undefined); // getInternalRole 返回 'manager' 但无 identity 绑定
    expect(svc.evaluate('sess-1', { toolName: 'mafw_set_goal', patterns: [], metadata: {} }).action).toBe('auto-deny');
  });

  it('unbound session: existing three-tier flow unchanged', () => {
    const svc = makePolicy(undefined);
    const d = svc.evaluate('sess-2', { toolName: 'read', patterns: [], metadata: {} });
    expect(d.action).toBe('auto-approve'); // read-only 档 read-only 工具
  });
});
```

注意：`makePolicy` 里 `getInternalRole` 与 `getIdentity` 是两个独立维度——internal role 存在但 identity 绑定缺失 = 落回 blanket-deny（第 5 个用例）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/core/approval/policy-service-identity.test.ts --runInBand`
Expected: FAIL（getIdentity 依赖不存在 → manager 被 blanket-deny）

- [ ] **Step 3: 修改 policy-service.ts**

在 `ApprovalPolicyDeps` 接口追加（保持可选，旧测试零改动）：

```typescript
import { IdentityPolicy, ToolCategory, policyDecides, resolveToolCategory } from '../../runtime/identity-registry';

export interface ApprovalPolicyDeps {
  // ...既有五项不动...
  /** 身份层（spec 2026-10-08-runtime-neutral-agent-identity §3.3）：internal = gateway 驱动会话。全部可选。 */
  getIdentity?(sessionID: string): { name: string; internal: boolean } | undefined;
  getPolicy?(name: string): IdentityPolicy | undefined;
  runtimeName?(): string;
}
```

`evaluate` 方法头部（内部 fail-safe **之前**）插入（`this.deps.runtimeName?.() ?? 'opencode'` 回退）：

```typescript
evaluate(sessionID: string, candidate: ApprovalCandidate): PolicyDecision {
  // 0. 身份策略（先于 internal blanket-deny——manager 本身就是 internal 会话）
  const binding = this.deps.getIdentity?.(sessionID);
  if (binding) {
    const policy = this.deps.getPolicy?.(binding.name);
    if (policy) {
      const cat = (t: string): ToolCategory | null => resolveToolCategory(t, this.deps.runtimeName?.() ?? 'opencode');
      const decision = policyDecides(policy, candidate.toolName, cat);
      if (decision === 'deny') {
        return {
          action: 'auto-deny', verdict: classifySafety(candidate),
          reason: `identity policy (${binding.name}) — ${candidate.toolName} not permitted for this identity`,
        };
      }
      if (decision === 'allow' && binding.internal) {
        return {
          action: 'auto-approve', verdict: classifySafety(candidate),
          reason: `identity policy (${binding.name}) — ${candidate.toolName} allowlisted (unattended)`,
        };
      }
      // allow + 非 internal → 落穿（用户档位决定问/不问）；null → 落穿
    }
  }
  // 1. 内部会话 fail-safe（原逻辑不动）
  ...
}
```

- [ ] **Step 4: 跑新旧测试确认全绿**

Run: `cd gateway; npx jest tests/unit/core/approval/ --runInBand`
Expected: PASS（新 6 用例 + 既有 policy-service 测试全绿——deps 新键可选，旧构造不破）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/approval/policy-service.ts gateway/tests/unit/core/approval/policy-service-identity.test.ts
git commit -m "feat(identity): identity policy dimension in ApprovalPolicyService (precedes internal deny)"
```

---

### Task 3: IdentityState（绑定 + 物化跟踪 + prompt 包装 + 列表合并）

**Files:**
- Create: `gateway/src/runtime/identity-state.ts`
- Test: `gateway/tests/unit/runtime/identity-state.test.ts`

**Interfaces:**
- Consumes: 无（纯内存状态 + 纯函数）
- Produces:
  - `interface IdentityBinding { identity: string; kind: 'session' | 'turn' }`
  - `class IdentityState { bind(sessionID, identity, kind); unbind(sessionID); get(sessionID): IdentityBinding | undefined; clearTurnBindings(sessionID); setMaterialized(runtimeName, identity, ok); isMaterialized(runtimeName, identity): boolean; resetMaterialization(runtimeName) }`
  - `function withIdentityPrompt<S extends { sessionID: string; agent?: string }>(session: { promptAsync(o: S): Promise<any>; prompt(o: S): Promise<any> }, state: IdentityState, runtimeName: () => string, isRegistryIdentity: (n: string) => boolean): 同形状`——包装器：绑定+物化 → 缺 agent 时注入 identity 名；agent 是注册表身份且未物化 → 剥离（防未知 agent 报错）；非注册表 agent（build/plan）原样透传
  - `function mergeAgentLists(registryItems: Array<{ name: string; description: string; scope: string }>, runtimeAgents: any[]): any[]`——registry 在前（`source: 'mafw'`）+ runtime（`source: 'runtime'`），registry 同名去重 runtime 项

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/runtime/identity-state.test.ts
import { IdentityState, withIdentityPrompt, mergeAgentLists } from '../../../../src/runtime/identity-state';

describe('IdentityState', () => {
  it('session and turn bindings; clearTurnBindings only clears turn kind', () => {
    const s = new IdentityState();
    s.bind('a', 'manager', 'session');
    s.bind('b', 'manager', 'turn');
    expect(s.get('a')).toEqual({ identity: 'manager', kind: 'session' });
    s.clearTurnBindings('a'); // session 绑定不受影响
    expect(s.get('a')?.kind).toBe('session');
    s.clearTurnBindings('b');
    expect(s.get('b')).toBeUndefined();
  });

  it('unbind removes any kind', () => {
    const s = new IdentityState();
    s.bind('a', 'manager', 'session');
    s.unbind('a');
    expect(s.get('a')).toBeUndefined();
  });

  it('materialization per (runtime, identity); resetMaterialization clears one runtime', () => {
    const s = new IdentityState();
    expect(s.isMaterialized('opencode', 'manager')).toBe(false);
    s.setMaterialized('opencode', 'manager', true);
    s.setMaterialized('pi', 'manager', true);
    expect(s.isMaterialized('opencode', 'manager')).toBe(true);
    s.resetMaterialization('opencode');
    expect(s.isMaterialized('opencode', 'manager')).toBe(false);
    expect(s.isMaterialized('pi', 'manager')).toBe(true);
  });
});

describe('withIdentityPrompt wrapper', () => {
  const calls: Array<any> = [];
  const base = {
    async promptAsync(o: any) { calls.push(['async', o]); },
    async prompt(o: any) { calls.push(['sync', o]); return { parts: [] }; },
  };

  it('injects agent when bound + materialized + no agent given', async () => {
    calls.length = 0;
    const s = new IdentityState();
    s.bind('sess-1', 'manager', 'session');
    s.setMaterialized('opencode', 'manager', true);
    const w = withIdentityPrompt(base, s, () => 'opencode', (n) => n === 'manager');
    await w.promptAsync({ sessionID: 'sess-1', message: 'hi' } as any);
    expect(calls[0][1].agent).toBe('manager');
  });

  it('strips registry agent name when NOT materialized (unknown-agent guard)', async () => {
    calls.length = 0;
    const s = new IdentityState();
    const w = withIdentityPrompt(base, s, () => 'codex', (n) => n === 'memory-curator');
    await w.promptAsync({ sessionID: 'x', message: 'hi', agent: 'memory-curator' } as any);
    expect(calls[0][1].agent).toBeUndefined();
  });

  it('passes through non-registry agents (build/plan) untouched', async () => {
    calls.length = 0;
    const s = new IdentityState();
    const w = withIdentityPrompt(base, s, () => 'opencode', (n) => n === 'manager');
    await w.promptAsync({ sessionID: 'x', message: 'hi', agent: 'build' } as any);
    expect(calls[0][1].agent).toBe('build');
  });

  it('no agent injection for unbound sessions', async () => {
    calls.length = 0;
    const s = new IdentityState();
    s.setMaterialized('opencode', 'manager', true);
    const w = withIdentityPrompt(base, s, () => 'opencode', (n) => n === 'manager');
    await w.promptAsync({ sessionID: 'other', message: 'hi' } as any);
    expect(calls[0][1].agent).toBeUndefined();
  });
});

describe('mergeAgentLists', () => {
  it('registry first with source tag; runtime items tagged; dedupe by name', () => {
    const out = mergeAgentLists(
      [{ name: 'manager', description: '编排', scope: 'primary' }],
      [{ name: 'build', description: 'x' }, { name: 'manager', description: 'stale' }],
    );
    expect(out[0]).toMatchObject({ name: 'manager', source: 'mafw' });
    expect(out.find((a: any) => a.name === 'build')?.source).toBe('runtime');
    expect(out.filter((a: any) => a.name === 'manager')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/runtime/identity-state.test.ts --runInBand`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 identity-state.ts**

```typescript
// gateway/src/runtime/identity-state.ts
// session→identity 绑定（内存）+ (runtime, identity) 物化状态 + prompt 包装器 + agent 列表合并。
// 绑定不持久化：gateway 驱动会话在创建/恢复时重新登记（ensureManagerSession 启动遍历），
// 回合级绑定在 session.idle 清除。

export interface IdentityBinding {
  identity: string;
  kind: 'session' | 'turn';
}

export class IdentityState {
  private bindings = new Map<string, IdentityBinding>();
  private materialized = new Map<string, boolean>(); // key: `${runtime}|${identity}`

  bind(sessionID: string, identity: string, kind: 'session' | 'turn'): void {
    // session 绑定优先于 turn：已存在 session 绑定时 turn 不覆盖
    const existing = this.bindings.get(sessionID);
    if (existing?.kind === 'session' && kind === 'turn') return;
    this.bindings.set(sessionID, { identity, kind });
  }

  unbind(sessionID: string): void {
    this.bindings.delete(sessionID);
  }

  get(sessionID: string): IdentityBinding | undefined {
    return this.bindings.get(sessionID);
  }

  clearTurnBindings(sessionID: string): void {
    if (this.bindings.get(sessionID)?.kind === 'turn') this.bindings.delete(sessionID);
  }

  setMaterialized(runtimeName: string, identity: string, ok: boolean): void {
    this.materialized.set(`${runtimeName}|${identity}`, ok);
  }

  isMaterialized(runtimeName: string, identity: string): boolean {
    return this.materialized.get(`${runtimeName}|${identity}`) === true;
  }

  resetMaterialization(runtimeName: string): void {
    const prefix = `${runtimeName}|`;
    for (const k of this.materialized.keys()) {
      if (k.startsWith(prefix)) this.materialized.delete(k);
    }
  }
}

/**
 * prompt 包装器（物化车道 1 的绑定执行点）：
 * - 绑定 + 已物化 + 未指定 agent → 注入 agent = identity 名
 * - agent 是注册表身份且未物化 → 剥离（防未知 agent 报错；该 runtime 走车道 2/3 时身份不经 agent）
 * - 非注册表 agent（build/plan 等 runtime 原生）原样透传
 */
export function withIdentityPrompt<S extends { sessionID: string; agent?: string }>(
  session: { promptAsync(o: S): Promise<any>; prompt(o: S): Promise<any> },
  state: IdentityState,
  runtimeName: () => string,
  isRegistryIdentity: (name: string) => boolean,
): { promptAsync(o: S): Promise<any>; prompt(o: S): Promise<any> } {
  const apply = (opts: S): S => {
    const binding = state.get(opts.sessionID);
    if (opts.agent) {
      if (isRegistryIdentity(opts.agent) && !state.isMaterialized(runtimeName(), opts.agent)) {
        const { agent: _drop, ...rest } = opts as any;
        return rest as S;
      }
      return opts;
    }
    if (binding && state.isMaterialized(runtimeName(), binding.identity)) {
      return { ...opts, agent: binding.identity } as S;
    }
    return opts;
  };
  return {
    promptAsync: (o: S) => session.promptAsync(apply(o)),
    prompt: (o: S) => session.prompt(apply(o)),
  };
}

/** GET /api/agents 合并：注册表身份在前（source: 'mafw'），runtime 原生在后（source: 'runtime'），同名去重 */
export function mergeAgentLists(
  registryItems: Array<{ name: string; description: string; scope: string }>,
  runtimeAgents: any[],
): any[] {
  const out: any[] = registryItems.map((i) => ({ name: i.name, description: i.description, mode: i.scope === 'primary' ? 'primary' : 'subagent', source: 'mafw' }));
  const seen = new Set(registryItems.map((i) => i.name));
  for (const a of Array.isArray(runtimeAgents) ? runtimeAgents : []) {
    if (a && typeof a.name === 'string' && !seen.has(a.name)) {
      seen.add(a.name);
      out.push({ ...a, source: 'runtime' });
    }
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/runtime/identity-state.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/identity-state.ts gateway/tests/unit/runtime/identity-state.test.ts
git commit -m "feat(identity): IdentityState bindings + materialization tracking + prompt wrapper + agent list merge"
```

---

### Task 4: index.ts 接线——物化循环、绑定登记、prompt 包装、manager 迁移

**Files:**
- Modify: `gateway/src/index.ts`（多处，见步骤；jest 不 typecheck 本文件——**改完必须 root `npm run build`**）
- Modify: `gateway/src/runtime/opencode-runtime.ts`（仅当 `MAFW_TOOL_ALLOWLIST` 类型需要 `as const` 调整时，Task 1 已处理则跳过）

**Interfaces:**
- Consumes: Task 1 `createBuiltinIdentityRegistry`/`toAgentDefinition`；Task 2 deps 三新键；Task 3 `IdentityState`/`withIdentityPrompt`
- Produces: 无新导出（纯接线）；行为变化——①启动物化循环 ②manager/worker 会话绑定 ③manager prompt 自动带 agent ④`injectManagerIdentity` 删除 ⑤rotate 降级解绑

- [ ] **Step 1: 成员与注册表初始化**

`MafwScheduler` 类中（`internalSessionRoles` 声明附近，~line 292）加：

```typescript
private identityRegistry = createBuiltinIdentityRegistry();
private identityState = new IdentityState();
```

顶部 import：

```typescript
import { createBuiltinIdentityRegistry, toAgentDefinition } from './runtime/identity-registry';
import { IdentityState, withIdentityPrompt } from './runtime/identity-state';
```

- [ ] **Step 2: 物化方法 + 替换启动 install 块（index.ts ~636-653）**

原 5.1/5.1b 两段 try/catch（manager + ensureMemoryCuratorAgent）整体替换为对下述新方法的调用；`ensureMemoryCuratorAgent` 函数从 `memory-curator-agent.ts` 删除（其余导出保留——registry/管线上游仍在用），其 import 一并清理：

```typescript
// 5.1 Materialize every registry identity into the runtime's native format
// (spec 2026-10-08-runtime-neutral-agent-identity §3.2/3.4 — 物化车道 1)。
// agents.install 的语义即物化：opencode 写 agent md、pi 写 prompts+extension。
await this.materializeIdentities();
```

新私有方法（放在 `createRuntime` 附近）：

```typescript
/** 物化循环：遍历注册表 install；成功与否记入 IdentityState（驱动车道选择）。幂等可重跑（热切换后重物化）。 */
private async materializeIdentities(): Promise<void> {
  const rt = this.runtime;
  if (!rt) return;
  this.identityState.resetMaterialization(rt.name);
  if (rt.capabilities?.agentConfigApi && rt.agents?.install) {
    for (const spec of this.identityRegistry.list()) {
      try {
        await rt.agents.install(spec.name, toAgentDefinition(spec));
        this.identityState.setMaterialized(rt.name, spec.name, true);
        log.info(`[Identity] materialized '${spec.name}' on runtime '${rt.name}'`);
      } catch (err: any) {
        this.identityState.setMaterialized(rt.name, spec.name, false);
        log.warn(`[Identity] materialize '${spec.name}' failed (non-fatal): ${err.message}`);
      }
    }
  } else {
    log.info(`[Identity] runtime '${rt.name}' has no agentConfigApi — identities run via gateway policy layer (lane 2/3)`);
  }
}
```

**热切换重物化**：runtime 热切换完成点（`POST /api/runtime/switch` 的路由实现 `gateway/src/routes/runtime-switch.ts` 与 config hot-reload 的切换流程，二者最终都调用 scheduler 的 createRuntime + 重接线）——在切换完成、`this.runtime` 已赋新值的接线点之后追加 `void this.materializeIdentities();`（fire-and-forget，不阻塞切换响应）。定位方式：grep `routes/runtime-switch.ts` 的 deps 注入处与 index.ts 中 `runtime/switch` 路由 handler（若 handler 内联在 index.ts）。

- [ ] **Step 3: createRuntime 出口包装 prompt（三处 return 前统一）**

`createRuntime`（index.ts ~1145-1196）三个 return 路径（plugin / builtin / fallback）。新增辅助方法：

```typescript
private wrapRuntimeIdentity(rt: AgentRuntime): AgentRuntime {
  const registry = this.identityRegistry;
  (rt.session as any) = withIdentityPrompt(rt.session as any, this.identityState, () => rt.name, (n) => !!registry.get(n));
  return rt;
}
```

三个 return 改为 `return this.wrapRuntimeIdentity(rt);`。热切换（`POST /api/runtime/switch` 与 config hot-reload）都走 `createRuntime` → 包装自动覆盖（Step 2 已补热切换重物化）。

- [ ] **Step 4: 绑定登记——registerInternalSession 扩展 + manager/worker 接线**

`registerInternalSession`（~1206）加第三参：

```typescript
private registerInternalSession(sessionId: string, role: string, identity?: string): void {
  this.internalSessionRoles.set(sessionId, role);
  this.getGatewayDb().kvSet('internal-session', sessionId, { role, at: new Date().toISOString() });
  if (identity) this.identityState.bind(sessionId, identity, 'session');
}
```

四个接线点：
1. manager 既有路径（~6751）：`this.registerInternalSession(existing.sessionId, 'manager', 'manager');`
2. manager 创建路径（~6766）：`this.registerInternalSession(sessionId, 'manager', 'manager');`
3. recoverState 路径（~6947，grep `registerInternalSession(.*'manager'` 兜底全部）：同上加 `'manager'` 第三参
4. worker hook（~1222）：`onSessionCreated: (sessionId, role) => { this.registerInternalSession(sessionId, role, 'memory-curator'); }`

rotate 降级解绑——`rotateDeps().downgrade`（~6803）在 `updateMetadata` 之后追加：

```typescript
this.identityState.unbind(sid);
```

- [ ] **Step 5: 删除 injectManagerIdentity，替换为绑定说明**

`createManagerSession`（~6777）末行 `await this.injectManagerIdentity(sessionId);` 删除，改为：

```typescript
// Identity reaches the model via lane 1 (materialized agent + promptAsync agent
// param injected by withIdentityPrompt) — replaces the old one-shot [SYSTEM]
// identity message, which compaction gradually diluted (spec §3.2).
```

整个 `injectManagerIdentity` 方法删除；`MANAGER_IDENTITY_SYSTEM_PROMPT` import（~77）若仅此处使用则移除（registry 已引用）。

- [ ] **Step 6: ApprovalPolicyService deps 接线（~2249）**

构造对象追加三键：

```typescript
this.approvalPolicy = new ApprovalPolicyService({
  ...既有五键不动...,
  getIdentity: (sid) => {
    const b = this.identityState.get(sid);
    if (!b) return undefined;
    return { name: b.identity, internal: this.internalSessionRoles.has(sid) };
  },
  getPolicy: (name) => this.identityRegistry.get(name)?.policy,
  runtimeName: () => this.runtime?.name ?? 'opencode',
});
```

- [ ] **Step 7: 构建 + 全量测试**

Run: `cd <repo-root>; npm run build`
Expected: exit 0（index.ts 类型全过）
Run: `cd gateway; npx jest --runInBand`
Expected: ≥240 suites 全绿（基线不降；identity 两个新套件已计入）

- [ ] **Step 8: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(identity): materialization loop, session bindings, prompt wrapper wiring, manager lane-1 migration"
```

---

### Task 5: prompt 路由身份感知 + GET /api/agents 合并

**Files:**
- Modify: `gateway/src/index.ts`（promptAsync 路由 ~4986 + agents 路由 ~4620 + session.idle 清回合绑定）

**Interfaces:**
- Consumes: Task 3 `mergeAgentLists`、`IdentityState.bind(..., 'turn')`/`clearTurnBindings`
- Produces: HTTP 行为变化——`GET /api/agents` 返回合并列表（items 带 `source`）；`POST /api/session/:id/promptAsync` 传注册表身份名时登记回合级绑定

- [ ] **Step 1: promptAsync 路由登记回合绑定（~4986-4993）**

路由 handler 内、调用 `this.sdkSession.promptAsync(...)` 之前插入：

```typescript
// 身份感知（spec §3.2）：用户选了注册表身份 → 回合级绑定（策略层据此评估该回合工具调用）。
// agent 参数本身由 withIdentityPrompt 包装器按物化状态注入/剥离。
if (agent && this.identityRegistry.get(agent)) {
  this.identityState.bind(sessionID, agent, 'turn');
}
```

- [ ] **Step 2: session.idle 清回合绑定**

`handleOpencodeEvent` 中 session.idle 分支（grep `case 'session.idle'` 或 idle 处理点；applyApprovalPolicy 调用点 ~1022 附近的事件分发处）追加：

```typescript
this.identityState.clearTurnBindings(sessionID);
```

若 idle 分支无法拿到 sessionID（事件形状差异），用 facet 的 sessionID 提取（normalize 后 `f.sessionID`）。

- [ ] **Step 3: GET /api/agents 合并（~4619-4632）**

```typescript
if (req.url?.match(/^\/api\/agents(?:\?|$)/) && req.method === 'GET') {
  if (this.capGuard(res, 'providerConfigApi')) return;
  try {
    if (!this.runtime) { res.writeHead(503); res.end(JSON.stringify({ error: 'LLM client not available' })); return; }
    const runtimeAgents = await this.runtime.app.agents();
    const items = mergeAgentLists(
      this.identityRegistry.list().map((s) => ({ name: s.name, description: s.description, scope: s.scope })),
      Array.isArray(runtimeAgents) ? runtimeAgents : [],
    );
    res.end(JSON.stringify({ items }));
  } catch (err: any) { ...原样... }
}
```

import 追加 `mergeAgentLists`。

- [ ] **Step 4: 构建 + 全量测试**

Run: `cd <repo-root>; npm run build` → exit 0
Run: `cd gateway; npx jest --runInBand` → 全绿（基线不降）

- [ ] **Step 5: 手动冒烟（可选但有价值）**

`mafw daemon` 运行中：`Invoke-WebRequest http://127.0.0.1:3000/api/agents` 应返回 items 含 `{name:'manager',source:'mafw'}`。

- [ ] **Step 6: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(identity): turn-level binding on prompt route, agent list merge, idle cleanup"
```

---

### Task 6: S5 conformance 场景 identity-roundtrip

**Files:**
- Modify: `gateway/src/runtime/conformance-scenarios.ts`
- Modify: `gateway/src/routes/conformance.ts`
- Test: `gateway/tests/unit/runtime/conformance-scenarios.test.ts`（追加 describe；若文件不存在则新建）

**Interfaces:**
- Consumes: `ScenarioDef`（id 联合类型扩 `'identity-roundtrip'`）、`CognitionObservation` 模式（新增 `IdentityObservation`）
- Produces: `POST /api/runtime/conformance { scenarios: ['identity-roundtrip'] }` 可执行；`IdentityObservation { identityEcho?: string; policy: Array<{ tool: string; action: string }> }`

- [ ] **Step 1: 写失败测试（evaluateScenario 扩展）**

```typescript
// gateway/tests/unit/runtime/conformance-scenarios.test.ts（追加）
import { evaluateScenario } from '../../../../src/runtime/conformance-scenarios';

describe('evaluateScenario: identity-roundtrip (S5)', () => {
  it('passes when identity echo + policy both correct', () => {
    const r = evaluateScenario('identity-roundtrip', [], undefined, undefined, {
      identityEcho: 'MAFW MANAGER IDENTITY',
      policy: [
        { tool: 'bash', action: 'auto-approve' },
        { tool: 'edit', action: 'auto-deny' },
      ],
    });
    expect(r.pass).toBe(true);
  });

  it('fails when identity echo missing (lane 1 agent did not carry system prompt)', () => {
    const r = evaluateScenario('identity-roundtrip', [], undefined, undefined, {
      identityEcho: '',
      policy: [
        { tool: 'bash', action: 'auto-approve' },
        { tool: 'edit', action: 'auto-deny' },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.failures[0]).toContain('identity');
  });

  it('fails when edit not denied by policy', () => {
    const r = evaluateScenario('identity-roundtrip', [], undefined, undefined, {
      identityEcho: 'MAFW MANAGER IDENTITY',
      policy: [
        { tool: 'bash', action: 'auto-approve' },
        { tool: 'edit', action: 'auto-approve' },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toContain('edit');
  });
});
```

（`evaluateScenario` 签名追加第 5 参 `identity?: IdentityObservation`——可选参数不破既有调用。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/runtime/conformance-scenarios.test.ts --runInBand`
Expected: FAIL（id 不在联合类型 / 签名无第 5 参）

- [ ] **Step 3: 实现 conformance-scenarios.ts 扩展**

```typescript
// ScenarioDef.id 联合追加 'identity-roundtrip'；SCENARIOS 追加：
{
  id: 'identity-roundtrip',
  title: '身份层·物化+策略（S5）',
  description: 'manager 身份经物化 agent 到达模型（复述身份标题）+ 网关策略层 allowlist 放行 bash / 拒绝 edit',
  prompt: 'Reply with the exact first heading line of your system instructions. Nothing else.',
  timeoutMs: 90_000,
  requires: {},
},

export interface IdentityObservation {
  identityEcho?: string;
  policy: Array<{ tool: string; action: string }>;
}

// evaluateScenario 追加分支与第 5 可选参：
} else if (id === 'identity-roundtrip') {
  if (!/MAFW|MANAGER|identity/i.test(identity?.identityEcho ?? '')) {
    failures.push('assistant reply does not echo the identity heading — materialized agent did not carry the identity system prompt (lane 1 broken)');
  }
  const bash = identity?.policy.find((p) => p.tool === 'bash');
  const edit = identity?.policy.find((p) => p.tool === 'edit');
  if (!bash || bash.action !== 'auto-approve') failures.push('policy: bash (allowlisted) not auto-approved — identity policy dimension not wired');
  if (!edit || edit.action !== 'auto-deny') failures.push('policy: edit (file-edit deny) not auto-denied — identity policy dimension not wired');
}
```

- [ ] **Step 4: routes/conformance.ts 驱动实现**

场景执行分支追加（对照 S4 cognition 模式）：

```typescript
// S5: 创建会话 → 绑定 manager 身份（session 级）→ prompt（复述身份标题）
//   → 收集 assistant 文本 → 直接调 approvalPolicy.evaluate 两个合成候选。
const sess = await deps.createSession();
deps.bindIdentity(sess.id, 'manager'); // 注入 deps：scheduler.identityState.bind
await deps.promptAsync({ sessionID: sess.id, message: scenarioDef.prompt });
// ...等待回合终态（复用 S1/S4 的等待逻辑）→ echo = 最后 assistant 文本
const policy = [
  { tool: 'bash', action: deps.evaluatePolicy(sess.id, { toolName: 'bash', patterns: [], metadata: {} }).action },
  { tool: 'edit', action: deps.evaluatePolicy(sess.id, { toolName: 'edit', patterns: [], metadata: {} }).action },
];
```

`ConformanceDeps` 追加：`bindIdentity(sessionID: string, identity: string): void` 与 `evaluatePolicy(sessionID: string, candidate: any): { action: string }`——在 index.ts 组装 conformance deps 处接到 `this.identityState.bind(sid, identity, 'session')` 与 `this.approvalPolicy.evaluate(...)`。

- [ ] **Step 5: 跑测试 + 构建**

Run: `cd gateway; npx jest tests/unit/runtime/conformance-scenarios.test.ts --runInBand` → PASS
Run: `cd <repo-root>; npm run build` → exit 0
Run: `cd gateway; npx jest --runInBand` → 全绿

- [ ] **Step 6: Commit**

```bash
git add gateway/src/runtime/conformance-scenarios.ts gateway/src/routes/conformance.ts gateway/tests/unit/runtime/conformance-scenarios.test.ts gateway/src/index.ts
git commit -m "feat(identity): S5 identity-roundtrip conformance scenario"
```

---

### Task 7: 文档 + 版本 bump 4.21.0

**Files:**
- Modify: `AGENTS.md`（§5.18 重写 + §5.19 一行注记）
- Modify: `.opencode/skills/runtime-plugin-authoring/SKILL.md`（物化器期望一段）
- Modify: `package.json` + `gateway/package.json` + `packages/gateway-sdk/package.json` + `packages/tui/package.json`（4.21.0）
- Modify: `docs/superpowers/plans/2026-10-08-runtime-neutral-agent-identity.md`（勾选完成项）

- [ ] **Step 1: AGENTS.md §5.18 重写为 IdentityRegistry 段**

标题改为「Manager/身份 Agent 权限（IdentityRegistry，v4.21.0）」，正文要点（保留原权限表语义 + 新机制）：
- IdentityRegistry = 单一事实源（manager/memory-curator 内置；`IdentityPolicy {deny, allowlist}` 中立类别词汇 file-edit/shell/subagent/web/readonly + mafw_* 前缀通配）
- 物化：启动遍历注册表 `agents.install(toAgentDefinition(spec))`（opencode agent md / pi prompts，零重写）；(runtime, identity) 物化状态驱动车道选择
- 绑定：`registerInternalSession(sid, role, identity?)` 登记；manager/worker 会话 session 级；用户选身份回合级（idle 清除）
- prompt 包装器 `withIdentityPrompt`：绑定+物化 → 注入 agent；未物化注册表身份 → 剥离 agent
- 策略层：`ApprovalPolicyService.evaluate` 身份维度先于 internal blanket-deny（manager 是 internal 会话）；internal+allowlist → auto-approve（无人值守）；用户驱动 allowlist 内 → 落三档；`applyApprovalPolicy` 自动应答器零改动生效
- `injectManagerIdentity` 已删除（[SYSTEM] 消息被 compaction 稀释的缺陷修复）

- [ ] **Step 2: SKILL.md 增补物化器段**

`.opencode/skills/runtime-plugin-authoring/SKILL.md` 加一小节：runtime 插件应实现 `agents.install`（= 物化器——把 AgentDefinition 渲染成自家格式：agent md / config 指令键 / patch）；物化成功后 gateway 自动走车道 1（agent 参数绑定）。

- [ ] **Step 3: 四处版本 bump 4.21.0 + 计划文档勾选**

- [ ] **Step 4: 构建 + 全量测试 + 验证**

Run: `cd <repo-root>; npm run build` → exit 0
Run: `cd gateway; npx jest --runInBand` → 全绿，记录 suite/test 数（预期 ≥242 / ≥1650）
Run: `git log --oneline -8` 确认提交链

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md .opencode/skills/runtime-plugin-authoring/SKILL.md package.json gateway/package.json packages/gateway-sdk/package.json packages/tui/package.json docs/superpowers/plans/2026-10-08-runtime-neutral-agent-identity.md
git commit -m "chore(identity): docs + bump v4.21.0"
```

---

## 交付后（不在本计划内）

- 部署走 `mafw-gateway-restart` skill（build → stop → install → daemon → health）
- 线上验证：`GET /api/agents` 含 `source:'mafw'` 的 manager；切 pi runtime 后 manager 列表仍可见；S5 conformance 全场景跑一次
- 车道 2/3（injectSystem 身份块 / 消息位）待首个无法物化的 runtime 出现再立项
