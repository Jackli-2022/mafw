# 切片 1：审批三档 + 规则沉淀 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 审批模式从 manual/auto 二档升级为 read-only / auto / full-access 三档预设；规则存储升级为 `{tool, pattern, action}`；审批弹窗 always 自动沉淀为持久规则（两按钮：此工具 / 此前缀）；三端（gateway/desktop/TUI/SDK）对齐。

**Architecture:** gateway 是单一真相源（spec §6.1）：`ApprovalPolicyService` mode 三值化 + 新 `PermissionRulesStore`（`~/.mafw/permission-rules.json`，从 config.yaml allowlist 启动迁移）；`/api/permissions/:id/reply` 的 always 分支内置落规则（persist 参数扩展 `'tool'|'prefix'`）；desktop/TUI 改 UI 与解析。现有资产复用：permissionReply 已三值、白名单链路已通、desktop 已有 persist 按钮。

**Tech Stack:** gateway TS（jest）/ @mafw/sdk（bun test）/ desktop SolidJS（bun:test）/ TUI node --test。

**Spec:** `docs/superpowers/specs/2026-09-20-desktop-ux-refactor-design.md` §3（切片 1）。

## Global Constraints

- gateway 测试 `npm test`（jest，`--runInBand`）；SDK/desktop `bun test`；TUI `npm run test:tui`
- 现有行为兼容：kv 存量 `'manual'` 读映射 `'read-only'`；`persist:true` 旧语义保留（自动推导，prefix 优先）；config.yaml `approval.allowlist` 迁移后保留原样（legacy 双读过渡）
- fail 语义保持：内部会话 auto-deny（fail-closed）；评估器异常 fail-open→human（人兜底，保守侧）；pi bridge 超时 deny——本切片只钉扎测试不重构
- 广播事件 `permission_mode` 的 `properties.mode` 从二值扩为三值；三端解析必须容忍未知值（回退 read-only）
- 路由注册顺序约束不变：`/api/sessions/:sid/permission-mode` 必须在 `/api/permissions/:id` 通配之前
- 每任务独立 commit；gateway 提交前 `npm test` 全绿，desktop/TUI/SDK 同理

---

### Task 1: gateway PermissionRulesStore（新存储 + 迁移 + 匹配）

**Files:**
- Create: `gateway/src/core/approval/rules-store.ts`
- Create: `gateway/tests/unit/approval/rules-store.test.ts`
- Modify: `gateway/src/core/approval/safety-classifier.ts`（导出 `isReadOnlyTool`）

**Interfaces:**
- Produces:
  - `interface PermissionRule { tool: string; pattern?: string; action: 'allow' }`
  - `class PermissionRulesStore`：`list(): PermissionRule[]` / `add(rule): {ok, rules}` / `remove(rule): {ok, rules}` / `matches(toolName, candidate: ApprovalCandidate): boolean`
  - `deriveAlwaysRule(found: {permission?, toolName?, patterns?}, scope: 'tool'|'prefix'|true): PermissionRule | null`（纯函数：prefix=patterns[0] 剥尾 `*`；scope 'tool' 或无 patterns → 裸工具名）
  - `isReadOnlyTool(toolName: string): boolean`（safety-classifier）
- 匹配语义：tool 大小写不敏感全等；有 pattern → pattern 尾 `*` 剥除后对 commandTextOf(candidate) 与 candidate.patterns（各剥尾 `*`）做 startsWith（lowercase）；无 pattern → 工具级全放。与旧 AllowlistStore.matches 语义向后兼容。

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/approval/rules-store.test.ts`（jest）：

```ts
import { fs, path, os } from 'fs'; // 实际写法：import fs from 'fs'; import path from 'path'; import os from 'os';
import { PermissionRulesStore, deriveAlwaysRule } from '../../../src/core/approval/rules-store';
import { commandTextOf, ApprovalCandidate } from '../../../src/core/approval/safety-classifier';

function tmpStore(): PermissionRulesStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rules-'));
  return new PermissionRulesStore(dir);
}

describe('PermissionRulesStore', () => {
  test('add/list/remove roundtrip + dedupe', () => {
    const s = tmpStore();
    expect(s.list()).toEqual([]);
    expect(s.add({ tool: 'bash', pattern: 'git status', action: 'allow' }).ok).toBe(true);
    expect(s.add({ tool: 'bash', pattern: 'git status', action: 'allow' }).ok).toBe(true); // 幂等
    expect(s.list()).toEqual([{ tool: 'bash', pattern: 'git status', action: 'allow' }]);
    expect(s.add({ tool: 'read', action: 'allow' }).ok).toBe(true);
    expect(s.remove({ tool: 'read', action: 'allow' }).ok).toBe(true);
    expect(s.remove({ tool: 'read', action: 'allow' }).ok).toBe(false);
    expect(s.list()).toEqual([{ tool: 'bash', pattern: 'git status', action: 'allow' }]);
  });

  test('persists across instances (file-backed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rules-'));
    new PermissionRulesStore(dir).add({ tool: 'write', action: 'allow' });
    expect(new PermissionRulesStore(dir).list()).toEqual([{ tool: 'write', action: 'allow' }]);
  });

  test('corrupt file → fail-open empty list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rules-'));
    fs.writeFileSync(path.join(dir, 'permission-rules.json'), '{oops');
    expect(new PermissionRulesStore(dir).list()).toEqual([]);
  });

  test('matches: tool-level rule matches any candidate of that tool', () => {
    const s = tmpStore();
    s.add({ tool: 'read', action: 'allow' });
    expect(s.matches('Read', { toolName: 'read', patterns: [] })).toBe(true);
    expect(s.matches('bash', { toolName: 'bash', patterns: [] })).toBe(false);
  });

  test('matches: prefix pattern via commandText and patterns (case-insensitive, trailing *)', () => {
    const s = tmpStore();
    s.add({ tool: 'bash', pattern: 'git status', action: 'allow' });
    const cand: ApprovalCandidate = { toolName: 'bash', patterns: ['git status --porcelain'], metadata: { args: 'git status' } };
    expect(s.matches('bash', cand)).toBe(true);
    expect(s.matches('bash', { toolName: 'bash', patterns: ['git push'] })).toBe(false);
  });
});

describe('deriveAlwaysRule', () => {
  test('scope prefix → patterns[0] stripped of trailing *', () => {
    expect(deriveAlwaysRule({ permission: 'bash', patterns: ['git status*'] }, 'prefix'))
      .toEqual({ tool: 'bash', pattern: 'git status', action: 'allow' });
  });
  test('scope tool → bare tool name', () => {
    expect(deriveAlwaysRule({ permission: 'bash', patterns: ['git status'] }, 'tool'))
      .toEqual({ tool: 'bash', action: 'allow' });
  });
  test('scope true (legacy) → prefix preferred, fallback tool', () => {
    expect(deriveAlwaysRule({ permission: 'bash', patterns: ['git status*'] }, true))
      .toEqual({ tool: 'bash', pattern: 'git status', action: 'allow' });
    expect(deriveAlwaysRule({ permission: 'read', patterns: [] }, true))
      .toEqual({ tool: 'read', action: 'allow' });
  });
  test('no tool → null', () => {
    expect(deriveAlwaysRule({}, 'tool')).toBeNull();
  });
});
```

（写测试时把第一行 import 改为规范的三个独立 import；上述片段中的注释仅为说明。）

- [ ] **Step 2: 跑测试确认失败**：`cd gateway; npx jest tests/unit/approval/rules-store.test.ts` → FAIL（模块不存在）
- [ ] **Step 3: 实现** `gateway/src/core/approval/rules-store.ts`：

```ts
// 持久审批规则（spec 切片 1）：~/.mafw/permission-rules.json，条目 {tool, pattern?, action}。
// 取代 config.yaml approval.allowlist 成为规则唯一存储；启动迁移见 migrateFromAllowlist。
// fail-open：文件缺失/损坏 → 空表（宁可多问，不静默放行）。
import * as fs from 'fs';
import * as path from 'path';
import { ApprovalCandidate, commandTextOf } from './safety-classifier';

export interface PermissionRule { tool: string; pattern?: string; action: 'allow' }

function fileOf(dir: string): string { return path.join(dir, 'permission-rules.json'); }

function sameRule(a: PermissionRule, b: PermissionRule): boolean {
  return a.tool === b.tool && (a.pattern ?? '') === (b.pattern ?? '') && a.action === b.action;
}

export class PermissionRulesStore {
  constructor(private dir: string) {}

  private read(): PermissionRule[] {
    try {
      const raw = JSON.parse(fs.readFileSync(fileOf(this.dir), 'utf8'));
      const rules = Array.isArray(raw?.rules) ? raw.rules : [];
      return rules.filter((r: any) => r && typeof r.tool === 'string' && r.tool.trim()
        && (r.pattern === undefined || typeof r.pattern === 'string')
        && r.action === 'allow') as PermissionRule[];
    } catch { return []; }
  }

  private write(rules: PermissionRule[]): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = fileOf(this.dir) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ rules }, null, 2));
      fs.renameSync(tmp, fileOf(this.dir));
    } catch { /* fail-open：写失败保留内存态由调用方决定 */ }
  }

  list(): PermissionRule[] { return this.read(); }

  add(rule: PermissionRule): { ok: boolean; rules: PermissionRule[] } {
    if (!rule?.tool || typeof rule.tool !== 'string' || rule.action !== 'allow') {
      return { ok: false, rules: this.list() };
    }
    const clean: PermissionRule = rule.pattern
      ? { tool: rule.tool, pattern: rule.pattern, action: 'allow' }
      : { tool: rule.tool, action: 'allow' };
    const rules = this.read();
    if (rules.some((r) => sameRule(r, clean))) return { ok: true, rules };
    rules.push(clean);
    this.write(rules);
    return { ok: true, rules };
  }

  remove(rule: PermissionRule): { ok: boolean; rules: PermissionRule[] } {
    const rules = this.read();
    const next = rules.filter((r) => !sameRule(r, rule));
    if (next.length === rules.length) return { ok: false, rules };
    this.write(next);
    return { ok: true, rules: next };
  }

  matches(toolName: string, candidate: ApprovalCandidate): boolean {
    return this.read().some((e) => {
      if (e.tool.toLowerCase() !== toolName.toLowerCase()) return false;
      if (!e.pattern) return true;
      const prefix = e.pattern.toLowerCase().replace(/\*+$/, '');
      const text = commandTextOf(candidate).toLowerCase();
      const patterns = candidate.patterns.map((p) => p.toLowerCase().replace(/\*+$/, ''));
      return text.startsWith(prefix) || patterns.some((p) => p.startsWith(prefix));
    });
  }
}

/** 'always' 审批 → 规则（纯函数）。scope true = 旧行为（prefix 优先）；'tool' = 裸工具名。 */
export function deriveAlwaysRule(
  found: { permission?: string; toolName?: string; patterns?: string[] },
  scope: 'tool' | 'prefix' | true,
): PermissionRule | null {
  const tool = String(found?.permission ?? found?.toolName ?? '').trim();
  if (!tool) return null;
  const firstPattern = Array.isArray(found?.patterns) ? String(found.patterns[0] ?? '').trim() : '';
  const prefix = firstPattern.replace(/\*+$/, '').trim();
  if (scope === 'tool' || !prefix) return { tool, action: 'allow' };
  return { tool, pattern: prefix, action: 'allow' };
}
```

同时 `safety-classifier.ts` 导出只读判定（在 READ_ONLY_TOOLS 定义后加）：

```ts
export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(String(toolName).toLowerCase());
}
```

- [ ] **Step 4: 跑测试确认通过**：`cd gateway; npx jest tests/unit/approval/rules-store.test.ts` → PASS
- [ ] **Step 5: Commit**：`git add gateway/src/core/approval/ gateway/tests/unit/approval/rules-store.test.ts; git commit -m "feat(approval): PermissionRulesStore ({tool,pattern,action}) + deriveAlwaysRule + isReadOnlyTool"`

---

### Task 2: gateway mode 三值化（read-only / auto / full-access）

**Files:**
- Modify: `gateway/src/core/approval/policy-service.ts`
- Modify: `gateway/src/routes/permission-mode.ts`
- Create: `gateway/tests/unit/approval/policy-modes.test.ts`
- Modify: `gateway/src/index.ts`（`allowlistMatches` 注入改双读：rules.matches || allowlist.matches；见接线说明）

**Interfaces:**
- `SessionPermissionMode = 'read-only' | 'auto' | 'full-access'`（`'manual'` 为 deprecated 别名：loadMode/saveMode/setMode 入参接受 `'manual'` 归一化为 `'read-only'`，对外只返回新值）
- evaluate 语义：
  1. internal → auto-deny（不变）
  2. rules/allowlist 命中 → auto-approve（不变，双读）
  3. `read-only`：`isReadOnlyTool(toolName)` → auto-approve；否则 human
  4. `full-access`：一律 auto-approve（dangerous 也放；不计数；internal 已在步骤 1 拦截）
  5. `auto`：dangerous → human；预算耗尽 → 回落 **read-only**（原回落 manual）+ 广播；否则 auto-approve 计数
- `POST /api/sessions/:sid/permission-mode` 接受三值 + `'manual'`（归一化）；GET 返回三值

- [ ] **Step 1: 写失败测试** `gateway/tests/unit/approval/policy-modes.test.ts`：构造 `ApprovalPolicyService`（deps 用内存 Map 假实现），覆盖：read-only 档只读工具 approve / write 工具 human；full-access 档 dangerous 也 approve 且不计数；auto 档预算耗尽回落 read-only 且 saveMode 收到 read-only；loadMode 返回 'manual' 归一化 read-only。断言用 `policy.evaluate('s1', candidate).action` 与 `getMode()`。
- [ ] **Step 2: 跑测试确认失败**（FAIL）
- [ ] **Step 3: 实现 policy-service.ts 修改**：
  - `export type SessionPermissionMode = 'read-only' | 'auto' | 'full-access';` + `const LEGACY_MODE_MAP = { manual: 'read-only' } as const;` + `function normalizeMode(m: string): SessionPermissionMode { return (LEGACY_MODE_MAP as any)[m] ?? (['read-only','auto','full-access'].includes(m) ? m : 'read-only'); }`
  - `ensureLoaded` 的 `.then((m) => { if (m === 'auto' || m === 'manual') ... })` 改 `this.modes.set(sessionID, normalizeMode(String(m)))`
  - evaluate 步骤 3-6 改：

```ts
    // 3. 三档预设
    const mode = this.modes.get(sessionID) ?? 'read-only';
    const verdict = classifySafety(candidate);
    if (mode === 'read-only') {
      if (isReadOnlyTool(candidate.toolName)) {
        return { action: 'auto-approve', verdict, reason: 'read-only mode — read-only tool' };
      }
      return { action: 'human', verdict, reason: 'read-only mode — mutating tool requires approval' };
    }
    if (mode === 'full-access') {
      return { action: 'auto-approve', verdict, reason: 'full-access mode' };
    }
    // 4. auto 档：dangerous 永不自动放行
    if (verdict === 'dangerous') {
      return { action: 'human', verdict, reason: 'dangerous command pattern' };
    }
    // 5. 预算
    const used = this.counts.get(sessionID) ?? 0;
    if (used >= AUTO_APPROVE_BUDGET) {
      this.modes.set(sessionID, 'read-only');
      this.counts.delete(sessionID);
      void this.deps.saveMode(sessionID, 'read-only').catch(() => {});
      this.deps.onModeChanged(sessionID, 'read-only', `auto-approve budget (${AUTO_APPROVE_BUDGET}) exhausted — fell back to read-only`);
      return { action: 'human', verdict, reason: 'budget exhausted, mode fell back to read-only' };
    }
    // 6. auto-approve
    this.counts.set(sessionID, used + 1);
    return { action: 'auto-approve', verdict, reason: `auto mode (${used + 1}/${AUTO_APPROVE_BUDGET})` };
```

  - `setMode(sessionID, mode: SessionPermissionMode | 'manual')` 入参归一化；文件头注释更新评估顺序。
- [ ] **Step 4: permission-mode.ts 路由**：`handlePermissionModeSet` 校验改 `['read-only','auto','full-access','manual'].includes(body?.mode)`，传 `normalizeMode(body.mode)`；错误消息 `"mode must be 'read-only'|'auto'|'full-access'"`。
- [ ] **Step 5: index.ts 接线**：找到 policy 构造处 `allowlistMatches: ... allowlist.matches ...`（探查报告：index.ts:1854 附近），改为双读 `allowlistMatches: (tool, cand) => approvalRules.matches(tool, cand) || allowlistStore.matches(tool, cand)`；`approvalRules` 为 `new PermissionRulesStore(<mafw 数据目录>)`（与 permission-rules.json 路径一致——用 config 已有的 `~/.mafw` 根，同 `paths.mafwDir`/`config.resolvePath` 现有取法，executor 现场对齐）。
- [ ] **Step 6: 全量 gateway 测试**：`cd gateway; npm test` → 全绿（既有 approval 相关测试若断言 manual/auto 二值，随三值化更新断言）
- [ ] **Step 7: Commit**：`git commit -m "feat(approval): three preset modes (read-only/auto/full-access) with legacy manual mapping"`

---

### Task 3: gateway always → 规则沉淀（persist 参数扩展 + 路由对称）

**Files:**
- Modify: `gateway/src/routes/permission.ts`（`persistAlwaysToAllowlist` → 改用 `deriveAlwaysRule` + `PermissionRulesStore`；rename/兼容）
- Modify: `gateway/src/index.ts`（两处 reply 路由接线：`/api/permissions/:id/reply` 与 `/api/sessions/:sid/permissions/:rid`）
- Modify: `gateway/tests/unit/approval/`（permission 路由测试；若无则补 persistAlwaysToAllowlist 等价测试）

**Interfaces:**
- `POST /api/permissions/:id/reply` body：`{ reply, message?, persist?: boolean | 'tool' | 'prefix' }`
  - `reply === 'always'` 时（无论 persist 是否传）：反查 permissionList 得 request → `deriveAlwaysRule(request, scope)` → `rulesStore.add`；scope 解析：`persist === 'tool' → 'tool'`；`persist === 'prefix' → 'prefix'`；`persist === true 或未传 → true`（旧行为自动推导）。fail-open：反查失败仅 warn，不阻断 reply。
  - 旧 `persistAlwaysToAllowlist` 保留导出（deprecated）或删除——若无其他引用则删除，测试同步替换。
- `/api/sessions/:sid/permissions/:rid` 直连路由补同一 always 落规则逻辑（对称，探查报告差距 10）。

- [ ] **Step 1: 写失败测试**（permission reply always → rulesStore 增加条目；persist:'tool' 覆盖 prefix 推导；always 无 persist 也落规则）：仿照现有 routes 测试形态（若 `gateway/tests/unit` 无 permission 路由测试，新增 `permission-reply-rules.test.ts`，mock runtime `{ session: { permissionReply: async () => true, permissionList: async () => [...] } }` + 内存 rules 目录）。
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：`handlePermissionReply` 增加可选第 5 参 `persistDeps?: { rules: PermissionRulesStore; findRequest(id: string): Promise<any> }`；always 分支：

```ts
    if (reply === 'always' && persistDeps) {
      try {
        const found = await persistDeps.findRequest(requestId);
        const scope = body.persist === 'tool' ? 'tool' : body.persist === 'prefix' ? 'prefix' : true;
        const rule = deriveAlwaysRule(found ?? {}, scope);
        if (rule) persistDeps.rules.add(rule);
      } catch (e: any) { console.warn('[mafw] always-rule persist failed (fail-open):', e?.message); }
    }
```

  index.ts 两处调用点注入 `persistDeps`（findRequest 用现有 `permissionList` 反查逻辑，即原 `persistAlwaysToAllowlist` 调用点的查询代码；executor 现场对齐 index.ts:4169-4175 与 session 直连路由）。
- [ ] **Step 4: 跑测试确认通过 + gateway 全量绿**
- [ ] **Step 5: Commit**：`git commit -m "feat(approval): always replies persist as rules (tool|prefix scope) on both reply routes"`

---

### Task 4: SDK 对齐

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts`（`permissions.reply` 第 4 参类型放宽；新增 `approvals.rules` 命名空间或 `permissions.rules`——放 `permissions.rules`：`list()/add(rule)/remove(rule)` 打 `GET/POST/DELETE /api/approvals/rules`）
- Modify: `packages/gateway-sdk/src/types.ts`（`PermissionRequest.persist` 相关 + `PermissionRule` DTO）
- Modify: `packages/gateway-sdk/src/client.test.ts`（新方法 wire 测试）

**Interfaces:**
- `reply(id: string, reply: 'once'|'always'|'reject', message?: string, persist?: boolean | 'tool' | 'prefix')`
- `permissions.rules.list(): Promise<{ entries: PermissionRule[] }>`；`add(rule: { tool: string; pattern?: string }): ...`；`remove(rule): ...`（action 固定 allow，DTO 带 `action: 'allow'`）
- Create: `gateway/src/routes/rules.ts`（`GET/POST/DELETE /api/approvals/rules`，仿 allowlist.ts 形态，deps 注入 rulesStore）+ index.ts 接线（注册在 allowlist 路由旁）+ jest 测试

- [ ] **Step 1: gateway rules 路由 + 测试**（仿 `allowlist.ts` 全文件形状，校验 tool 必填/pattern 可选）
- [ ] **Step 2: SDK client 方法 + 类型 + bun 测试**（`cd packages/gateway-sdk && bun test`）
- [ ] **Step 3: gateway + SDK 全量绿**
- [ ] **Step 4: Commit**：`git commit -m "feat(sdk): permissions.rules CRUD + reply persist scope; gateway rules routes"`

---

### Task 5: desktop 三档 UI + 两按钮 + 规则管理

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/permission-card-mapping.ts`（`nextMode` 二档循环 → `PERMISSION_MODES: ['read-only','auto','full-access']` 循环 + 类型三值 + 测试更新）
- Modify: `packages/desktop/src/renderer/mafw/components/PermissionCard.tsx`（P 拆两按钮：`总是允许此工具`→ persist `'tool'`、`总是允许此前缀`→ persist `'prefix'`（`props.data.patterns`/payload 空时隐藏 prefix 按钮）；键盘保留 P=prefix，新增 T=tool）
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（`permReply` 透传 persist scope；`permissionModes` store 类型三值；🛡 toggle 循环三档——ChatPane.tsx:2054-2062 的按钮点击改调 `nextMode` 新循环，文案 `🛡 只读 / 🛡 auto / 🛡 全开`）
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/flow-cards.ts`（`setPermissionMode` 类型三值 + 未知值回退 read-only）
- Modify: `packages/desktop/src/renderer/mafw/components/ApprovalsSection.tsx`（allowlist CRUD → rules CRUD：条目 `{tool, pattern?}` 显示、pattern 输入框替代/并入 prefix、调 `permissions.rules.*`；保留原 tool+prefix 双输入的视觉结构，字段改名）
- Test: 更新 `permission-card-mapping.test.ts`（nextMode 三态）、`ApprovalsSection.test.ts`（sortAllowlistEntries 若签名不变则只改数据源命名）

- [ ] **Step 1: mapping 三档失败测试**（nextMode('read-only')→'auto'→'full-access'→'read-only'）→ 实现 → 通过
- [ ] **Step 2: PermissionCard 两按钮 + ChatPane/MafwShell/flow-cards 接线**（preload `permissions.reply` 的 persist 参数类型在 mafw-api.ts 同步放宽；IPC 透传字符串）
- [ ] **Step 3: ApprovalsSection 切 rules API**
- [ ] **Step 4: `cd packages/desktop && bun test` 全绿 + `npx electron-vite build` 成功**
- [ ] **Step 5: Commit**：`git commit -m "feat(desktop): three-mode approval toggle, tool/prefix always-persist buttons, rules manager"`

---

### Task 6: TUI 三档对齐

**Files:**
- Modify: `packages/tui/src/store/permission-mode.ts`（mode 三值 + toggle 循环三档）
- Modify: `packages/tui/src/app.ts`（`/permissions` 循环三档；状态栏 permAuto 徽标三态文案）
- Modify: `packages/tui/src/ui/overlays.ts`（permission overlay persist 项说明文案对齐「总是允许此前缀」；once/always/persist/reject 结构不变）
- Test: `packages/tui/tests/`（permission-mode store 三态循环测试，node --test 风格，禁 TS parameter properties）

- [ ] **Step 1: 失败测试**（toggle 三态循环 + 未知值回退）→ 实现 → 通过
- [ ] **Step 2: `npm run test:tui` 全绿**
- [ ] **Step 3: Commit**：`git commit -m "feat(tui): three-mode /permissions cycle + overlay persist wording"`

---

### Task 7: AGENTS.md + 全量验证

- [ ] **Step 1: AGENTS.md**：§4.1/§5.19 相关处补一段「审批三档（2026-09-20，切片 1）」：mode 三值语义、rules 存储位置与迁移、persist scope 参数、预算回落 read-only、pi 扩展名单旁路未统一（已知边界）
- [ ] **Step 2: 全量**：`npm test`（gateway）+ `npm run test:desktop` + `npm run test:tui` + `cd packages/gateway-sdk && bun test` 全绿；`cd gateway && npm run build` 成功
- [ ] **Step 3: 手动冒烟**（desktop dev）：🛡 三档循环生效；read-only 档下 write/bash 弹卡、read 不弹；卡片「总是允许此工具/此前缀」分别落 `~/.mafw/permission-rules.json`；Config→Approvals 列表出现并可删；full-access 下 dangerous 命令不再弹卡
- [ ] **Step 4: Commit**：`git commit -m "docs: approval three-mode preset + rules store (slice 1)"`

---

## 明确不做（本切片）

- pi 扩展内置 autoApprove 名单与 gateway 三档的统一（旁路保留，AGENTS.md 声明边界）
- 审批卡 callId 引用工具卡（desktop 内联锚定已覆盖"引用"语义，spec 差距 8 视为已达成）
- `/api/approvals/:id/respond` 空 stub 修复（独立 bug，另开任务）
- opencode 原生 agent permission 配置与 MAFW 层合并（正交保留）

## Self-Review 记录

- Spec §3 覆盖：三档预设（Task 2）、规则存储+迁移（Task 1）、always 沉淀（Task 3）、两按钮（Task 5）、Config 规则列表（Task 5）、TUI 对齐（Task 6）、fail-closed（现状已满足，Task 2 测试钉扎 internal-deny 路径）
- 类型一致：`PermissionRule` 在 Task 1 定义，Task 3/4/5 消费同名；persist scope `'tool'|'prefix'|true` 四端一致；mode 三值 `'read-only'|'auto'|'full-access'` 贯穿
- 已知风险：index.ts 接线点行号会漂移（探查报告行号为 2026-09-20 快照），executor 以内容锚点定位
