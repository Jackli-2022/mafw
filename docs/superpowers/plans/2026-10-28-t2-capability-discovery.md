# T2-5 能力发现契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把命令、技能与 AGENTS.md 来源收敛成 gateway 的可查询发现契约，修复 `/command`/`/skill` 断链，并新增 `session.commands` 广播。

**Architecture:** 新增 `DiscoveryService`（目录级缓存 + 分区降级 + 已知会话广播），由 MAFW registry、runtime `discovery` 通道、AGENTS.md 文件扫描三源合并；HTTP 层同时提供新 discovery 端点和 legacy `/command`/`/skill`；SDK 增加 `discovery` 命名空间并接入 canonical event union。

**Tech Stack:** TypeScript、Node HTTP、Jest（gateway）、Bun test（SDK）、opencode 2.1 serve、pi runtime。

**Spec:** `docs/superpowers/specs/2026-10-27-t2-capability-discovery-design.md`

## Global Constraints

- 不 push / 不开 PR / 不 npm publish，除非用户明确确认。
- 使用 native/inline、main 直提；只通过 edit/write 改源码。
- 不触碰并行会话的未跟踪/未提交文件；提交只 add 本任务列出的路径。
- 每条新行为先写失败测试，再实现；每个 Task 结束跑该 Task 的测试并 commit。
- AGENTS.md 正文绝不通过 endpoint/event 暴露；只返回 path/scope/bytes/mtime。
- 技能正文只通过 `GET /api/sessions/:id/discovery/skills/:key`，上限 512KB；不接受任意路径。
- `session.commands` 只广播命令；skills/AGENTS 是 pull-only。
- `discoveryApi`：opencode 2.1 true；pi / legacy caps false。
- 缓存 TTL：正常 30s；`runtime_error`/`partial` 5s；`capability_absent`/`instructions_error` 30s。
- legacy `/command` 只返回 runtime 命令；MAFW 命令由桌面单独拉取，避免重复。
- 交付时记录版本号、commit 哈希、新增测试数、全量通过数。

**Execution baseline:** before Task 1 run `git rev-parse HEAD` and keep it as `BASE`; Task 11 reviews `git diff $BASE..HEAD`.

## Review Focus

- **Foreign/worktree directory**：MAFW project custom 命令不能从 gateway 项目泄漏到其他目录；应省略并 warning。测试归 Task 4 + Task 6。
- **Runtime partial failure**：`/api/command` 成功但 `/api/skill` 失败时，命令必须保留、技能为空并 warning；反向亦然。测试归 Task 2 + Task 6。
- **AGENTS boundary**：home 内/外、`.git` 目录/文件、无 `.git`、缺失文件、realpath 去重；返回集合必须与 opencode v2 边界一致。测试归 Task 5。
- **Skill key**：URL 编码、id/name 命中、同名 409、未知 404、超大 413、runtime 不可用 503，且绝不按 key 读任意文件。测试归 Task 6 + Task 7。
- **Legacy endpoints**：runtime 0 命令或不可用时仍返回 JSON 200（非 HTML），且 `/command` 不出现 MAFW 命令。测试归 Task 7 + Task 10。

---

### Task 1: Runtime 契约、能力位与校验

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Modify: `gateway/src/runtime/validate.ts`
- Modify: `gateway/src/runtime/plugins/pi-runtime.ts`
- Modify: `gateway/src/index.ts`（`legacyCaps` 一处）
- Test: `gateway/tests/unit/runtime/contract.test.ts`
- Test: `gateway/tests/unit/runtime/validate-shape.test.ts`
- Test: `gateway/tests/unit/runtime/opencode-runtime.test.ts`
- Test: `gateway/tests/unit/runtime/pi-runtime.test.ts`

**Interfaces:**
- Produces: `RuntimeCapabilities.discoveryApi?: boolean`
- Produces: `RuntimeCommandInfo`, `RuntimeSkillInfo`, `RuntimeSkillContent`, `RuntimeDiscoveryWarning`, `RuntimeDiscoveryResult`, `RuntimeDiscoveryChannel`
- Produces: `RuntimeClient.discovery?: RuntimeDiscoveryChannel`
- Produces: `RuntimeDiscoveryChannel.list(opts: { directory: string }): Promise<RuntimeDiscoveryResult>`
- Produces: `RuntimeDiscoveryChannel.loadSkill(opts: { directory: string; key: string }): Promise<RuntimeSkillContent | null>`

- [ ] **Step 1: Write failing capability/type tests**

In `gateway/tests/unit/runtime/contract.test.ts` add assertions:

```ts
expect(fullCapabilities().discoveryApi).toBe(true);
expect(minimalCapabilities().discoveryApi).toBe(false);
```

In `gateway/tests/unit/runtime/validate-shape.test.ts` add:

```ts
it('discoveryApi without discovery.{list,loadSkill} -> downgraded', () => {
  const rt = OK_RT({ caps: { discoveryApi: true } });
  const v = validateRuntime(rt as any, 'my-rt');
  expect(v.downgraded.some((i) => i.includes('discoveryApi'))).toBe(true);
  expect((rt as any).capabilities.discoveryApi).toBe(false);
});

it('discoveryApi with discovery.{list,loadSkill} -> stays true', () => {
  const rt = OK_RT({
    caps: { discoveryApi: true },
    discovery: { list: async () => ({ commands: [], skills: [], warnings: [] }), loadSkill: async () => null },
  });
  const v = validateRuntime(rt as any, 'my-rt');
  expect(v.downgraded).toEqual([]);
  expect((rt as any).capabilities.discoveryApi).toBe(true);
});
```

In `gateway/tests/unit/runtime/opencode-runtime.test.ts` add `discoveryApi: true` to the exact capability object at line ~114. In `gateway/tests/unit/runtime/pi-runtime.test.ts` assert `PI_CAPABILITIES.discoveryApi` is false.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/runtime/contract.test.ts tests/unit/runtime/validate-shape.test.ts tests/unit/runtime/opencode-runtime.test.ts tests/unit/runtime/pi-runtime.test.ts --runInBand`

Expected: FAIL — `discoveryApi` undefined / missing in exact capability object.

- [ ] **Step 3: Implement contract + capability flags**

In `gateway/src/runtime/contract.ts` add `discoveryApi?: boolean` after `instructionsApi`, add `discoveryApi: true` in `fullCapabilities()`, `false` in `minimalCapabilities()`, and add the runtime discovery types near `RuntimeClient`:

```ts
export interface RuntimeCommandInfo {
  name: string;
  description?: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  subtask?: boolean;
  template?: string;
}
export interface RuntimeSkillInfo {
  id: string;
  name: string;
  description?: string;
  slash?: boolean;
  location?: string;
  contentLength: number;
}
export interface RuntimeSkillContent extends RuntimeSkillInfo { content: string }
export interface RuntimeDiscoveryWarning { source: 'commands' | 'skills'; message: string }
export interface RuntimeDiscoveryResult {
  commands: RuntimeCommandInfo[];
  skills: RuntimeSkillInfo[];
  warnings: RuntimeDiscoveryWarning[];
}
export interface RuntimeDiscoveryChannel {
  list(opts: { directory: string }): Promise<RuntimeDiscoveryResult>;
  loadSkill(opts: { directory: string; key: string }): Promise<RuntimeSkillContent | null>;
}
```

Add `discovery?: RuntimeDiscoveryChannel;` to `RuntimeClient` near `app`/`config`.

In `gateway/src/runtime/validate.ts` add to `CAPABILITY_REQUIREMENTS`:

```ts
{ cap: 'discoveryApi', label: 'discovery.{list,loadSkill}', satisfied: (rt) =>
    isObject(rt.discovery) && isFn(rt.discovery.list) && isFn(rt.discovery.loadSkill) },
```

In `gateway/src/runtime/plugins/pi-runtime.ts` add `discoveryApi: false` to `PI_CAPABILITIES`. In `gateway/src/index.ts` change `legacyCaps` to `{ ...fullCapabilities(), instructionsApi: false, discoveryApi: false }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/runtime/contract.test.ts tests/unit/runtime/validate-shape.test.ts tests/unit/runtime/opencode-runtime.test.ts tests/unit/runtime/pi-runtime.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/contract.ts gateway/src/runtime/validate.ts gateway/src/runtime/plugins/pi-runtime.ts gateway/src/index.ts gateway/tests/unit/runtime/contract.test.ts gateway/tests/unit/runtime/validate-shape.test.ts gateway/tests/unit/runtime/opencode-runtime.test.ts gateway/tests/unit/runtime/pi-runtime.test.ts
git commit -m "feat(discovery): add runtime discovery capability contract"
```

---

### Task 2: Opencode adapter discovery 通道

**Files:**
- Modify: `gateway/src/runtime/opencode-adapter.ts`
- Test: `gateway/tests/unit/runtime/opencode-discovery.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `RuntimeDiscoveryChannel` / `RuntimeDiscoveryResult`
- Produces: `createOpencodeAdapter(...).discovery.list({ directory })`
- Produces: `createOpencodeAdapter(...).discovery.loadSkill({ directory, key })`

- [ ] **Step 1: Write failing adapter tests**

Create `opencode-discovery.test.ts` with mocks for `serve-sidecar`/`config` (same pattern as `opencode-runtime.test.ts`) and a `global.fetch` stub. Add:

```ts
it('maps live sparse command/skill payload and strips skill content', async () => {
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.includes('/api/command')) return json({
      location: { directory: '/proj' },
      data: [{ name: 'init', description: 'guided setup' }],
    });
    return json({
      location: { directory: '/proj' },
      data: [{ id: 'mafw-plan', name: 'mafw-plan', path: '/proj/.opencode/skills/mafw-plan/SKILL.md', content: '# plan' }],
    });
  });
  const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
  const out = await rt.discovery!.list({ directory: '/proj' });
  expect(out.commands).toEqual([{ name: 'init', description: 'guided setup' }]);
  expect(out.skills).toEqual([{
    id: 'mafw-plan', name: 'mafw-plan',
    location: '/proj/.opencode/skills/mafw-plan/SKILL.md',
    slash: false, contentLength: 6,
  }]);
  expect(out.warnings).toEqual([]);
});

it('keeps commands when skills endpoint fails', async () => {
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.includes('/api/command')) return json({ data: [{ name: 'init' }] });
    throw new Error('skill endpoint down');
  });
  const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
  const out = await rt.discovery!.list({ directory: '/proj' });
  expect(out.commands).toEqual([{ name: 'init' }]);
  expect(out.skills).toEqual([]);
  expect(out.warnings[0]).toMatchObject({ source: 'skills' });
});

it('loadSkill returns content by id/name and null when absent', async () => {
  (global as any).fetch = jest.fn(async () => json({
    data: [{ id: 'mafw-plan', name: 'mafw-plan', path: '/p/SKILL.md', content: '# plan' }],
  }));
  const rt = await createOpencodeAdapter({ baseUrl: 'http://127.0.0.1:4096' });
  expect((await rt.discovery!.loadSkill({ directory: '/proj', key: 'mafw-plan' }))?.content).toBe('# plan');
  expect(await rt.discovery!.loadSkill({ directory: '/proj', key: 'nope' })).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/runtime/opencode-discovery.test.ts --runInBand`

Expected: FAIL — `rt.discovery` undefined.

- [ ] **Step 3: Implement adapter discovery**

In `opencode-adapter.ts`, inside the returned object after `app` add `discovery`:

```ts
discovery: {
  async list({ directory }) {
    const [cmd, skill] = await Promise.allSettled([
      directNative('/command', 'GET', undefined, directory),
      directNative('/skill', 'GET', undefined, directory),
    ]);
    const warnings: Array<{ source: 'commands' | 'skills'; message: string }> = [];
    const commands = cmd.status === 'fulfilled'
      ? (unwrapNative<any[]>(cmd.value) ?? []).map(mapRuntimeCommand).filter((c) => !!c.name)
      : [];
    if (cmd.status === 'rejected') warnings.push({ source: 'commands', message: String(cmd.reason?.message ?? cmd.reason).slice(0, 300) });
    const skills = skill.status === 'fulfilled'
      ? (unwrapNative<any[]>(skill.value) ?? []).map(mapRuntimeSkill).filter((s) => !!s.id)
      : [];
    if (skill.status === 'rejected') warnings.push({ source: 'skills', message: String(skill.reason?.message ?? skill.reason).slice(0, 300) });
    return { commands, skills, warnings };
  },
  async loadSkill({ directory, key }) {
    const body = await directNative('/skill', 'GET', undefined, directory);
    const raw = unwrapNative<any[]>(body) ?? [];
    const rawHit = raw.find((s: any) => (s?.id ?? s?.name) === key || s?.name === key);
    if (!rawHit) return null;
    return { ...mapRuntimeSkill(rawHit), content: String(rawHit.content ?? '') };
  },
},
```

Add module-level helpers:

```ts
function mapRuntimeCommand(c: any): RuntimeCommandInfo {
  return {
    name: String(c?.name ?? ''),
    ...(c?.description ? { description: String(c.description) } : {}),
    ...(c?.agent ? { agent: String(c.agent) } : {}),
    ...(c?.model && typeof c.model === 'object' && c.model.id && c.model.providerID
      ? { model: { id: String(c.model.id), providerID: String(c.model.providerID), ...(c.model.variant ? { variant: String(c.model.variant) } : {}) } }
      : {}),
    ...(c?.subtask !== undefined ? { subtask: !!c.subtask } : {}),
    ...(c?.template ? { template: String(c.template) } : {}),
  };
}
function mapRuntimeSkill(s: any): RuntimeSkillInfo {
  return {
    id: String(s?.id ?? s?.name ?? ''),
    name: String(s?.name ?? s?.id ?? ''),
    ...(s?.description ? { description: String(s.description) } : {}),
    slash: !!s?.slash,
    ...((s?.path ?? s?.location) ? { location: String(s.path ?? s.location) } : {}),
    contentLength: typeof s?.content === 'string' ? s.content.length : 0,
  };
}
```

Import the types from `./contract`. Keep `loadSkill` content lookup robust: for the hit, find the raw item again by `(raw.id ?? raw.name) === hit.id`; if raw id absent, fallback to first name match.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/runtime/opencode-discovery.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/opencode-adapter.ts gateway/tests/unit/runtime/opencode-discovery.test.ts
git commit -m "feat(discovery): add opencode command/skill discovery adapter"
```

---

### Task 3: pi 会话目录记录

**Files:**
- Modify: `gateway/src/runtime/pi/pi-session.ts`
- Test: `gateway/tests/unit/runtime/pi-session.test.ts`

**Interfaces:**
- Produces: `PiSessionRegistry.get(id)` / `list()` 返回 `directory`（live 会话为 create 时的 cwd）
- Produces: `delete()` / `disposeAll()` 清理目录映射

- [ ] **Step 1: Write failing pi directory tests**

In `gateway/tests/unit/runtime/pi-session.test.ts` add:

```ts
it('records cwd for live sessions and exposes it via get/list', async () => {
  const registry = new PiSessionRegistry({ createSession: async () => ({ session: fakeSession() }) });
  const { id } = await registry.create('/tmp/proj', {});
  expect((await registry.get(id)).directory).toBe('/tmp/proj');
  expect((await registry.list()).find((s) => s.id === id)?.directory).toBe('/tmp/proj');
});

it('clears cwd on delete/disposeAll', async () => {
  const registry = new PiSessionRegistry({ createSession: async () => ({ session: fakeSession() }) });
  const { id } = await registry.create('/tmp/proj', {});
  await registry.delete(id);
  expect(await registry.get(id)).toBeUndefined();
  await expect(registry.list()).resolves.toEqual([]);
});
```

Use the existing `fakeSession` helper already in that file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/runtime/pi-session.test.ts --runInBand`

Expected: FAIL — directory is `''`.

- [ ] **Step 3: Implement cwd map**

Add `private directories = new Map<string, string>();` to `PiSessionRegistry`. In `create()`, after `this.sessions.set(id, session)`, set `this.directories.set(id, cwd)`. In `delete()`, delete `this.directories`. In `disposeAll()`, clear. In `list()` and `get()`, return `directory: this.directories.get(id) ?? ''`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/runtime/pi-session.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pi/pi-session.ts gateway/tests/unit/runtime/pi-session.test.ts
git commit -m "fix(pi): retain session directory for discovery"
```

---

### Task 4: 纯合并层（MAFW 目录过滤 + skills scope + revision）

**Files:**
- Create: `gateway/src/core/discovery/types.ts`
- Create: `gateway/src/core/discovery/merge.ts`
- Test: `gateway/tests/unit/core/discovery/merge.test.ts`（新建）

**Interfaces:**
- Produces: `DiscoveryCommand`, `DiscoverySkill`, `DiscoveryInstruction`, `DiscoveryWarning`, `DiscoverySnapshot`, `DiscoverySkillContent`, `DiscoveryDegradedReason`
- Produces: `mergeCommands(input: { mafw: MafwCommandDef[]; runtime: RuntimeCommandInfo[]; directory: string; gatewayProjectDir: string; mafwDir: string }): { commands: DiscoveryCommand[]; warnings: DiscoveryWarning[] }`
- Produces: `mergeSkills(runtime: RuntimeSkillInfo[], opts: { directory: string; homeDir: string; globalConfigDir: string }): DiscoverySkill[]`
- Produces: `computeRevision(input: { commands: DiscoveryCommand[]; skills: DiscoverySkill[]; instructions: DiscoveryInstruction[] }): { revision: string; commandsRevision: string }`

- [ ] **Step 1: Write failing merge tests**

Create `merge.test.ts` with `path.resolve()` fixtures. Cover:

```ts
it('includes MAFW builtin + user custom + same-project custom, omits foreign custom', () => {
  const home = path.resolve('home');
  const proj = path.resolve('proj');
  const other = path.resolve('other');
  const mafw = [
    { name: 'goal', description: 'g', category: 'goals', kind: 'builtin' },
    { name: 'user-cmd', description: 'u', category: 'custom', kind: 'custom', source: path.join(home, '.mafw/commands/user.md') },
    { name: 'proj-cmd', description: 'p', category: 'custom', kind: 'custom', source: path.join(proj, '.mafw/commands/p.md') },
    { name: 'foreign-cmd', description: 'f', category: 'custom', kind: 'custom', source: path.join(other, '.mafw/commands/f.md') },
  ];
  const out = mergeCommands({
    mafw, runtime: [{ name: 'goal', agent: 'build' }, { name: 'init', description: 'i' }],
    directory: proj, gatewayProjectDir: proj, mafwDir: path.join(home, '.mafw'),
  });
  expect(out.commands.map((c) => c.name)).toEqual(['goal', 'init', 'proj-cmd', 'user-cmd']);
  expect(out.commands.find((c) => c.name === 'goal')).toMatchObject({ source: 'mafw', scope: 'gateway', runtime: true, agent: 'build' });
  expect(out.commands.find((c) => c.name === 'proj-cmd')).toMatchObject({ source: 'custom', scope: 'project' });
  expect(out.commands.find((c) => c.name === 'foreign-cmd')).toBeUndefined();
  expect(out.warnings.some((w) => w.source === 'commands')).toBe(true);
});

it('infers skill scope and strips slash to false when absent', () => {
  const proj = path.resolve('proj');
  const home = path.resolve('home');
  const out = mergeSkills([
    { id: 'a', name: 'A', location: path.join(proj, '.opencode/skills/a/SKILL.md'), contentLength: 10 },
    { id: 'b', name: 'B', location: path.join(home, '.config/opencode/skills/b/SKILL.md'), contentLength: 20 },
  ], { directory: proj, homeDir: home, globalConfigDir: path.join(home, '.config/opencode') });
  expect(out[0]).toMatchObject({ id: 'b', scope: 'user' });
  expect(out[1]).toMatchObject({ id: 'a', scope: 'project', slash: false });
});

it('revision is stable and changes when commands change', () => {
  const a = computeRevision({ commands: [{ name: 'x', description: 'x', source: 'runtime', scope: 'runtime' }], skills: [], instructions: [] });
  const b = computeRevision({ commands: [{ name: 'x', description: 'x', source: 'runtime', scope: 'runtime' }], skills: [], instructions: [] });
  const c = computeRevision({ commands: [{ name: 'y', description: 'y', source: 'runtime', scope: 'runtime' }], skills: [], instructions: [] });
  expect(a).toEqual(b);
  expect(a.revision).not.toBe(c.revision);
  expect(a.commandsRevision).not.toBe(c.commandsRevision);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/core/discovery/merge.test.ts --runInBand`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement types + merge**

Write `types.ts` with the interfaces from spec §4.2. Write `merge.ts`:

- Normalize paths with `path.resolve`; compare with `realpathSync` when possible, fallback resolve.
- `isUnder(child, parent)`: `child === parent || child.startsWith(parent + path.sep)`.
- MAFW custom filter exactly as spec §4.3; one warning when any foreign custom omitted.
- Runtime command merge by lowercased name/alias; MAFW wins; merge runtime `agent/model/subtask` and `runtime:true`.
- Sort commands by `name.toLowerCase()`.
- Skills dedupe by `id`; sort scope order `user` < `project` < `path`, then name.
- `stableJson`: recursively sort object keys; `crypto.createHash('sha256')`.
- `computeRevision` returns 64-hex strings.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/core/discovery/merge.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/discovery/types.ts gateway/src/core/discovery/merge.ts gateway/tests/unit/core/discovery/merge.test.ts
git commit -m "feat(discovery): merge commands, skills and revisions"
```

---

### Task 5: AGENTS.md 来源发现

**Files:**
- Create: `gateway/src/core/discovery/agents-files.ts`
- Test: `gateway/tests/unit/core/discovery/agents-files.test.ts`（新建）

**Interfaces:**
- Produces: `AgentsDiscoveryFs` / `discoverAgentsFiles(directory: string, opts: { homeDir: string; globalConfigDir: string; fs?: AgentsDiscoveryFs }): { instructions: DiscoveryInstruction[]; warnings: DiscoveryWarning[] }`
- Consumes: Task 4 的 `DiscoveryInstruction` / `DiscoveryWarning`

- [ ] **Step 1: Write failing AGENTS discovery tests**

Use `fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-agents-'))` and real files. Cover:

```ts
it('inside home: global, nearest-first to home, even past .git', () => {
  // home/global AGENTS.md, home/code/proj/.git dir, home/code/proj/AGENTS.md,
  // home/code/proj/pkg/AGENTS.md, home/AGENTS.md
  // directory = home/code/proj/pkg
  expect(result.instructions.map((i) => i.path)).toEqual([
    global, pkg, proj, path.join(home, 'AGENTS.md'),
  ]);
  expect(result.instructions.find((i) => i.path === proj)?.scope).toBe('project');
});

it('outside home: stops at .git file (worktree) and does not read ancestors above it', () => {
  // work/proj/.git is a FILE, work/proj/AGENTS.md, work/proj/pkg/AGENTS.md, work/AGENTS.md
  expect(paths).toEqual([global, pkg, proj]);
});

it('outside home without .git: only the directory', () => {
  expect(paths).toEqual([global, dir]);
});

it('skips missing files, dedupes realpaths, and never returns content', () => {
  const all = result.instructions;
  expect(all.every((i) => !('content' in i))).toBe(true);
  expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
});
```

Use a fake `fs` for the stat-failure case: `statSync` throws for one path; assert warning and other files survive.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/core/discovery/agents-files.test.ts --runInBand`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement discovery**

Implement per spec §4.4:

- `homeDir`/`globalConfigDir` normalized.
- Determine `insideHome = isUnder(dir, home)`.
- Walk ancestors:
  - inside home: until home inclusive.
  - outside: until directory with `.git` (file or dir) inclusive; if none, only start dir.
- Push global first (if exists), then ancestors nearest→top.
- Scope: global; project = `.git` root or topmost visited when no `.git`; nested otherwise.
- `id = sha1(realpath).slice(0,12)`.
- `bytes = stat.size`, `mtime = stat.mtime.toISOString()`.
- `fs` defaults to Node fs; allow injection.
- No content field.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/core/discovery/agents-files.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/discovery/agents-files.ts gateway/tests/unit/core/discovery/agents-files.test.ts
git commit -m "feat(discovery): discover AGENTS.md sources without contents"
```

---

### Task 6: DiscoveryService（缓存、降级、技能加载、广播）

**Files:**
- Create: `gateway/src/core/discovery/discovery-service.ts`
- Test: `gateway/tests/unit/core/discovery/discovery-service.test.ts`（新建）

**Interfaces:**
- Consumes: Task 4 `mergeCommands` / `mergeSkills` / `computeRevision`
- Consumes: Task 5 `discoverAgentsFiles`
- Consumes: Task 1 `RuntimeDiscoveryChannel`
- Produces: `class DiscoveryError extends Error { status: number }`
- Produces: `class DiscoveryService`
- Produces: `interface DiscoveryServiceDeps { getRuntime; getMafwCommands; resolveDirectory; broadcast; gatewayProjectDir; mafwDir; homeDir; globalConfigDir; now?: () => number; ttlMs?: number; degradedTtlMs?: number; discoverAgents?: typeof discoverAgentsFiles }`
- Produces: `new DiscoveryService(deps: DiscoveryServiceDeps)`
- Produces: `get(sessionID, opts?: { directory?: string; force?: boolean }): Promise<DiscoverySnapshot>`
- Produces: `refresh(sessionID, opts?: { directory?: string }): Promise<DiscoverySnapshot>`
- Produces: `loadSkill(sessionID, key, opts?: { directory?: string; force?: boolean }): Promise<DiscoverySkillContent>`
- Produces: `getLegacyCommands(directory?: string, opts?: { force?: boolean }): Promise<{ commands: LegacyCommandInfo[]; location: { directory: string }; warnings: DiscoveryWarning[] }>`
- Produces: `getLegacySkills(directory?: string, opts?: { force?: boolean }): Promise<{ skills: DiscoverySkill[]; location: { directory: string }; warnings: DiscoveryWarning[] }>`
- Produces: `invalidate(): void`
- Produces: `forget(sessionID: string): void`
- Produces: `broadcastKnown(reason: 'commands_changed' | 'runtime_switched'): Promise<void>`

- [ ] **Step 1: Write failing service tests**

Create a fake runtime and deps:

```ts
function fakeRuntime(over: any = {}) {
  return {
    capabilities: { discoveryApi: true },
    discovery: {
      list: jest.fn(async () => ({ commands: [{ name: 'init', description: 'i' }], skills: [], warnings: [] })),
      loadSkill: jest.fn(async () => null),
    },
    session: { get: jest.fn(async () => ({ directory: '/proj' })) },
    ...over,
  };
}
```

Cover:

```ts
it('merges MAFW + runtime, caches by directory, force bypasses', async () => {
  const rt = fakeRuntime();
  const svc = new DiscoveryService(deps({ runtime: rt, resolveDirectory: async () => '/proj' }));
  const a = await svc.get('s1');
  const b = await svc.get('s2');
  expect(a.revision).toBe(b.revision);
  expect(rt.discovery.list).toHaveBeenCalledTimes(1);
  await svc.get('s1', { force: true });
  expect(rt.discovery.list).toHaveBeenCalledTimes(2);
});

it('partial runtime failure keeps successful side', async () => {
  const rt = fakeRuntime();
  rt.discovery.list.mockResolvedValueOnce({
    commands: [{ name: 'init' }], skills: [],
    warnings: [{ source: 'skills', message: 'down' }],
  });
  const snap = await new DiscoveryService(deps({ runtime: rt })).get('s1');
  expect(snap.degraded).toBe(true);
  expect(snap.degradedReason).toBe('partial');
  expect(snap.warnings.some((w) => w.source === 'skills')).toBe(true);
});

it('pi capability absence is degraded but cached 30s (no 5s rescan)', async () => {
  const rt = fakeRuntime({ capabilities: { discoveryApi: false }, discovery: undefined });
  let now = 0;
  const discoverAgents = jest.fn(() => ({ instructions: [], warnings: [] }));
  const svc = new DiscoveryService(deps({ runtime: rt, now: () => now, discoverAgents }));
  const a = await svc.get('s1');
  expect(a.degradedReason).toBe('capability_absent');
  now = 10_000;
  await svc.get('s1');
  expect(discoverAgents).toHaveBeenCalledTimes(1);
  now = 31_000;
  await svc.get('s1');
  expect(discoverAgents).toHaveBeenCalledTimes(2);
});

it('loadSkill: 404 / 409 / 413 / 503', async () => {
  // list returns one skill id='a', name='A'; loadSkill returns {..., content:'x'}
  // unknown -> 404; duplicate name -> 409; huge content -> 413; no runtime -> 503
});

it('legacy commands are runtime-only and exclude MAFW names/aliases', async () => {
  // MAFW has goal; runtime returns goal + init; getLegacyCommands -> [init]
});

it('broadcastKnown emits session.commands with commands only', async () => {
  // get s1, then broadcastKnown('commands_changed')
  // expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
  //   type: 'session.commands', sessionID: 's1',
  //   properties: expect.objectContaining({ reason: 'commands_changed', commands: expect.any(Array) }),
  // }))
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/core/discovery/discovery-service.test.ts --runInBand`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement service**

Implement per spec §4.9:

- `resolveDirectory` validates absolute + directory; if omitted, `deps.resolveDirectory(sessionID)`.
- Base snapshot cache `Map<directory, { base: BaseSnapshot; expiresAt: number }>`; `inflight` map; `knownSessions` map.
- `buildBase(directory)`:
  - `mafw = deps.getMafwCommands()` (catch → warning).
  - runtime = `rt.capabilities.discoveryApi && rt.discovery ? rt.discovery.list({directory})` catch → warning; if absent → capability warning.
  - `agents = discoverAgentsFiles(directory, { homeDir, globalConfigDir })` catch → warning.
  - merge; compute revisions; `degraded`/reason; `generatedAt`.
- TTL as spec; `force` bypass; `invalidate()` clears cache; `forget()` deletes known.
- `get` returns `{...base, sessionID}` and records known.
- `refresh` force + `broadcastSnapshot(sessionID, 'manual_refresh')`.
- `loadSkill`: find metadata; 404/409; if no runtime support 503; call `loadSkill`; 404; content byte length > 512*1024 → 413; return.
- `getLegacyCommands`: base.commands filter `source === 'runtime'`; map `{name, description, source:'command'}` (include optional agent/model/subtask); location/warnings.
- `getLegacySkills`: map base.skills.
- `broadcastKnown`: for each known session, `get` (cache) and broadcast; catch per session.
- `broadcastSnapshot`: `deps.broadcast({ type: 'session.commands', sessionID, properties: { sessionID, directory, revision: commandsRevision, generatedAt, reason, commands, degraded, warnings } })`.
- Import `MAFW`? Use literal `'session.commands'` to avoid core→runtime dependency; test pins. Or `import { MAFW } from '../../runtime/mafw-vocabulary'`; either. Use literal in service and vocabulary tests elsewhere. Plan says literal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway && npx jest tests/unit/core/discovery/discovery-service.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/discovery/discovery-service.ts gateway/tests/unit/core/discovery/discovery-service.test.ts
git commit -m "feat(discovery): add cached discovery service with degraded modes"
```

---

### Task 7: HTTP 路由、legacy 端点与 gateway 接线

**Files:**
- Create: `gateway/src/routes/session-discovery.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/wave1-handlers.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/tests/unit/api-contract.test.ts`
- Test: `gateway/tests/unit/routes/session-discovery.test.ts`（新建）
- Test: `gateway/tests/unit/wave1-handlers.test.ts`
- Generated: `packages/gateway-sdk/contract/openapi.json`（`npm run emit:openapi`）

**Interfaces:**
- Consumes: Task 6 `DiscoveryService` / `DiscoveryError`
- Produces: `handleSessionDiscovery`, `handleSessionDiscoveryRefresh`, `handleSessionDiscoverySkill`, `handleLegacyCommand`, `handleLegacySkill`
- Produces: route catalog ops `session.discovery`, `session.discoveryRefresh`, `session.discoverySkill`

- [ ] **Step 1: Write failing route tests**

Create `session-discovery.test.ts` with a fake service:

```ts
const fake = {
  get: jest.fn(async () => snapshot),
  refresh: jest.fn(async () => snapshot),
  loadSkill: jest.fn(async () => ({ ...skill, content: '# x' })),
  getLegacyCommands: jest.fn(async () => ({ commands: [{ name: 'init', source: 'command' }], location: { directory: '/proj' }, warnings: [] })),
  getLegacySkills: jest.fn(async () => ({ skills: [skill], location: { directory: '/proj' }, warnings: [] })),
};
```

Cover:

- GET discovery calls `get('s1', { directory: undefined, force: true })` for `?force=1`; 200 JSON.
- POST refresh calls `refresh('s1', ...)`.
- skill route passes decoded `key`; maps `DiscoveryError(404/409/413/503)` to status.
- null service → 503.
- legacy `/command` returns `application/json` and `{commands}`; delegates `directory`.
- legacy `/skill` returns `{skills}`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/routes/session-discovery.test.ts --runInBand`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement route module**

Create `session-discovery.ts`:

```ts
export interface SessionDiscoveryDeps { discovery: DiscoveryService | null }
function json(...) {...}
function query(req): { directory?: string; force: boolean } {...}
export async function handleSessionDiscovery(req, res, params, deps): Promise<boolean> {}
export async function handleSessionDiscoveryRefresh(req, res, params, deps): Promise<boolean> {}
export async function handleSessionDiscoverySkill(req, res, params, deps): Promise<boolean> {}
export async function handleLegacyCommand(req, res, deps): Promise<boolean> {}
export async function handleLegacySkill(req, res, deps): Promise<boolean> {}
```

Rules:
- If service null → 503.
- Only handle the expected method/path; return false otherwise.
- Each handler must contain a literal regex/prefix matcher for its path (e.g. `/^\/api\/sessions\/([^/]+)\/discovery(?:\?|$)/`) so `api-contract.test.ts` 的 phantom 扫描能看见它（registry 的 params 不参与该扫描）。
- `directory` query raw; missing = undefined; service validates.
- `force = q.get('force') === '1'`.
- Catch `DiscoveryError` -> status; other -> 500.
- Legacy handlers read `req.url` query for `directory`; if missing, service uses `gatewayProjectDir`.
- `handleLegacyCommand` returns `{commands, location, warnings}`; `handleLegacySkill` `{skills, location, warnings}`.

- [ ] **Step 4: Add catalog + wave1 attach + index**

In `route-catalog.ts` add:

```ts
{ method: 'GET', path: '/api/sessions/:id/discovery', operationId: 'session.discovery', tags: ['session'] },
{ method: 'POST', path: '/api/sessions/:id/discovery/refresh', operationId: 'session.discoveryRefresh', tags: ['session'] },
{ method: 'GET', path: '/api/sessions/:id/discovery/skills/:key', operationId: 'session.discoverySkill', tags: ['session'] },
```

In `wave1-handlers.ts`:
- import the five handlers and `DiscoveryService`.
- add `discovery?: DiscoveryService | null` to `Wave1Gateway`.
- attach:
```ts
for (const op of ['session.discovery', 'session.discoveryRefresh', 'session.discoverySkill'] as const) {
  registry.attachHandler(op, H(async (req, res, params) => {
    if (op === 'session.discovery') return handleSessionDiscovery(req, res, params, { discovery: gw.discovery ?? null });
    if (op === 'session.discoveryRefresh') return handleSessionDiscoveryRefresh(req, res, params, { discovery: gw.discovery ?? null });
    return handleSessionDiscoverySkill(req, res, params, { discovery: gw.discovery ?? null });
  }));
}
registry.attachHandler('command.list', H(async (req, res) => handleLegacyCommand(req, res, { discovery: gw.discovery ?? null })));
registry.attachHandler('skill.list', H(async (req, res) => handleLegacySkill(req, res, { discovery: gw.discovery ?? null })));
```

In `index.ts`:
- import `DiscoveryService`.
- add `private discovery?: DiscoveryService;`
- add `private getDiscoveryService(): DiscoveryService` with deps:
```ts
new DiscoveryService({
  getRuntime: () => this.runtime,
  getMafwCommands: () => this.getMafwCommandRegistry().list(),
  resolveDirectory: async (sessionID, provided) => {
    if (provided) return provided;
    const rt = this.runtime;
    if (!rt) return null;
    const info = await rt.session.get({ sessionID }).catch(() => null);
    return (info as any)?.directory ?? (info as any)?.location?.directory ?? null;
  },
  broadcast: (e) => this.broadcast(e as any),
  gatewayProjectDir: this.projectDir,
  mafwDir: this.mafwDir,
  homeDir: os.homedir(),
  globalConfigDir: path.join(os.homedir(), '.config', 'opencode'),
})
```
- at `attachWave1Handlers` object add `get discovery() { return gwSelf.getDiscoveryService(); }`.
- remove `/command` and `/skill` from `REVERSE_PROXY_PATHS` in `api-contract.test.ts`.
- update `WAVE1_OPIDS` + match cases in `wave1-handlers.test.ts` for five new ops.

- [ ] **Step 5: Run route/wave1 tests + emit contract**

Run:
```bash
cd gateway && npx jest tests/unit/routes/session-discovery.test.ts tests/unit/wave1-handlers.test.ts --runInBand
cd gateway && npm run emit:openapi
cd gateway && npx jest tests/unit/api-contract.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/routes/session-discovery.ts gateway/src/routes/route-catalog.ts gateway/src/routes/wave1-handlers.ts gateway/src/index.ts gateway/tests/unit/api-contract.test.ts gateway/tests/unit/routes/session-discovery.test.ts gateway/tests/unit/wave1-handlers.test.ts packages/gateway-sdk/contract/openapi.json
git commit -m "feat(discovery): expose discovery and legacy command endpoints"
```

---

### Task 8: `session.commands` 词汇与广播触发

**Files:**
- Modify: `packages/gateway-sdk/src/events.ts`
- Modify: `gateway/src/runtime/mafw-vocabulary.ts`
- Modify: `gateway/src/runtime/event-flow-matrix.ts`
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/runtime/event-flow-matrix.test.ts`（自动）
- Test: `gateway/tests/unit/runtime/vocabulary-sync.test.ts`（自动）
- Test: `gateway/tests/unit/core/discovery/discovery-wiring.test.ts`（新建，source contract）

**Interfaces:**
- Produces: canonical event `session.commands`
- Consumes: Task 6 `DiscoveryService.broadcastKnown` / `forget`

- [ ] **Step 1: Write failing wiring test**

Create `discovery-wiring.test.ts` reading `gateway/src/index.ts`:

```ts
const src = readFileSync(join(__dirname, '../../../../src/index.ts'), 'utf8');
expect(src).toContain("broadcastKnown('commands_changed')");
expect(src).toContain("broadcastKnown('runtime_switched')");
expect(src).toContain('discovery?.forget(sessionID)');
```

Run it; expected FAIL.

- [ ] **Step 2: Add event vocabulary**

- `packages/gateway-sdk/src/events.ts`: add `"session.commands"` to `RUNTIME_EVENT_TYPES` after `run.updated`.
- `gateway/src/runtime/mafw-vocabulary.ts`: add `sessionCommands: 'session.commands'` in the 能力面 block.
- `gateway/src/runtime/event-flow-matrix.ts`: add row:
```ts
'session.commands': R([], 'passthrough', 'ignore', 'ignore', 'T2-5 命令发现快照；skills/AGENTS pull-only；desktop UI 采用后续'),
```
- `packages/desktop/src/renderer/mafw/session-events.ts`: add `"session.commands"` to `IGNORED_AT_SHELL` **and** add `case "session.commands": return` in `assertShellEventCoverage`（编译期穷尽检查；只改数组不够）。
- TUI no change (KNOWN_EVENTS is a subset; matrix says ignore).

- [ ] **Step 3: Wire broadcast triggers**

In `index.ts`:
- DELETE session route: after `this.instructionSync?.forget(sessionID);` add `this.discovery?.forget(sessionID);`.
- `getMafwCommandRegistry()` initial scan `.then`: after `registerCustomCommands`, call `this.discovery?.invalidate(); void this.discovery?.broadcastKnown('commands_changed').catch(...)`.
- `watchCommandDirs` callback after `broadcast({type:'mafw_commands_changed'})`: same invalidate/broadcast.
- `onSwitched` after `this.broadcast({type:'runtime_switched', ...})`: `this.discovery?.invalidate(); void this.discovery?.broadcastKnown('runtime_switched').catch(...)`.
- Ensure optional chaining and catch (fail-open).

- [ ] **Step 4: Run event/wiring tests**

Run:
```bash
cd gateway && npx jest tests/unit/runtime/event-flow-matrix.test.ts tests/unit/runtime/vocabulary-sync.test.ts tests/unit/core/discovery/discovery-wiring.test.ts --runInBand
cd packages/desktop && bun test src/renderer/mafw/session-events.test.ts
```

Expected: PASS. If desktop typecheck fails, add the explicit ignore case; do not add UI consumption.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/events.ts gateway/src/runtime/mafw-vocabulary.ts gateway/src/runtime/event-flow-matrix.ts packages/desktop/src/renderer/mafw/session-events.ts gateway/src/index.ts gateway/tests/unit/core/discovery/discovery-wiring.test.ts
git commit -m "feat(discovery): broadcast session.commands on catalog changes"
```

---

### Task 9: SDK discovery 命名空间与 OpenAPI

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/api-schema.gen.ts`（生成）
- Test: `packages/gateway-sdk/src/client.test.ts`

**Interfaces:**
- Consumes: Task 7 route catalog; Task 8 event union
- Produces: `DiscoveryNamespace`, `DiscoverySnapshot`, `DiscoveryCommand`, `DiscoverySkill`, `DiscoveryInstruction`, `DiscoveryWarning`, `DiscoverySkillContent`
- Produces: `MafwClient.discovery`
- Produces: `CommandInfo.model` union; `SkillInfo` additive fields

- [ ] **Step 1: Write failing SDK tests**

In `client.test.ts` add:

```ts
test('discovery.get passes session/directory/force and returns snapshot', async () => {
  fetchMock.mockResolvedValue(okJson({ sessionID: 's1', directory: '/p', revision: 'r', commands: [], skills: [], instructions: [] }));
  const out = await c.discovery.get('s1', { directory: '/p', force: true });
  expect(fetchMock).toHaveBeenCalledWith(
    'http://gw:3000/api/sessions/s1/discovery?directory=%2Fp&force=1',
    expect.anything(),
  );
  expect(out.revision).toBe('r');
});

test('discovery.refresh POSTs and discovery.skill encodes key', async () => {
  // assert /discovery/refresh POST; /discovery/skills/mafw-plan GET
});

test('command.list/skill.list hit legacy endpoints and parse envelopes', async () => {
  // /command -> {commands:[{name:'init'}]} => [{name:'init'}]
  // /skill -> {skills:[{id:'a',name:'A'}]} => [...]
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/gateway-sdk && bun test src/client.test.ts`

Expected: FAIL — `c.discovery` undefined / types missing.

- [ ] **Step 3: Implement SDK**

In `types.ts` add the discovery interfaces and namespace; add `discovery: DiscoveryNamespace` to `MafwClient`. Change:

```ts
export interface CommandInfo {
  // ...
  model?: string | { id: string; providerID: string; variant?: string }
}
export interface SkillInfo {
  id?: string
  name: string
  description?: string
  slash?: boolean
  location?: string
  path?: string
  contentLength?: number
  content?: string
}
```

In `client.ts` add `discovery` after `skill`:

```ts
discovery = {
  get: async (sessionID: string, params?: { directory?: string; force?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.directory) qs.set('directory', params.directory)
    if (params?.force) qs.set('force', '1')
    const q = qs.toString()
    return this.request<DiscoverySnapshot>(`/api/sessions/${encodeURIComponent(sessionID)}/discovery${q ? `?${q}` : ''}`)
  },
  refresh: async (sessionID: string, params?: { directory?: string }) => {
    const qs = params?.directory ? `?directory=${encodeURIComponent(params.directory)}` : ''
    return this.request<DiscoverySnapshot>(`/api/sessions/${encodeURIComponent(sessionID)}/discovery/refresh${qs}`, { method: 'POST' })
  },
  skill: async (sessionID: string, key: string, params?: { directory?: string; force?: boolean }) => {
    const qs = new URLSearchParams()
    if (params?.directory) qs.set('directory', params.directory)
    if (params?.force) qs.set('force', '1')
    const q = qs.toString()
    return this.request<DiscoverySkillContent>(`/api/sessions/${encodeURIComponent(sessionID)}/discovery/skills/${encodeURIComponent(key)}${q ? `?${q}` : ''}`)
  },
}
```

Run `cd packages/gateway-sdk && npm run gen:api` after Task 7's contract is current.

- [ ] **Step 4: Run SDK tests + contract**

Run:
```bash
cd packages/gateway-sdk && bun test src/client.test.ts src/contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/api-schema.gen.ts packages/gateway-sdk/src/client.test.ts
git commit -m "feat(sdk): add discovery namespace and types"
```

---

### Task 10: 冒烟、全量门禁与交付记录

**Files:**
- Create: `gateway/scripts/smoke-discovery.mjs`
- Modify: `docs/superpowers/specs/2026-10-27-t2-capability-discovery-design.md`
- Modify: `AGENTS.md`
- Modify: version files via `scripts/bump-version.mjs`
- Test: live gateway + opencode serve

- [ ] **Step 1: Write smoke script**

Create `smoke-discovery.mjs` using `fetch` against `http://localhost:3000`:

1. `POST /api/session` `{directory: process.cwd()}` → sessionID.
2. `GET /api/sessions/:id/discovery` → 200; assert commands contains `goal` + `init`; skills contains `mafw-plan` + `opencode`; instructions contains `AGENTS.md`; revision 64 hex; `degraded=false`.
3. Second GET same revision.
4. `GET .../discovery/skills/mafw-plan` → 200, content includes `mafw-plan`; unknown 404.
5. `GET /command` and `/skill` → 200 `application/json`; commands >=1, skills >=1; `/command` does not contain `goal`.
6. Query `/skill?directory=C:\work\work-loop` and assert `location.directory` ends with `work-loop` (different from current repo) — if the directory exists; skip with PASS note if absent.
7. SSE subscribe `/api/events`; `POST .../discovery/refresh`; wait for `session.commands` with matching sessionID, `reason='manual_refresh'`, commands non-empty; abort stream.
8. DELETE session.
9. Print `PASS n/n`; exit 1 on failure.

- [ ] **Step 2: Run smoke**

```bash
cd gateway && npm run build
# copy gateway/dist to global install if testing deployed gateway (existing procedure)
mafw stop; mafw daemon
node gateway/scripts/smoke-discovery.mjs
```

Expected: `PASS 9/9` (or equivalent count).

- [ ] **Step 3: Full gates**

Run:
```bash
cd gateway && npx jest --runInBand --forceExit
cd .. && npx jest --runInBand --forceExit            # root plugin
cd packages/gateway-sdk && bun test
cd packages/desktop && bun test src/renderer/mafw/session-events.test.ts
cd ../.. && npm run build
cd gateway && npx tsc --noEmit
```

Expected: gateway all pass; root 29; SDK all pass; desktop targeted pass; build/typecheck rc=0. If parallel desktop worktree is dirty, do not run full desktop; record targeted gate.

- [ ] **Step 4: Version + delivery docs**

- `node scripts/bump-version.mjs 4.41.0`
- Update spec §9: version, commits, test counts, smoke, review, boundaries.
- Update `AGENTS.md` §5.5 with T2-5 entry (endpoints, event, capability, tests, version, commits).
- Commit:
```bash
git add gateway/scripts/smoke-discovery.mjs docs/superpowers/specs/2026-10-27-t2-capability-discovery-design.md AGENTS.md package.json packages/*/package.json
git commit -m "docs: T2-5 v4.41.0 delivery record"
```

- [ ] **Step 5: Deploy + live verification**

- Copy `gateway/dist` to the global gateway install; restart gateway.
- Re-run smoke on the deployed build.
- Do not `restart-agent`; this batch changes gateway/SDK, not the plugin runtime instance. If SDK/preload changes are needed by desktop, note that desktop reload is separate.

---

### Task 11: 独立 review（gateway/glm-5.3）

**Files:** none (review only; fixes may touch Task 1-10 files)

- [ ] **Step 1: Dispatch review**

Use `subagent` with `model: "gateway/glm-5.3"` and prompt:

```
Review the T2-5 capability discovery implementation against spec docs/superpowers/specs/2026-10-27-t2-capability-discovery-design.md.
Inspect git diff from <base>..HEAD and the changed files. Run targeted tests if needed.
Report: Critical (must fix), Important (should fix), Minor (optional). For each: file:line, why it matters, suggested fix.
Do not modify files.
```

- [ ] **Step 2: Fix findings**

- Critical/Important: fix with tests; rerun affected tests + full gateway/SDK gates.
- Minor: fix if cheap; otherwise record in spec §9 with rationale.
- Commit review fixes separately (`fix(discovery): review pass ...`).

- [ ] **Step 3: Final verification**

Run full gateway + SDK + targeted desktop + build/typecheck again; rerun smoke; record final commit hash and counts in spec/AGENTS.
