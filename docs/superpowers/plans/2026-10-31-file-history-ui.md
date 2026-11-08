# 文件历史 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面工作台编辑器里提供文件历史列表、只读差异预览与可反悔恢复，覆盖非 git / 二进制 / Office 文件。

**Architecture:** 复用 gateway 现有 `FileHistoryService` 与 `pre-restore` 快照；新增只读内容端点（text/binary/large 分类），桌面用 `diff` 包在渲染层生成 unified patch，复用 `DiffReviewPanel` 的 `embedded + previewOnly` 做预览；`EditorDock` 新增 `mode="history"`，左版本列表 + 右差异。

**Tech Stack:** TypeScript / Node HTTP（gateway）、SolidJS（desktop renderer）、CodeMirror（既有编辑器）、`diff@8.0.2`、jest（gateway/root）、`node --test` + `@mafw/test-shim`（desktop）、bun test（SDK）。

**Spec:** `docs/superpowers/specs/2026-10-31-file-history-ui-design.md`
**Research:** `docs/research/2026-10-31-file-history-ui-research.md`

## Global Constraints

- gateway 路由必须 loopback-only；内容端点只读 blob，禁止按客户端路径直接读工作区。
- 自动快照仍由插件 `tool.execute.before` 触发；本计划不新增写路径。
- 桌面 renderer 只调 `window.api`；main IPC 不改（沿用 `mafw-invoke` 透传 SDK）。
- 桌面禁止新增裸 `<button>` / `<input>` / `title`；一律 `ButtonV2` / `TooltipV2` 等 `@mafw/ui/v2/*`。
- 差异预览上限 1 MiB（与 gateway `kind=large` 判定一致）；超过不看 diff，只允许恢复。
- 保留上限：50 条/文件、500 条/会话、单文件 50 MB。
- TDD：每个 Task 先写失败测试；提交按 Task 粒度。
- 测试命令：gateway `npx jest ... --runInBand`；desktop `npm test -w @mafw/desktop`；SDK `npm test -w @mafw/gateway-sdk`；desktop 类型 `npx tsgo --noEmit -p tsconfig.json`；构建 `npx electron-vite build`。

## Review Focus

- **≥1 MiB 文件**：内容端点必须返回 `kind: "large"` 且不下发 `content`；面板显示元数据、绝不尝试 diff。
- **二进制（NUL / 非法 UTF-8）**：必须返回 `kind: "binary"`，不得把乱码当文本预览；恢复仍可用。
- **跨会话 / 伪造 entryId**：必须 404，不得读到其他 session 的 blob。
- **dirty 编辑器 + 恢复**：恢复按钮必须禁用并说明原因，不得覆盖未保存草稿。
- **当前文件已删除**：历史仍可列、可恢复；面板不得因读不到当前内容而崩溃或误判“无历史”。

---

### Task 1: Gateway 内容读取 + 保留上限

**Files:**
- Modify: `gateway/src/core/file-history/file-history-service.ts`
- Test: `gateway/tests/unit/file-history/file-history-service.test.ts`

**Interfaces:**
- Consumes: 现有 `FileHistoryService` 的 index/blob 布局（`<root>/<session>/index.json` + `blobs/<sha256>`）。
- Produces:
  ```ts
  export type FileHistoryContentResult =
    | { ok: true; entry: FileHistoryEntry; kind: 'text' | 'binary' | 'large'; content?: string; size: number }
    | { ok: false; reason: 'not-found' | 'blob-missing' | 'io' };

  readContent(sessionID: string, entryId: string, opts?: { maxTextBytes?: number }): Promise<FileHistoryContentResult>
  ```
  默认 `maxTextBytes = 1_048_576`；`DEFAULT_MAX_PER_FILE = 50`。

- [ ] **Step 1: 写失败测试**

在 `file-history-service.test.ts` 增加：

```ts
it('readContent：文本返回 utf8；二进制返回 binary；超限返回 large', async () => {
  const text = join(project, 'a.txt');
  writeFileSync(text, 'hello 世界');
  const t = await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['a.txt'] });
  const textId = t.entries[0].id;

  const readText = await svc.readContent('ses_1', textId);
  expect(readText).toMatchObject({ ok: true, kind: 'text', content: 'hello 世界' });

  const bin = join(project, 'b.bin');
  writeFileSync(bin, Buffer.from([0x00, 0x01, 0xff]));
  const b = await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['b.bin'] });
  const readBin = await svc.readContent('ses_1', b.entries[0].id);
  expect(readBin).toMatchObject({ ok: true, kind: 'binary', size: 3 });
  expect((readBin as any).content).toBeUndefined();

  const large = join(project, 'big.txt');
  writeFileSync(large, 'x'.repeat(32));
  const l = await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['big.txt'] });
  const readLarge = await svc.readContent('ses_1', l.entries[0].id, { maxTextBytes: 16 });
  expect(readLarge).toMatchObject({ ok: true, kind: 'large', size: 32 });
});

it('readContent：不存在的 entry / 其他会话的 entry → not-found', async () => {
  expect(await svc.readContent('ses_1', 'fh_missing')).toEqual({ ok: false, reason: 'not-found' });
  const f = join(project, 'c.txt');
  writeFileSync(f, 'x');
  const s = await svc.snapshot({ sessionID: 'ses_2', projectDir: project, relPaths: ['c.txt'] });
  expect(await svc.readContent('ses_1', s.entries[0].id)).toEqual({ ok: false, reason: 'not-found' });
});

it('默认每文件保留 50 条', async () => {
  const f = join(project, 'many.txt');
  for (let i = 0; i < 55; i++) {
    writeFileSync(f, `v${i}`);
    await svc.snapshot({ sessionID: 'ses_3', projectDir: project, relPaths: ['many.txt'] });
  }
  expect((await svc.list('ses_3', 'many.txt')).length).toBe(50);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/file-history/file-history-service.test.ts --runInBand`
Expected: FAIL（`readContent is not a function`；50 条断言先失败为 20）

- [ ] **Step 3: 实现**

- `DEFAULT_MAX_PER_FILE` 改 50。
- `readContent`：`readIndex` → 按 id 找 entry（index 已按 session 隔离，跨 session 自然 not-found）→ `fs.stat(blob)`（缺失 `blob-missing`）→ 超过 `maxTextBytes` 直接 `{ok:true, kind:'large', size}` → 读 Buffer → `buf.includes(0)` → binary；否则 `new TextDecoder('utf-8', { fatal: true }).decode(buf)`，抛错 → binary；成功 → `{ok:true, kind:'text', content, size}`。
- 其它 IO 异常返回 `{ok:false, reason:'io'}`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tests/unit/file-history --runInBand`
Expected: PASS（service + route 两套件）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/core/file-history/file-history-service.ts gateway/tests/unit/file-history/file-history-service.test.ts
git commit -m "feat(file-history): read text/binary/large content and keep 50 versions per file"
```

---

### Task 2: Gateway content 路由 + 契约登记

**Files:**
- Modify: `gateway/src/routes/file-history.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Test: `gateway/tests/unit/file-history/file-history-route.test.ts`
- Generated: `packages/gateway-sdk/contract/openapi.json`、`gateway-paths.json`、`packages/gateway-sdk/src/api-schema.gen.ts`、`packages/gateway-sdk/src/api-path.ts`

**Interfaces:**
- Consumes: Task 1 `readContent`。
- Produces: `GET /api/file-history/content?sessionID=&entryId=` → 200 `{ entry, kind, content?, size }`。

- [ ] **Step 1: 写失败测试**

```ts
it('GET /api/file-history/content：text 返回内容；缺参 400；未知 entry 404', async () => {
  const file = join(project, 'note.txt');
  writeFileSync(file, 'v1');
  const snap: any = await (await fetch(`${base}/api/file-history/snapshot`, {
    method: 'POST',
    body: JSON.stringify({ sessionID: 'ses_1', directory: project, paths: ['note.txt'] }),
  })).json();
  const entryId = snap.entries[0].id;

  const ok = await fetch(`${base}/api/file-history/content?sessionID=ses_1&entryId=${entryId}`);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ kind: 'text', content: 'v1' });

  expect((await fetch(`${base}/api/file-history/content?sessionID=ses_1`)).status).toBe(400);
  expect((await fetch(`${base}/api/file-history/content?sessionID=ses_1&entryId=fh_none`)).status).toBe(404);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tests/unit/file-history/file-history-route.test.ts --runInBand`
Expected: FAIL（路由未命中返回 404/`{}`）

- [ ] **Step 3: 实现路由**

在 `handleFileHistoryRoutes` 增加 `isContent = /^\/api\/file-history\/content(?:\?|$)/.test(url) && req.method === 'GET'`；
解析 `sessionID`/`entryId`，缺参 400；调用 `service.readContent`；
`ok:false` 且 `not-found|blob-missing` → 404 `{error: reason}`；`io` → 500；成功直接返回结果对象。

在 `route-catalog.ts` 现有 file-history 三行后追加：

```ts
{ method: 'GET', path: '/api/file-history/content', operationId: 'fileHistory.content', tags: ['internal'] },
```

- [ ] **Step 4: 生成契约并验证**

Run:
```bash
cd gateway && npm run emit:openapi
cd .. && git diff --stat packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts packages/gateway-sdk/src/api-path.ts
```
Expected: 生成文件包含 `fileHistory.content`；无手改。

- [ ] **Step 5: 跑测试**

Run: `npx jest tests/unit/file-history --runInBand`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add gateway/src/routes/file-history.ts gateway/src/routes/route-catalog.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts packages/gateway-sdk/src/api-path.ts
git commit -m "feat(file-history): expose content endpoint and register contract"
```

---

### Task 3: SDK client + 类型

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/index.ts`（如类型未自动导出）
- Test: `packages/gateway-sdk/src/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FileHistoryEntry = {
    id: string; sessionID: string; projectDir: string; rel: string; blob: string;
    size: number; mtimeMs: number; createdAt: string; seq: number; reason: string;
  };
  export type FileHistoryContent = {
    entry: FileHistoryEntry;
    kind: 'text' | 'binary' | 'large';
    content?: string;
    size: number;
  };
  fileHistory: {
    list(params: { query: { sessionID: string; rel?: string } }): Promise<{ entries: FileHistoryEntry[] }>;
    content(params: { query: { sessionID: string; entryId: string } }): Promise<FileHistoryContent>;
    restore(params: { body: { sessionID: string; entryId: string } }): Promise<{ ok: true; rel: string }>;
  }
  ```

- [ ] **Step 1: 写失败测试**

在 `client.test.ts` 增加：

```ts
test("fileHistory.list sends sessionID and rel", async () => {
  fetchMock.mockResolvedValue(okJson({ entries: [{ id: "fh_1" }] }))
  const c = new MafwClient("http://gw:3000")
  const res = await c.fileHistory.list({ query: { sessionID: "s1", rel: "a.txt" } })
  expect(fetchMock).toHaveBeenCalledWith(
    "http://gw:3000/api/file-history?sessionID=s1&rel=a.txt",
    expect.anything(),
  )
  expect(res.entries).toHaveLength(1)
})

test("fileHistory.content sends GET /api/file-history/content", async () => {
  fetchMock.mockResolvedValue(okJson({ kind: "text", content: "v1", size: 2 }))
  const c = new MafwClient("http://gw:3000")
  const res = await c.fileHistory.content({ query: { sessionID: "s1", entryId: "fh_1" } })
  expect(fetchMock).toHaveBeenCalledWith(
    "http://gw:3000/api/file-history/content?sessionID=s1&entryId=fh_1",
    expect.anything(),
  )
  expect(res.kind).toBe("text")
})

test("fileHistory.restore posts entryId", async () => {
  fetchMock.mockResolvedValue(okJson({ ok: true, rel: "a.txt" }))
  const c = new MafwClient("http://gw:3000")
  await c.fileHistory.restore({ body: { sessionID: "s1", entryId: "fh_1" } })
  expect(fetchMock).toHaveBeenCalledWith("http://gw:3000/api/file-history/restore", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ sessionID: "s1", entryId: "fh_1" }),
  }))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w @mafw/gateway-sdk`
Expected: FAIL（`c.fileHistory` undefined）

- [ ] **Step 3: 实现**

按现有 `session`/`goals` 命名空间风格添加 `fileHistory`；用 `URLSearchParams` 构造 query；`request` 的路径类型来自 Task 2 生成物。
`types.ts` 增加两个 DTO；`index.ts` 确保 `export * from './types'` 已存在（如无则补）。

- [ ] **Step 4: 跑测试**

Run: `npm test -w @mafw/gateway-sdk`
Expected: PASS（全量）

- [ ] **Step 5: 提交**

```bash
git add packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.test.ts packages/gateway-sdk/src/index.ts
git commit -m "feat(sdk): add fileHistory list/content/restore"
```

---

### Task 4: Preload 命名空间 + 类型

**Files:**
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`

**Interfaces:**
- Consumes: Task 3 SDK `fileHistory`。
- Produces: `window.api.mafw.fileHistory.list/content/restore`：
  ```ts
  fileHistory: {
    list: (sessionID: string, rel?: string) => Promise<{ entries: FileHistoryEntry[] }>
    content: (sessionID: string, entryId: string) => Promise<FileHistoryContent>
    restore: (sessionID: string, entryId: string) => Promise<{ ok: true; rel: string }>
  }
  ```

- [ ] **Step 1: 实现 preload 包装**

在 `mafw-api.ts` 的 `sessions` 命名空间旁增加：

```ts
fileHistory: {
  list: (sessionID, rel?) => invoke("fileHistory", "list", { query: { sessionID, rel } }),
  content: (sessionID, entryId) => invoke("fileHistory", "content", { query: { sessionID, entryId } }),
  restore: (sessionID, entryId) => invoke("fileHistory", "restore", { body: { sessionID, entryId } }),
},
```

在 `mafw-types.ts` 的 `MafwApi` 接口加同签名（类型从 `@mafw/sdk` 导入）。

- [ ] **Step 2: 类型检查**

Run: `cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
Expected: rc=0

- [ ] **Step 3: 提交**

```bash
git add packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts
git commit -m "feat(desktop): expose fileHistory via preload"
```

---

### Task 5: 历史列表纯逻辑（分组/时间/reason/大小）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/file-history-model.ts`
- Test: `packages/desktop/src/renderer/mafw/components/file-history-model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type HistoryEntryLike = { id: string; size: number; createdAt: string; seq: number; reason: string };
  export function reasonLabel(reason: string): string;
  export function formatHistorySize(bytes: number): string;
  export function formatHistoryClock(iso: string): string;   // 本地 HH:mm
  export function formatHistoryTime(iso: string, now: number): string; // 今天 14:03 / 昨天 09:12 / 10-29 18:40
  export function groupHistoryEntries<T extends HistoryEntryLike>(
    entries: T[], now: number,
  ): Array<{ key: string; label: string; entries: T[] }>;
  ```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { groupHistoryEntries, formatHistoryTime, formatHistorySize, reasonLabel } from "./file-history-model"

const now = new Date("2026-10-31T15:00:00").getTime()
const at = (iso: string) => ({ id: iso, size: 1, createdAt: iso, seq: 1, reason: "tool:before" })

describe("file-history-model", () => {
  test("reason 文案", () => {
    expect(reasonLabel("tool:before")).toBe("Agent 写入前")
    expect(reasonLabel("pre-restore")).toBe("恢复前")
    expect(reasonLabel("manual")).toBe("手动")
    expect(reasonLabel("tool:write")).toBe("tool:write")
  })
  test("大小", () => {
    expect(formatHistorySize(512)).toBe("512 B")
    expect(formatHistorySize(2048)).toBe("2.0 KB")
    expect(formatHistorySize(5 * 1024 * 1024)).toBe("5.0 MB")
  })
  test("时间标签", () => {
    expect(formatHistoryTime("2026-10-31T14:03:00", now)).toBe("今天 14:03")
    expect(formatHistoryTime("2026-10-30T09:12:00", now)).toBe("昨天 09:12")
    expect(formatHistoryTime("2026-10-29T18:40:00", now)).toBe("10-29 18:40")
  })
  test("按天分组，组内新到旧", () => {
    const groups = groupHistoryEntries([
      at("2026-10-29T18:40:00"), at("2026-10-31T14:03:00"), at("2026-10-31T13:58:00"), at("2026-10-30T09:12:00"),
    ], now)
    expect(groups.map(g => g.label)).toEqual(["今天", "昨天", "10-29"])
    expect(groups[0].entries.map(e => e.id)).toEqual(["2026-10-31T14:03:00", "2026-10-31T13:58:00"])
  })
  test("空数组", () => expect(groupHistoryEntries([], now)).toEqual([]))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/file-history-model.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

- `formatHistoryTime` 用本地日期比较（同一 `getFullYear/Month/Date`）。
- `groupHistoryEntries` 先按 `createdAt` 降序、同时间按 `seq` 降序，再按天分组；组 key `YYYY-MM-DD`，label 今天/昨天/`MM-DD`。
- 时间格式 `HH:mm` 用 `padStart(2,'0')`。

- [ ] **Step 4: 跑测试**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/components/file-history-model.ts packages/desktop/src/renderer/mafw/components/file-history-model.test.ts
git commit -m "feat(desktop): file history grouping and labels"
```

---

### Task 6: 历史差异纯逻辑

**Files:**
- Modify: `packages/desktop/package.json`（`"diff": "8.0.2"`）
- Create: `packages/desktop/src/renderer/mafw/components/file-history-diff.ts`
- Test: `packages/desktop/src/renderer/mafw/components/file-history-diff.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const HISTORY_TEXT_LIMIT = 1024 * 1024;
  export function buildHistoryPatch(rel: string, before: string | null, after: string | null): string | null;
  export function historyPatchStats(patch: string): { additions: number; deletions: number };
  ```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, test } from "bun:test"
import { buildHistoryPatch, historyPatchStats, HISTORY_TEXT_LIMIT } from "./file-history-diff"

describe("file-history-diff", () => {
  test("相同 / 缺边 → null", () => {
    expect(buildHistoryPatch("a.txt", "x", "x")).toBeNull()
    expect(buildHistoryPatch("a.txt", null, "x")).toBeNull()
    expect(buildHistoryPatch("a.txt", "x", null)).toBeNull()
  })
  test("修改行 → 有 hunk 和统计", () => {
    const p = buildHistoryPatch("a.txt", "a\nb\nc\n", "a\nB\nc\n")!
    expect(p).toContain("@@")
    expect(p).toContain("-b")
    expect(p).toContain("+B")
    expect(historyPatchStats(p)).toEqual({ additions: 1, deletions: 1 })
  })
  test("新增行", () => {
    const p = buildHistoryPatch("a.txt", "a\n", "a\nb\n")!
    expect(historyPatchStats(p)).toEqual({ additions: 1, deletions: 0 })
  })
  test("超过 1 MiB → null", () => {
    expect(buildHistoryPatch("a.txt", "x", "y".repeat(HISTORY_TEXT_LIMIT + 1))).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/file-history-diff.test.ts`
Expected: FAIL（模块不存在 / 缺 `diff` 依赖）

- [ ] **Step 3: 实现**

```ts
import { createTwoFilesPatch } from "diff"
```

- 任一边 `null` 或两边相等 → `null`；任一边 `length > HISTORY_TEXT_LIMIT` → `null`。
- `createTwoFilesPatch(\`a/${rel}\`, \`b/${rel}\`, before, after, "", "", { context: 3 })`。
- 无 `@@` 行 → `null`。
- `historyPatchStats` 遍历行：跳过 `+++`/`---`，`+` 计 add、`-` 计 del；`@@`/上下文不计。
- `npm install diff@8.0.2 -w @mafw/desktop` 更新根 `package-lock.json`（workspace 无独立 lock）。

- [ ] **Step 4: 跑测试**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/package.json package-lock.json packages/desktop/src/renderer/mafw/components/file-history-diff.ts packages/desktop/src/renderer/mafw/components/file-history-diff.test.ts
git commit -m "feat(desktop): build unified patch for file history"
```

---

### Task 7: FileHistoryPanel 组件 + 样式

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/FileHistoryPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/file-history-wiring.test.ts`

**Interfaces:**
- Consumes: Task 4 preload；Task 5 model；Task 6 diff；`DiffReviewPanel`。
- Produces:
  ```ts
  export function FileHistoryPanel(props: {
    sessionID: string
    rel: string
    currentText: string | null
    currentKind: string
    readOnly: boolean
    dirty: boolean
    refreshKey: number
    onBack: () => void
    onRestored: () => void | Promise<void>
  }): JSX.Element
  ```

- [ ] **Step 1: 写失败测试（wiring/contract）**

新建 `packages/desktop/tests/file-history-wiring.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("file history panel wiring", () => {
  test("panel 使用 preload 三方法 + 只读 DiffReviewPanel + 恢复确认", () => {
    const panel = read("src/renderer/mafw/components/FileHistoryPanel.tsx")
    expect(panel).toContain("window.api.mafw.fileHistory.list")
    expect(panel).toContain("window.api.mafw.fileHistory.content")
    expect(panel).toContain("window.api.mafw.fileHistory.restore")
    expect(panel).toContain("<DiffReviewPanel")
    expect(panel).toContain("previewOnly")
    expect(panel).toContain("对比上一版本")
    expect(panel).toContain("恢复此版本")
    expect(panel).toContain("该文件还没有历史版本")
    expect(panel).toContain("无法预览文本差异")
    expect(panel).toContain("先保存或撤销修改再恢复")
    expect(panel).toContain("disabled={props.dirty")
    expect(panel).toContain("当前内容不可读")
  })
  test("css 有双栏与行样式", () => {
    const css = read("src/renderer/mafw/mafw.css")
    expect(css).toContain(".mafw-editor-history")
    expect(css).toContain(".mafw-history-list")
    expect(css).toContain(".mafw-history-row")
    expect(css).toContain(".mafw-history-confirm")
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w @mafw/desktop -- --test-name-pattern "file history panel wiring"`（或全量 `npm test -w @mafw/desktop`）
Expected: FAIL（读文件抛 ENOENT / 缺少类名）

- [ ] **Step 3: 实现组件**

要点（实现细节按 spec §4）：

- state：`entries`、`selectedId`、`compareBase: 'current' | 'previous'`、`contentById: Map`、`loading`、`error`、`confirming`、`restoring`。
- `loadList()`：`window.api.mafw.fileHistory.list(props.sessionID, props.rel)`；保留当前选中（不存在则选第一条）；空列表 → 空态。
- `loadContent(id)`：缓存；失败 → `error` banner。
- `previousEntry()`：当前选中在列表中的下一条（更旧）。
- `patch` memo：`compareBase === 'previous'` 时用 `previous` 内容，否则 `props.currentText`；调用 `buildHistoryPatch`。
- `restore()`：确认后 `await window.api.mafw.fileHistory.restore(...)` → `await props.onRestored()` → `await loadList()` → 选中最新 `reason === 'pre-restore'` 条目 → toast「已恢复到 <时间> 的版本，可再次撤销」。
- dirty：恢复按钮 `disabled`，显示「编辑器有未保存修改；先保存或撤销修改再恢复。」
- 二进制/超大/当前不可读：不渲染 `DiffReviewPanel`，显示元数据 + 说明；仍显示恢复按钮。
- 列表键盘：`ArrowUp/ArrowDown` 改选中，`Enter` 预览（选中即预览），`Escape` `props.onBack()`。
- 结构：
  ```tsx
  <div class="mafw-editor-history">
    <aside class="mafw-history-list" aria-label="文件历史版本">…分组 + 行 + 对比切换 + 恢复…</aside>
    <section class="mafw-history-detail">…DiffReviewPanel / 元数据…</section>
  </div>
  ```

CSS（tokens，不硬编码颜色）：`.mafw-editor-history { display:grid; grid-template-columns: 280px 1fr; flex:1; min-height:0; }`；列表 `overflow:auto`；行 selected 用 accent 12%；窄容器 `@container (max-width: 520px)` 收窄到 220px。

- [ ] **Step 4: 跑测试**

Run: `npm test -w @mafw/desktop`
Expected: 新 wiring 用例 PASS（其余不回归）

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/components/FileHistoryPanel.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/file-history-wiring.test.ts
git commit -m "feat(desktop): file history panel with preview and restore"
```

---

### Task 8: EditorDock 接线 + history 图标

**Files:**
- Modify: `packages/ui/src/components/icon.tsx`（新增 `history`）
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Test: `packages/desktop/tests/file-history-wiring.test.ts`（追加）

**Interfaces:**
- Consumes: Task 7 `FileHistoryPanel`。
- Produces: `mode: "edit" | "diff" | "history"`；header「历史」按钮；`onRestored` 调 `reloadFromDisk(rel)`。

- [ ] **Step 1: 追加失败测试**

```ts
test("EditorDock 有 history 模式、入口按钮与恢复后重载", () => {
  const dock = read("src/renderer/mafw/components/EditorDock.tsx")
  expect(dock).toContain('"edit" | "diff" | "history"')
  expect(dock).toContain("FileHistoryPanel")
  expect(dock).toContain('aria-label="文件历史"')
  expect(dock).toContain("onRestored")
  expect(dock).toContain("reloadFromDisk")
  const icon = read("../../ui/src/components/icon.tsx")
  expect(icon).toContain("history:")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -w @mafw/desktop`
Expected: FAIL（mode 联合类型/按钮/图标缺失）

- [ ] **Step 3: 实现**

- `icon.tsx` 增加：
  ```ts
  history: `<path d="M10 5.5V10L13 12M2.5 10C2.5 5.86 5.86 2.5 10 2.5C14.14 2.5 17.5 5.86 17.5 10C17.5 14.14 14.14 17.5 10 17.5C7.4 17.5 5.1 16.2 3.7 14.2M3.7 14.2V17.5M3.7 14.2H7" stroke="currentColor" stroke-linecap="square"/>`,
  ```
- `EditorDock`：
  - `createSignal<"edit" | "diff" | "history">("edit")`。
  - header 增加（放在「改动」按钮前）：
    ```tsx
    <TooltipV2 value={mode() === "history" ? "返回编辑" : "文件历史"} openDelay={300}>
      <ButtonV2 variant={mode() === "history" ? "contrast" : "ghost"} size="small"
        aria-label="文件历史" aria-pressed={mode() === "history"}
        disabled={!activeFile()}
        onClick={() => { setMode(mode() === "history" ? "edit" : "history"); clearSelection() }}>
        <Icon name="history" size="small" />
      </ButtonV2>
    </TooltipV2>
    ```
  - body 内：
    ```tsx
    <Show when={mode() === "history" && activeFile() && props.sessionID}>
      <FileHistoryPanel
        sessionID={props.sessionID!}
        rel={activeFile()!.rel}
        currentText={activeFile()!.readOnly ? null : activeFile()!.savedContent}
        currentKind={activeFile()!.kind}
        readOnly={activeFile()!.readOnly}
        dirty={activeFile()!.dirty}
        refreshKey={fileVersion()[activeFile()!.rel] ?? 0}
        onBack={() => { setMode("edit"); clearSelection() }}
        onRestored={async () => { await reloadFromDisk(activeFile()!.rel) }}
      />
    </Show>
    ```
  - `mode === "history"` 时隐藏 CodeMirror/预览（沿用 diff 的 `display:none` 条件）。
- 注意：`reloadFromDisk` 需要文件仍打开；若文件已被删除，面板仍可恢复，`reloadFromDisk` 失败应 fail-open（toast 已由面板负责）。

- [ ] **Step 4: 跑测试与类型**

Run:
```bash
npm test -w @mafw/desktop
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```
Expected: 测试 PASS；tsgo rc=0；build rc=0

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/components/icon.tsx packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/tests/file-history-wiring.test.ts
git commit -m "feat(desktop): open file history from the editor"
```

---

### Task 9: 文档 + 全量门禁 + 部署冒烟

**Files:**
- Modify: `AGENTS.md`（§5.5 桌面条目追加一条 2026-10-31 记录）
- Modify: `docs/superpowers/plans/2026-10-31-file-history-ui.md`（勾选完成项，可选）

**Steps:**

- [ ] **Step 1: 文档**

在 `AGENTS.md` §5.5 追加「文件历史 UI（2026-10-31）」条目，记录：
- 入口 / 面板形态 / 1 MiB 与二进制降级 / 恢复前自动快照 / 保留 50 条；
- commits、测试计数（gateway / desktop / SDK）、typecheck/build 结果；
- 已知限制（新建文件无 tombstone、无全局时间线、片段恢复未做）。

- [ ] **Step 2: 全量测试**

```bash
cd gateway && npx jest --runInBand --forceExit
cd .. && npx jest
npm test -w @mafw/gateway-sdk
npm test -w @mafw/desktop
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
Expected: 全绿；记录准确数字。

- [ ] **Step 3: 部署 + 冒烟**

```bash
node gateway/scripts/deploy-local.mjs
# 根 dist（plugin 无改动也保持一致）
Copy-Item dist\* <npm-global>\node_modules\@jack200714\mafw\dist -Recurse -Force
```
- 写 `~/.mafw/pending-restart.json`（UTF-8 no BOM，`action:"restart"`）重启 gateway。
- HTTP 冒烟：`GET /api/file-history/content?...` 返回 text；二进制返回 binary。
- GUI 冒烟（需重启 desktop dev app）：文本 diff、对比上一版本、恢复 + 撤销、pptx 元数据态、空态、dirty 禁用。

- [ ] **Step 4: 提交**

```bash
git add AGENTS.md docs/superpowers/plans/2026-10-31-file-history-ui.md
git commit -m "docs: file history UI delivery notes"
```

---

## 自检记录

- 覆盖 spec：G1→Task 8；G2→Task 5/7；G3→Task 6/7；G4→Task 7/8；G5→Task 1/7；G6→Task 2/3/4；G7→各 Task 测试。
- 类型一致性：`FileHistoryContentResult`（gateway）→ `FileHistoryContent`（SDK）为成功分支别名；preload 方法名与面板调用一致。
- Review Focus 五项均落到 Task 1/7/8 的测试或实现守卫。
