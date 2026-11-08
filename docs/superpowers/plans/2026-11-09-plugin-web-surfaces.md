# Plugin Web Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugins can ship sandboxed Web pages that open as right-workbench L2 surfaces (reachable from a left-rail entry), with plugin-owned HTTP/WS routes plus host `ctx.files` / `ctx.terminal` services.

**Architecture:** Extend the unified plugin contract with `ui.webSurfaces[]`; the gateway projects them into the existing revisioned client snapshot, serves `web/` assets and scoped plugin routes under `/api/plugins/<pkg>/…` with a package-bound ticket cookie, and injects `ctx.http` / `ctx.files` / `ctx.terminal` into package activation. Desktop renders each surface in a hardened `<webview>` (per-package partition) inside the existing `plugin:<pkg>:<surface>` L2 tab, with a `window.mafwPlugin` bridge for context/actions/events/badges.

**Tech Stack:** TypeScript (gateway CJS / desktop ESM+Solid), `@mafw/plugin-contract`, Electron `<webview>` + `contextBridge`, Node `http`/`ws`, Jest (gateway), `node:test` (contract/desktop/SDK).

**Spec:** `docs/superpowers/specs/2026-11-09-plugin-web-surfaces-design.md`

## Global Constraints

- Surface id shape is exactly `plugin:<package>:<surfaceId>` (reuse `packages/desktop/src/renderer/mafw/workbench-views.ts`).
- Package/route namespace: `/api/plugins/<pkg>/`; plugin routes live under `/api/plugins/<pkg>/api/*`, assets under `/api/plugins/<pkg>/ui/*`, events under `/api/plugins/<pkg>/events`, WS under `/api/plugins/<pkg>/ws/*`, ticket under `/api/plugins/<pkg>/web-ticket`.
- Descriptors crossing to Desktop are JSON-only and deep-frozen; no functions, no `ctx`, no file paths.
- Validation is fail-closed: unknown fields/slots/icons/ids reject the descriptor; a declared surface whose `web/` asset is missing fails whole-package activation with a structured error.
- Ticket binds `(package, projectDir, sessionID?)`; TTL 8h; handler context comes from the ticket, never ambient `currentProject`.
- Webview: `nodeIntegration=no`, `contextIsolation=yes`, `sandbox=yes`, dedicated `persist:mafw-plugin-<pkg>` partition, permissions denied, navigation restricted to the package's own routes.
- Tests: contract `node --test src/validate.test.ts`; gateway `npm test --prefix gateway -- --runInBand --forceExit`; desktop `npm test -w @mafw/desktop` (already carries `--conditions=browser`).
- No new runtime dependency beyond the existing `ws`.

## Review Focus

- A package declaring `webSurfaces` installed on an old gateway must be rejected with a package-level error naming the unsupported slot — never silently dropped or half-activated.
- `entry`/`ctx.files` paths with `..`, absolute paths, symlinks or NUL must 404/reject without reading outside the package/project root.
- A plugin page navigating to `https://`/`file:`/`javascript:` or calling `window.open` must be blocked by the host, not by the page.
- A page calling another package's route or event must get 403/empty, even with a valid ticket.
- A long-lived tab must survive ticket expiry (main-process refresh), showing an error surface instead of a permanent blank/403 loop.
- An unknown `rail.icon` must fail contract validation, not render the fallback `plus` glyph.

---

### Task 1: Contract — `webSurfaces` descriptor, icon names, validation

**Files:**
- Modify: `packages/plugin-contract/src/types.ts`
- Create: `packages/plugin-contract/src/icons.ts`
- Modify: `packages/plugin-contract/src/validate.ts`
- Modify: `packages/plugin-contract/src/index.ts`
- Test: `packages/plugin-contract/src/validate.test.ts`

**Interfaces:**
- Consumes: existing `PluginUiContribution`, `PluginClientDescriptor`, `NAME_PATTERN`, `checkKnownFields`, `addError`.
- Produces:
  - `PluginWebSurfaceDescriptor { id: string; title: string; icon?: string; entry?: string; scope?: "session"|"project"|"global"; reloadOnSessionChange?: boolean; rail?: { icon: string; order?: number; badge?: boolean } }`
  - `PluginWebSurfaceClientDescriptor { id; title; icon?; entry: string; scope: "session"|"project"|"global"; reloadOnSessionChange: boolean; url: string; rail?: { icon: string; order: number; badge: boolean } }`
  - `PLUGIN_ICON_NAMES: readonly string[]`, `isPluginIconName(value: unknown): boolean`
  - `PluginUiContribution.webSurfaces?: PluginWebSurfaceDescriptor[]`

- [ ] **Step 1: Write failing validation tests**

In `validate.test.ts` add:
```ts
test("webSurfaces: defaults entry/scope/reload and builds the gateway URL", () => {
  const result = validateClientDescriptor({
    name: "demo", version: "1.0.0", revision: "r1",
    ui: { webSurfaces: [{ id: "panel", title: "Demo", rail: { icon: "layout-grid" } }] },
    actions: [], events: [],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.ui.webSurfaces, [{
    id: "panel", title: "Demo", entry: "index.html", scope: "session",
    reloadOnSessionChange: true, url: "/api/plugins/demo/ui/index.html",
    rail: { icon: "layout-grid", order: 100, badge: false },
  }])
})

test("webSurfaces: rejects traversal/absolute entries and unknown icons", () => {
  for (const entry of ["../x.html", "/etc/passwd", "a/../../b.html", "a\\..\\b.html"]) {
    const r = validateClientDescriptor({ name: "demo", version: "1", revision: "r",
      ui: { webSurfaces: [{ id: "p", title: "P", entry }] }, actions: [], events: [] })
    assert.equal(r.ok, false)
  }
  const icon = validateClientDescriptor({ name: "demo", version: "1", revision: "r",
    ui: { webSurfaces: [{ id: "p", title: "P", rail: { icon: "not-a-real-icon" } }] }, actions: [], events: [] })
  assert.equal(icon.ok, false)
})

test("webSurfaces: id collides with panels and unknown fields reject", () => {
  const collide = validateClientDescriptor({ name: "demo", version: "1", revision: "r",
    ui: { panels: [{ id: "p", title: "P", viewAction: "v" }],
          webSurfaces: [{ id: "p", title: "P" }] },
    actions: [{ name: "v" }], events: [] })
  assert.equal(collide.ok, false)
  const extra = validateClientDescriptor({ name: "demo", version: "1", revision: "r",
    ui: { webSurfaces: [{ id: "p", title: "P", url: "https://evil" }] }, actions: [], events: [] })
  assert.equal(extra.ok, false)
})
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test packages/plugin-contract/src/validate.test.ts`
Expected: FAIL — `webSurfaces` is an unknown slot / no URL projection.

- [ ] **Step 3: Implement**

- `icons.ts`: export `PLUGIN_ICON_NAMES` (a names-only copy of the icons already used by the rail: `bubble-5`, `magnifying-glass`, `sticky-note`, `team-three`, `checklist`, `layout-grid`, `square-arrow-top-right`, `refresh`, `plus`, `file`, `folder`, `terminal`, `git-branch`, `globe`) and `isPluginIconName`. Do not import `@mafw/ui`.
- `types.ts`: add the two interfaces and `webSurfaces` to `PluginUiContribution`; add `webSurfaces?: PluginWebSurfaceClientDescriptor[]` to `PluginClientDescriptor`.
- `validate.ts`: add `readWebSurfaces(value, packageName, panelIds, errors)` following `readPanels`:
  - array ≤ 32; each item plain object; known fields `{id,title,icon,entry,scope,reloadOnSessionChange,rail}`;
  - `id` matches NAME_PATTERN and is unique across `panels` + `webSurfaces`;
  - `title` non-empty ≤ 80;
  - `entry` relative, no `..`/absolute/backslash/NUL/`#`/`?`, default `index.html`;
  - `scope` enum default `session`; `reloadOnSessionChange` boolean default `true`;
  - `rail.icon` must satisfy `isPluginIconName`; `order` number default 100; `badge` boolean default `false`;
  - project `url = /api/plugins/${packageName}/ui/${entry}` (entry normalized with `/`).
- `index.ts`: export `icons.ts`.
- Wire `ui.webSurfaces` into the `ui` object in `readUi` and add to `DESCRIPTOR_KEYS` handling if `ui` already present.

- [ ] **Step 4: Run tests and verify pass**

Run: `node --test packages/plugin-contract/src/validate.test.ts`
Expected: PASS, including the existing suite.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-contract/src
git commit -m "feat(plugin-contract): add web surface descriptors"
```

---

### Task 2: Gateway — web asset/entry validation + host fail-closed activation

**Files:**
- Create: `gateway/src/plugins/plugin-web-assets.ts`
- Modify: `gateway/src/plugins/package-host.ts` (activation path, ~`:923` `activate`)
- Test: `gateway/tests/unit/plugins/plugin-web-assets.test.ts`

**Interfaces:**
- Consumes: `PluginWebSurfaceDescriptor` from Task 1.
- Produces:
  - `resolvePluginWebEntry(packageDir: string, entry: string): string | null` — realpath containment under `<packageDir>/web`, rejects dotfiles/symlinks escaping, returns absolute file path or `null`.
  - `validatePluginWebSurfaces(packageDir: string, surfaces: readonly PluginWebSurfaceDescriptor[]): string[]` — empty array when all entries resolve; otherwise human-readable errors naming `surface.id` and `entry`.
  - `pluginWebAssetContentType(filePath: string): string` — html/js/css/json/svg/png/jpg/webp/woff2/text fallback.

- [ ] **Step 1: Write failing tests**

```ts
it("rejects a surface whose entry escapes web/", () => {
  const dir = mkdtempSync(join(tmpdir(), "mafw-web-"))
  mkdirSync(join(dir, "web"), { recursive: true })
  writeFileSync(join(dir, "web", "index.html"), "<html/>")
  expect(validatePluginWebSurfaces(dir, [{ id: "p", title: "P", entry: "../index.html" }]).length).toBe(1)
})
it("resolves nested entries and serves a content type", () => {
  // web/app/index.html + resolvePluginWebEntry(dir, "app/index.html") !== null
  expect(pluginWebAssetContentType("/x/index.html")).toContain("text/html")
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test --prefix gateway -- tests/unit/plugins/plugin-web-assets.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- `resolvePluginWebEntry`: `path.resolve(packageDir, "web", entry)` → `fs.realpathSync`, ensure result starts with `realpathSync(webDir) + sep`; reject segments starting with `.`; return null on any error.
- In `package-host.ts` `activate()` after `buildActivatedContributions` succeeds and before committing, call `validatePluginWebSurfaces(dir, validated.ui.webSurfaces ?? [])`; on errors return `{ ok: false, errors }` (whole-package failure).
- Do not run the check for `checkPackage` dry runs? Yes, do run it — a dry run should catch a missing entry.

- [ ] **Step 4: Pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-web-assets.ts gateway/src/plugins/package-host.ts gateway/tests/unit/plugins/plugin-web-assets.test.ts
git commit -m "feat(gateway): validate plugin web surface entries"
```

---

### Task 3: Gateway — `ctx.http` scoped HTTP/WS registry

**Files:**
- Create: `gateway/src/plugins/plugin-http.ts`
- Modify: `gateway/src/plugins/package-types.ts` (`PluginPackageContext.http`)
- Modify: `gateway/src/plugins/package-context.ts` (inject per-package api)
- Modify: `gateway/src/plugins/package-host.ts` (register on commit, retire on dispose)
- Test: `gateway/tests/unit/plugins/plugin-http.test.ts`

**Interfaces:**
- Produces:
  - `PluginHttpRequest { method; path; query: URLSearchParams; headers: IncomingHttpHeaders; sessionID?: string; projectDir: string; body: AsyncIterable<Buffer> }`
  - `PluginHttpResponseInit { status?: number; headers?: Record<string,string>; body?: string|Buffer|NodeJS.ReadableStream|AsyncIterable<Uint8Array> }`
  - `PluginHttpHandler = (req: PluginHttpRequest) => Promise<PluginHttpResponseInit | void>`
  - `PluginWsHandler = (ws: WebSocket, ctx: { sessionID?: string; projectDir: string }) => void`
  - `PluginHttpApi { route(method, path, handler, opts?: { maxBodyBytes?: number }): void; ws(path, handler): void }`
  - `createPluginHttpRegistry(deps: { log }): PluginHttpRegistry` with `register(pkg, method, path, handler, opts)`, `registerWs(pkg, path, handler)`, `retire(pkg)`, `dispatch(pkg, req, res, ctx): Promise<boolean>`, `upgrade(pkg, path, req, socket, head, ctx): boolean`, `routes(): Array<{ package, method, path, ws }>`.
- Route normalization: `path` must be `''` or start with `/`, no `..`, no `:`, no duplicate `(method,path)` per package; actual URL is `/api/plugins/<pkg>/api<path>`.

- [ ] **Step 1: Write failing tests**

```ts
it("dispatches a package route with ticket context and rejects traversal", async () => {
  const reg = createPluginHttpRegistry({ log: silentLog })
  reg.register("demo", "GET", "/files", async (req) => ({ status: 200, body: JSON.stringify(req.projectDir) }))
  expect(reg.routes()).toEqual([{ package: "demo", method: "GET", path: "/files", ws: false }])
  expect(() => reg.register("demo", "GET", "/../x", async () => ({}))).toThrow()
})
it("retire removes routes and closes ws", () => {
  const reg = createPluginHttpRegistry({ log: silentLog })
  reg.registerWs("demo", "/term", () => {})
  reg.retire("demo")
  expect(reg.routes()).toEqual([])
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test --prefix gateway -- tests/unit/plugins/plugin-http.test.ts --runInBand --forceExit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- Registry keeps `Map<package, Map<method+path, entry>>` and `Map<package, Map<path, wsEntry>>`; `retire` deletes + closes active sockets created by that package.
- `dispatch` matches exact method+path, rejects non-matching; wraps handler errors into `{status:500}` and logs.
- `ctx.http` is a thin recorder per package: during `activate` it validates and buffers registrations; `PluginHost` commits them into the registry on `toCommit` and calls `retire(pkg)` on dispose.
- During `checkPackage`, the recorder validates but never registers.
- `PluginPackageContext.http` typed as `PluginHttpApi`.

- [ ] **Step 4: Pass** — same command.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-http.ts gateway/src/plugins/package-types.ts gateway/src/plugins/package-context.ts gateway/src/plugins/package-host.ts gateway/tests/unit/plugins/plugin-http.test.ts
git commit -m "feat(gateway): scoped plugin http/ws routes"
```

---

### Task 4: Gateway — asset serving, ticket, events, WS upgrade

**Files:**
- Create: `gateway/src/plugins/plugin-web-ticket.ts`
- Create: `gateway/src/routes/plugin-web.ts`
- Modify: `gateway/src/routes/route-catalog.ts` (4 ops)
- Modify: `gateway/src/routes/wave2-handlers.ts` (attach handlers)
- Modify: `gateway/src/index.ts` (upgrade dispatch + wiring)
- Test: `gateway/tests/unit/routes/plugin-web.test.ts`, `gateway/tests/unit/plugins/plugin-web-ticket.test.ts`

**Interfaces:**
- Produces:
  - `createPluginWebTicketStore(deps: { now?: () => number; ttlMs?: number })` → `{ issue(pkg, { projectDir, sessionID? }): { ticket, expiresAt }; verify(pkg, ticket): { projectDir; sessionID? } | null; refresh(ticket): { ticket, expiresAt } | null }`
  - `handlePluginWebAsset(deps)` → `GET /api/plugins/:name/ui/*`
  - `handlePluginWebTicket(deps)` → `POST /api/plugins/:name/web-ticket` (body `{ projectDir, sessionID? }`, validates registered project)
  - `handlePluginWebEvents(deps)` → `GET /api/plugins/:name/events` (SSE, package-filtered)
  - `handlePluginApiRoute(deps)` → dispatch `/api/plugins/:name/api/*`
  - `handlePluginWsUpgrade(...)` → `/api/plugins/:name/ws/*`
- Ticket cookie: `mafw_plugin_ticket`, `Path=/api/plugins/<pkg>/`, `HttpOnly`, `SameSite=Strict`.

- [ ] **Step 1: Write failing tests**

```ts
it("issues a package-bound ticket and rejects cross-package use", () => {
  const store = createPluginWebTicketStore({ now: () => 1000, ttlMs: 1000 })
  const { ticket } = store.issue("demo", { projectDir: "/repo" })
  expect(store.verify("demo", ticket)?.projectDir).toBe("/repo")
  expect(store.verify("other", ticket)).toBeNull()
})
it("rejects ticket for an unregistered project", async () => {
  // handler deps has listProjects: () => ["/repo"]; body projectDir "/etc" → 400
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test --prefix gateway -- tests/unit/plugins/plugin-web-ticket.test.ts tests/unit/routes/plugin-web.test.ts --runInBand --forceExit`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Ticket store is in-memory; `issue` random `crypto.randomBytes(24).toString("hex")`; `verify` checks package + expiry; `refresh` extends.
- Asset handler: only active packages; resolve with `resolvePluginWebEntry`; stream file; set CSP and `Cache-Control: no-store`; 404 on any failure.
- Ticket handler: validate `projectDir` is a registered project (deps `listProjects()`), issue, set cookie via `Set-Cookie`.
- Events handler: SSE headers, filter `event.type.startsWith('plugin:<pkg>:')`, optional `sessionID` filter; heartbeat like existing SSE.
- API route: require ticket cookie or loopback; call `registry.dispatch(pkg, ...)`; 404 when no route.
- WS upgrade: in `index.ts` before `/api/ws`, match `/api/plugins/<pkg>/ws/<path>`; verify cookie/loopback; `registry.upgrade(...)`.
- route-catalog add:
  - `POST /api/plugins/:name/web-ticket` → `plugins.webTicket`
  - `GET /api/plugins/:name/ui` (wildcard paths are not represented; register the base op for contract visibility) → `plugins.webAsset`
  - `GET /api/plugins/:name/events` → `plugins.webEvents`
- Attach handlers in `wave2-handlers.ts` with thin deps from `index.ts`.

- [ ] **Step 4: Pass** — same command.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-web-ticket.ts gateway/src/routes/plugin-web.ts gateway/src/routes/route-catalog.ts gateway/src/routes/wave2-handlers.ts gateway/src/index.ts gateway/tests/unit/plugins/plugin-web-ticket.test.ts gateway/tests/unit/routes/plugin-web.test.ts
git commit -m "feat(gateway): serve plugin web assets and tickets"
```

---

### Task 5: Gateway — `ctx.files` and `ctx.terminal` host services

**Files:**
- Create: `gateway/src/plugins/plugin-host-services.ts`
- Modify: `gateway/src/plugins/package-types.ts` (`files`, `terminal`)
- Modify: `gateway/src/plugins/package-context.ts` (inject)
- Modify: `gateway/src/plugins/package-host.ts` (track + cleanup terminal ids)
- Test: `gateway/tests/unit/plugins/plugin-host-services.test.ts`

**Interfaces:**
- `PluginFilesApi { list(rel): Promise<Array<{name;kind;size?;mtime?}>>; stat(rel): Promise<{kind;size;mtime}>; read(rel, opts?: { maxBytes?: number }): Promise<Buffer> }`
- `PluginTerminalApi { create(opts?: {cols?;rows?}): Promise<{id}>; bridge(id, ws): Promise<void>; resize(id, cols, rows): void; kill(id): void }`
- `createPluginFilesApi(projectDir: string)` and `createPluginTerminalApi(deps: { service: () => TerminalService | undefined; projectDir: string; pkg: string; log })`.

- [ ] **Step 1: Write failing tests**

```ts
it("files api stays inside the project root", async () => {
  const api = createPluginFilesApi(repoDir)
  expect((await api.list(".")).some((e) => e.name === "package.json")).toBe(true)
  await expect(api.read("../secret")).rejects.toThrow()
})
it("terminal api tracks ids and kills on dispose", async () => {
  // fake TerminalService create→"t1"; disposeTerminals(pkg) calls kill("t1")
})
```

- [ ] **Step 2: Run and verify failure** — module not found.

- [ ] **Step 3: Implement**

- files: resolve + realpath containment under `projectDir`; list returns names sorted dirs-first; read caps bytes (default 8 MiB).
- terminal: wrap `TerminalService.create({ directory: projectDir, cols, rows })`, `bridge({ socket: ws, id, ticket })`? The service requires a ticket; plugin host half owns the PTY, so use the service's internal bridge with a ticket it issues itself via `service.connect(id, directory)`? Inspect `TerminalService` for the exact create/bridge signatures at implementation time; expose a package-scoped ticket through `service.issueTicket` if available, else call `bridge` with the ticket from `service.connect`.
- Track created ids per package; Host calls `disposeHostServices(pkg)` on retire.

- [ ] **Step 4: Pass** — same command.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins/plugin-host-services.ts gateway/src/plugins/package-types.ts gateway/src/plugins/package-context.ts gateway/src/plugins/package-host.ts gateway/tests/unit/plugins/plugin-host-services.test.ts
git commit -m "feat(gateway): plugin files and terminal services"
```

---

### Task 6: SDK + preload + main IPC — web session preparation

**Files:**
- Modify: `packages/gateway-sdk/src/client.ts` (`plugins.webTicket`)
- Modify: `packages/gateway-sdk/src/types.ts` (`PluginWebTicket`)
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/main/mafw-ipc.ts`
- Modify: `packages/desktop/src/main/plugin-web-session.ts` (create)
- Test: `packages/desktop/src/main/plugin-web-session.test.ts` (pure helpers)

**Interfaces:**
- `plugins.webTicket(name: string, input: { projectDir: string; sessionID?: string }): Promise<{ ticket: string; expiresAt: number }>`
- Renderer API: `plugins.prepareWebSurface(name, input): Promise<{ partition: string; url: string; expiresAt: number }>`
- `PLUGIN_WEB_PARTITION_PREFIX = "persist:mafw-plugin-"`
- `pluginWebPartition(pkg)`, `pluginWebUrl(gatewayUrl, pkg, entry, revision)`, `pluginWebPreloadPath()` pure helpers.

- [ ] **Step 1: Write failing tests**

```ts
test("pluginWebUrl keeps the package namespace and revision", () => {
  expect(pluginWebUrl("http://127.0.0.1:3000", "demo", "app/index.html", "b1:2"))
    .toBe("http://127.0.0.1:3000/api/plugins/demo/ui/app/index.html?revision=b1%3A2")
})
test("partition is per package", () => {
  expect(pluginWebPartition("demo")).toBe("persist:mafw-plugin-demo")
})
```

- [ ] **Step 2: Run and verify failure**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/plugin-web-session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- SDK: `POST /api/plugins/:name/web-ticket` (encoded name), returns `{ticket, expiresAt}`; add to `plugins` namespace + types + contract test count.
- Main IPC handler `mafw-plugin-web-session`: call `mafwClient.plugins.webTicket`, then `session.fromPartition(partition).cookies.set({ url: gatewayUrl, name: "mafw_plugin_ticket", value: ticket, path: `/api/plugins/${pkg}/`, httpOnly: true, sameSite: "strict", expirationDate: Math.floor(expiresAt/1000) })`; return `{ partition, url, expiresAt }`.
- `configurePluginWebSession()`: `session.fromPartition(partition)` permission handlers deny; `onBeforeRequest` filter to `/api/plugins/<pkg>/`; `will-attach-webview` forces `webPreferences.preload` to `pluginWebPreloadPath()` and strips node integration.
- `pluginWebPreloadPath()` = `join(__dirname, "../preload/plugin-web.js")` (electron-vite emits `out/preload/plugin-web.js`; packaged app keeps the same layout).
- Ticket refresh: main keeps `expiresAt` per package; renderer calls `plugins.prepareWebSurface` again at `expiresAt - 30min` (host schedules it), and once more after any 403; each call replaces the cookie in the same partition.
- Preload `mafw-api.ts`: `plugins.prepareWebSurface`.
- Preload build entry: add `pluginWeb: "src/preload/plugin-web.ts"` to `electron.vite.config.ts` preload input.

- [ ] **Step 4: Pass** — same command; also `npm test -w @mafw/sdk`.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src packages/desktop/src/preload packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/main/plugin-web-session.ts packages/desktop/electron.vite.config.ts
git commit -m "feat(desktop): prepare sandboxed plugin web sessions"
```

---

### Task 7: Desktop — surface/rail projection model

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-web-surface.ts`
- Test: `packages/desktop/src/renderer/mafw/plugins/plugin-web-surface.test.ts`

**Interfaces:**
- `PluginWebSurfaceView { packageName; surfaceId: PluginSurfaceId; id; title; icon?; entry; scope; reloadOnSessionChange; rail?: { icon; order; badge }; revision }`
- `PluginRailItem { surfaceId; packageName; label; icon; order; badge }`
- `webSurfaceViews(plugins: readonly PluginClientDescriptor[]): PluginWebSurfaceView[]`
- `railItemsFromWebSurfaces(views): PluginRailItem[]` (sort order asc, then package/surface)
- `webSurfaceSrc(gatewayUrl, view): string`

- [ ] **Step 1: Write failing tests**

```ts
test("projects web surfaces and rail items deterministically", () => {
  const views = webSurfaceViews([{ name: "demo", version: "1", revision: "r",
    ui: { webSurfaces: [{ id: "db", title: "DB", rail: { icon: "layout-grid", order: 2 } }] },
    actions: [], events: [] } as any])
  expect(views[0].surfaceId).toBe("plugin:demo:db")
  expect(railItemsFromWebSurfaces(views)).toEqual([
    { surfaceId: "plugin:demo:db", packageName: "demo", label: "DB", icon: "layout-grid", order: 2, badge: false },
  ])
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -w @mafw/desktop -- src/renderer/mafw/plugins/plugin-web-surface.test.ts` (or the desktop test command with the file).

- [ ] **Step 3: Implement** pure functions (no Solid/DOM); tolerant of old descriptors without `webSurfaces`.

- [ ] **Step 4: Pass**.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/plugins/plugin-web-surface.ts packages/desktop/src/renderer/mafw/plugins/plugin-web-surface.test.ts
git commit -m "feat(desktop): project plugin web surfaces and rail entries"
```

---

### Task 8: Desktop — `PluginWebSurfaceHost` + bridge preload

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginWebSurfaceHost.tsx`
- Create: `packages/desktop/src/preload/plugin-web.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-web-bridge.ts` (host-side message router, pure)
- Test: `packages/desktop/src/renderer/mafw/plugins/plugin-web-bridge.test.ts`

**Interfaces:**
- `PluginWebSurfaceHost(props: { view; gatewayUrl; sessionID?; projectDir; onBadge(n); onTitle(t); onError(msg) })`
- Bridge protocol: `{ id, method, params }` → `{ id, ok, result?, error? }`; methods `context|invoke|onEvent|setBadge|setTitle|openExternal|onThemeChange|onContextChange`.
- `createPluginWebBridge(deps)` pure router with `handle(msg): Promise<reply>` + `emit(event)`.

- [ ] **Step 1: Write failing tests**

```ts
test("invoke is scoped to the package and rejects unknown methods", async () => {
  const bridge = createPluginWebBridge({ pkg: "demo", invoke: async () => ({ ok: true }), context: () => ({ projectDir: "/repo" }) })
  expect(await bridge.handle({ id: 1, method: "context" })).toMatchObject({ ok: true, result: { projectDir: "/repo" } })
  await expect(bridge.handle({ id: 2, method: "eval" })).rejects.toThrow()
})
```

- [ ] **Step 2: Run and verify failure**.

- [ ] **Step 3: Implement**

- Host component creates `<webview>` imperatively (like `BrowserDock`), sets `partition`, `src`, `webpreferences`; listens to `ipc-message` channel `mafw-plugin-bridge`, routes through the bridge, replies via `webview.send`.
- Host schedules `prepareWebSurface` again at `expiresAt - 30min`; refreshes the cookie via main and calls `webview.reload()`; on load failure (`did-fail-load` / HTTP 403) retries once, then shows the error banner.
- Preload `plugin-web.ts`: `contextBridge.exposeInMainWorld("mafwPlugin", …)`; each method sends `{id, method, params}` via `ipcRenderer.sendToHost` and resolves on reply; `onEvent/onThemeChange/onContextChange` subscribe to host pushes.
- Bridge enforces the package; `invoke` calls `window.api.mafw.plugins.invoke(pkg, action, input)`.
- Errors → `onError` (DockBanner).

- [ ] **Step 4: Pass**.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/plugins/PluginWebSurfaceHost.tsx packages/desktop/src/preload/plugin-web.ts packages/desktop/src/renderer/mafw/plugins/plugin-web-bridge.ts packages/desktop/src/renderer/mafw/plugins/plugin-web-bridge.test.ts
git commit -m "feat(desktop): sandboxed plugin web surface host"
```

---

### Task 9: Desktop — wire rail, workbench L2, lifecycle

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx` (surface list)
- Test: `packages/desktop/src/renderer/mafw/plugin-web-wiring.test.ts` (source pins + model)

**Interfaces:**
- `IconRail` new props: `pluginItems?: PluginRailItem[]`, `onPluginItem?: (surfaceId: PluginSurfaceId) => void`.
- `WorkbenchCodeView` new prop: `renderWebSurface?: (surfaceId: string) => JSX.Element | null`.
- `MafwShell`: `const pluginWebSurfaces = createMemo(() => webSurfaceViews(pluginDescriptors()))`; `openPluginSurface(surfaceId)` → `openWorkbench("workbench", surfaceId)`.

- [ ] **Step 1: Write failing tests**

```ts
test("rail renders plugin items after built-ins and activates the surface", () => {
  const shell = readFileSync(join(import.meta.dirname, "MafwShell.tsx"), "utf8")
  expect(shell).toContain("pluginRailItems")           // derived memo passed to IconRail
  expect(shell).toContain("openWorkbench(\"workbench\"")
})
test("workbench renders a web surface through the web host", () => {
  const view = readFileSync(join(import.meta.dirname, "components/WorkbenchCodeView.tsx"), "utf8")
  expect(view).toContain("PluginWebSurfaceHost")
})
```

- [ ] **Step 2: Run and verify failure**.

- [ ] **Step 3: Implement**

- `MafwShell`: derive `pluginWebSurfaces` + `pluginRailItems`; pass to `IconRail`; `onPluginItem` opens the workbench surface; pass `renderWebSurface` to the workbench; on revision change, compute missing surfaces and close/fallback (reuse `resolveActiveSurface`).
- `WorkbenchCodeView`: if the surface descriptor kind is web → `PluginWebSurfaceHost`; declarative panel path unchanged.
- `IconRail`: render plugin items in the destination group after 资源; tooltip/aria like built-ins; badge from the item.
- Context changes: pass `sessionID`/`projectDir` into the host; `scope=session` + `reloadOnSessionChange` triggers reload.

- [ ] **Step 4: Pass**.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw
git commit -m "feat(desktop): open plugin web surfaces in the workbench"
```

---

### Task 10: Demo package + docs + Creator inspect

**Files:**
- Create: `docs/examples/plugins/web-surface-demo/plugin.json`
- Create: `docs/examples/plugins/web-surface-demo/index.js`
- Create: `docs/examples/plugins/web-surface-demo/web/index.html`
- Create: `docs/examples/plugins/web-surface-demo/web/app.js`
- Create: `docs/examples/plugins/web-surface-demo/index.test.js`
- Modify: `docs/guides/plugin-authoring.md` (Web surfaces section)
- Modify: `docs/guides/plugin-creator.md` (web scaffolding note)
- Modify: `src/tools/plugin-inspect.ts` (slots payload already reads `PLUGIN_PUBLIC_CONTRACT.slots`; extend the constant)
- Modify: `gateway/src/plugins/package-types.ts` docs only if needed
- Test: `gateway/tests/integration/plugin-web-surface.test.ts`

**Interfaces:**
- Demo host half: actions `listFiles` (ctx.files.list), `emitChanged` (ctx.emit `plugin:web-surface-demo:changed`), route `GET /files` (ctx.http), terminal route `ws /term` bridging `ctx.terminal`.
- Demo page: file tree from `/api/plugins/web-surface-demo/api/files`, refresh button, terminal `<pre>` + input.

- [ ] **Step 1: Write the integration test** (temp package dir + fake host plumbing): install descriptor → assert `webSurfaces` projected with URL; assert `ctx.http` route dispatch returns file list; assert ticket rejects another package.

- [ ] **Step 2: Run and verify failure**.

- [ ] **Step 3: Implement demo + docs + `PLUGIN_PUBLIC_CONTRACT.slots` includes `webSurfaces`** and inspect's `slots` query returns it.

- [ ] **Step 4: Run**

- `node --test docs/examples/plugins/web-surface-demo/index.test.js`
- `npm test --prefix gateway -- tests/integration/plugin-web-surface.test.ts --runInBand --forceExit`

- [ ] **Step 5: Commit**

```bash
git add docs/examples/plugins/web-surface-demo docs/guides/plugin-authoring.md docs/guides/plugin-creator.md src/tools/plugin-inspect.ts gateway/tests/integration/plugin-web-surface.test.ts
git commit -m "feat(plugins): web surface demo and authoring docs"
```

---

## Final verification (run before claiming done)

```bash
npm test --prefix gateway -- --runInBand --forceExit
npm test -w @mafw/desktop
npm test -w @mafw/sdk
npm test -w @mafw/session-ui
node --test packages/plugin-contract/src/validate.test.ts
npx tsgo --noEmit -p packages/desktop/tsconfig.json
cd gateway && npx tsc --noEmit -p tsconfig.json
cd packages/desktop && npx electron-vite build
```

Live smoke (dev app + CDP 9222): install `web-surface-demo` from `docs/examples/plugins/web-surface-demo`, verify the left-rail entry, open the workbench tab, file tree lists the project, terminal echoes, action refreshes the view, edit the package to trigger reload, remove the package to close the tab. Record screenshots under `.mafw/qa/plugin-web-surfaces-*.png`.

## Self-review notes

- Spec §5.1–5.9 → Tasks 1–6; §6.1–6.5 → Tasks 7–9; §9 → Task 10; §11 → tests in each task + Task 10 integration + final smoke.
- Types are consistent: `PluginWebSurfaceView.surfaceId` is the only id used by rail/workbench; `PluginHttpApi` is the only `ctx.http` shape.
- Deferred by design: `ctx.files` writes/git, plugin-defined extension points, market/git install, HMR, Creator web scaffold (P2/P3 in the spec).
