# Browser Multi-Tab + Link Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route desktop external links into the right-dock browser, and turn that browser into a multi-tab surface where external links open a new tab.

**Architecture:** A shared link policy decides dock/external/deny; main-window and guest-window handlers forward dockable URLs through `browser-open-url`. The renderer keeps a module-level browser tab store, while `BrowserDock` mounts one persistent webview per tab and uses `TabsV2` pill triggers for the tab strip.

**Tech Stack:** Electron, SolidJS, `@mafw/ui/v2` (`TabsV2`, `ButtonV2`, `TextInputV2`), Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-29-browser-tabs-link-routing-design.md`

## Global Constraints

- `http(s)` / `mafw-file` may enter the workbench browser; `mailto:` / `tel:` use the OS; all other protocols are denied and never passed to `shell.openExternal`.
- External links default to a **new tab** and auto-switch to `工作台 › 浏览器`; current tab is not overwritten.
- Right-dock collapse keeps the tab list in-session; webviews are recreated on reopen (page state resets). Cross-app restart does not restore tabs.
- Non-chat views send links to the system browser.
- Use `TabsV2` `variant="pill"`; do not add bare buttons or a custom tab primitive.
- Existing webview security baseline must not change: permission deny, no preload, sandbox, no node integration, `persist:workbench-browser`.

## Review Focus

- External links from markdown/tool cards must not create an Electron window or replace the current browser tab.
- Plain links inside the browser guest must stay in the active tab; `target=_blank` must create a new tab.
- Dangerous protocols must never reach `shell.openExternal` or a webview.
- Closing the active tab must never leave a blank active state while other tabs remain.
- `data:image/*` previews must keep working through an in-app lightbox after data: window-open is denied.

---

### Task 1: Browser tab pure model + module store

**Files:**
- Create: `packages/desktop/src/renderer/mafw/browser-tabs.ts`
- Create: `packages/desktop/src/renderer/mafw/browser-tabs.test.ts`

**Interfaces:**
- Produces:
  - `type BrowserTab = { id: string; url: string; title: string; loading: boolean; canBack: boolean; canForward: boolean; failed?: string }`
  - `createBrowserTab(url: string, id: string, title?: string): BrowserTab`
  - `nextBrowserTabAfterClose(tabs: BrowserTab[], activeId: string | null, closingId: string): string | null`
  - `browserTabTitle(tab: BrowserTab): string`
  - `BROWSER_TAB_LIMIT = 12`
  - module store: `browserTabs()`, `activeBrowserTabId()`, `setActiveBrowserTab(id)`, `openBrowserTab(url, opts?)`, `closeBrowserTab(id)`, `updateBrowserTab(id, patch)`, `resetBrowserTabsForTests()`.
- Store behavior: `openBrowserTab(url, { newTab: true })` appends; `newTab: false` updates the active tab (creates one if none). Closing active selects left neighbor, then right, then `null`. More than 12 tabs throws/returns `null`; caller shows toast.

- [ ] **Step 1: Write the failing test**

```ts
test("new tabs append, current-tab updates, close picks left neighbor", () => {
  resetBrowserTabsForTests()
  const a = openBrowserTab("https://a.example", { newTab: true })!
  const b = openBrowserTab("https://b.example", { newTab: true })!
  assert.equal(browserTabs().length, 2)
  assert.equal(activeBrowserTabId(), b.id)
  openBrowserTab("https://c.example", { newTab: false })
  assert.equal(browserTabs()[1].url, "https://c.example")
  closeBrowserTab(b.id)
  assert.equal(activeBrowserTabId(), a.id)
})

test("title falls back to host, then 新标签页; limit is 12", () => {
  assert.equal(browserTabTitle(createBrowserTab("https://x.example/a", "t1")), "x.example")
  assert.equal(browserTabTitle(createBrowserTab("", "t2")), "新标签页")
  for (let i = 0; i < 12; i++) openBrowserTab(`https://${i}.example`, { newTab: true })
  assert.equal(openBrowserTab("https://overflow.example", { newTab: true }), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/browser-tabs.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement the model/store in `browser-tabs.ts`**

Use `createSignal` for `BrowserTab[]` and `activeId`. Keep IDs deterministic in tests via an injected `id` for `createBrowserTab`; the store may use a module counter `browser-tab-<n>` unless `opts.id` is passed. `browserTabTitle` returns `tab.title.trim() || new URL(tab.url).host || "新标签页"` with a try/catch for invalid/empty URLs.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/browser-tabs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/browser-tabs.ts packages/desktop/src/renderer/mafw/browser-tabs.test.ts
git commit -m "feat(desktop): browser tab model and store"
```

---

### Task 2: Shared browser link policy

**Files:**
- Modify: `packages/desktop/src/shared/browser-policy.ts`
- Modify: `packages/desktop/src/shared/browser-policy.test.ts`

**Interfaces:**
- Produces:
  - `type BrowserLinkAction = { action: "allow" } | { action: "dock"; url: string } | { action: "external"; url: string } | { action: "deny" }`
  - `browserLinkAction(url: string, currentUrl: string): BrowserLinkAction`
- Consumes `windowOpenDecision` and `MAFW_FILE_SCHEME`.

- [ ] **Step 1: Write the failing test**

```ts
test("browserLinkAction: app-internal allow, http dock, mail external, dangerous deny", () => {
  assert.deepEqual(browserLinkAction("http://localhost:5173/foo", "http://localhost:5173/bar"), { action: "allow" })
  assert.deepEqual(browserLinkAction("https://example.com", "oc://renderer/index.html"), { action: "dock", url: "https://example.com" })
  assert.deepEqual(browserLinkAction("mailto:a@b.com", "oc://renderer/index.html"), { action: "external", url: "mailto:a@b.com" })
  assert.deepEqual(browserLinkAction("javascript:alert(1)", "oc://renderer/index.html"), { action: "deny" })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/shared/browser-policy.test.ts`
Expected: FAIL（`browserLinkAction` 不存在）

- [ ] **Step 3: Implement `browserLinkAction`**

Use `new URL` parsing; same-origin compares protocol + host + port. Treat `oc:` as app-internal regardless of host. Otherwise map `windowOpenDecision`: navigate → `dock`, external → `external`, deny → `deny`.

- [ ] **Step 4: Run test to verify it passes**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/shared/browser-policy.ts packages/desktop/src/shared/browser-policy.test.ts
git commit -m "feat(desktop): browser link routing policy"
```

---

### Task 3: Main-window and guest link interception

**Files:**
- Modify: `packages/desktop/src/main/windows.ts`
- Modify: `packages/desktop/src/main/browser-session.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/renderer/mafw/browser-nav.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/BrowserDock.tsx`（只移除直接 `onOpenUrl` 订阅；单 tab 暂留）
- Modify: `packages/desktop/tests/workbench-browser-wiring.test.ts`

**Interfaces:**
- `BrowserOpenRequest = { url: string; newTab: boolean }`
- preload `browser.onOpenUrl(cb: (req: BrowserOpenRequest) => void): () => void`
- `requestBrowserNavigate(url: string, opts?: { newTab?: boolean }): void`
- `BrowserNavRequest = { url: string; newTab: boolean; at: number }`

- [ ] **Step 1: Write failing source/behavior tests**

```ts
test("main window routes external links to the dock", () => {
  const src = read("src/main/windows.ts")
  assert.match(src, /setWindowOpenHandler/)
  assert.match(src, /will-navigate/)
  assert.match(src, /browser-open-url/)
  assert.match(src, /browserLinkAction/)
})

test("shell owns browser-open-url and requests a new tab", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /browser\.onOpenUrl/)
  assert.match(shell, /requestBrowserNavigate\(.*newTab:\s*true/)
  assert.match(shell, /openWorkbenchSurface\("browser"\)/)
  assert.doesNotMatch(read("src/renderer/mafw/components/BrowserDock.tsx"), /browser\.onOpenUrl/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test tests/workbench-browser-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement main/preload/shell routing**

- In `windows.ts`, after `wireWebviewAttach(win.webContents)`: install `setWindowOpenHandler` and `will-navigate` using `browserLinkAction`, `win.webContents.send("browser-open-url", { url, newTab: true })`, and `shell.openExternal` only for `external`. `allow` for `will-navigate`; `allow` for `setWindowOpenHandler` becomes `deny`.
- In `browser-session.ts`, change guest window-open payload to `{ url: decision.url, newTab: true }`.
- In preload, accept `string | BrowserOpenRequest`, normalize string to `{ url, newTab: true }`; update types.
- In `browser-nav.ts`, add `newTab` to request with default `false`.
- In `MafwShell.tsx`, add one `onMount` subscription:
  ```ts
  const off = window.api.browser.onOpenUrl((req) => {
    if (!chatActive()) { void window.api.browser.openExternal(req.url); return }
    requestBrowserNavigate(req.url, { newTab: req.newTab })
    openWorkbenchSurface("browser")
  })
  onCleanup(off)
  ```
  Place after `chatActive` and `openWorkbenchSurface` are defined.
- Remove `onOpenUrl` subscription from `BrowserDock`; keep its `onMount` cleanup for the active view.
- `BrowserDock`'s browser-nav effect stays single-tab for this task; it may ignore `newTab`.

- [ ] **Step 4: Run tests + typecheck**

Run:
```bash
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/workbench-browser-wiring.test.ts src/shared/browser-policy.test.ts
npx tsgo --noEmit -p tsconfig.json
```
Expected: PASS / rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/windows.ts packages/desktop/src/main/browser-session.ts packages/desktop/src/preload/index.ts packages/desktop/src/preload/types.ts packages/desktop/src/renderer/mafw/browser-nav.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/BrowserDock.tsx packages/desktop/tests/workbench-browser-wiring.test.ts
git commit -m "feat(desktop): route external links into workbench browser"
```

---

### Task 4: BrowserDock multi-tab UI

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/BrowserDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/tests/browser-tabs-wiring.test.ts`

**Interfaces:**
- Consumes `browserTabs` store and `requestBrowserNavigate` request.
- `BrowserDock` owns `Map<tabId, webview>` and one `.mafw-browser-tab-pane` per tab.
- Uses `TabsV2` `variant="pill"`, `TabsV2.List`, `TabsV2.Trigger`, `TabsV2.CloseButton`, `onMiddleClick`.
- On mount, create views for existing tabs with URLs; on unmount, remove views but keep store tabs.

- [ ] **Step 1: Write failing wiring tests**

```ts
test("BrowserDock uses pill tabs and keeps one webview per tab", () => {
  const src = read("src/renderer/mafw/components/BrowserDock.tsx")
  assert.match(src, /TabsV2/)
  assert.match(src, /variant="pill"/)
  assert.match(src, /TabsV2\.CloseButton/)
  assert.match(src, /browserTabs\(\)/)
  assert.match(src, /Map<string, any>/)
  assert.doesNotMatch(src, /<TabsV2\.Content/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test tests/browser-tabs-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: Refactor BrowserDock**

- Replace single `address/title/loading/view` state with active-tab-derived accessors.
- Tab bar: `TabsV2` controlled by `activeBrowserTabId()`, one trigger per tab; close button; `+` `ButtonV2` calls `openBrowserTab("", { newTab: true })`.
- Address row: back/forward/reload, `TextInputV2`, external open, pick. All use active tab's view.
- Create a `.mafw-browser-view-host` child per tab; append webview; set `display` on active pane. Keep inactive webviews mounted.
- `load(raw, { newTab })`: normalize/decision; external → system; new tab → `openBrowserTab`; else update active tab; ensure view exists and `loadURL`/`src`.
- On tab state updates (`did-navigate`, `page-title-updated`, loading, failure), call `updateBrowserTab`.
- Closing active tab uses `nextBrowserTabAfterClose`; remove its webview; if no tabs show `DockEmpty`.
- Keep existing capture/pick/context-menu logic but target active view.
- Add CSS for tab bar/panes; use v2 tokens.

- [ ] **Step 4: Run tests + full desktop suite**

Run:
```bash
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/browser-tabs-wiring.test.ts
npm test
npx tsgo --noEmit -p tsconfig.json
```
Expected: PASS / PASS / rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/BrowserDock.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/browser-tabs-wiring.test.ts
git commit -m "feat(desktop): multi-tab workbench browser"
```

---

### Task 5: In-app image lightbox for data:image links

**Files:**
- Create: `packages/desktop/src/renderer/mafw/image-lightbox.ts`
- Create: `packages/desktop/src/renderer/mafw/components/ImageLightbox.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（挂载 overlay）
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/python.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx`
- Create: `packages/desktop/tests/image-lightbox-wiring.test.ts`

**Interfaces:**
- `openImageLightbox(url: string): void`
- `closeImageLightbox(): void`
- `imageLightboxUrl(): string | null`
- `ImageLightbox` renders a fixed overlay with `<img>`; Esc/backdrop closes.

- [ ] **Step 1: Write failing tests**

```ts
test("data image anchors open the app lightbox", () => {
  assert.match(read("src/renderer/mafw/components/tool-cards/python.tsx"), /openImageLightbox/)
  assert.match(read("src/renderer/mafw/components/UserPluginCards.tsx"), /openImageLightbox/)
  assert.match(read("src/renderer/mafw/MafwShell.tsx"), /<ImageLightbox/)
})
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test tests/image-lightbox-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

Python/plugin image anchors call `event.preventDefault(); openImageLightbox(url)`. Plugin `link` widget uses `openImageLightbox` only when `href.startsWith("data:image/")`; other links keep default (main routes http(s) to dock). Add overlay CSS using `--bg-float`, `--shadow-float`.

- [ ] **Step 4: Verify**

Run test + `npm test` + typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/image-lightbox.ts packages/desktop/src/renderer/mafw/components/ImageLightbox.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/tool-cards/python.tsx packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx packages/desktop/tests/image-lightbox-wiring.test.ts
git commit -m "feat(desktop): in-app image lightbox"
```

---

### Task 6: Final integration, docs, and full gates

**Files:**
- Modify: `packages/desktop/tests/design-contract.test.ts`（BrowserDock 不再是 DockPanelHeader 面板）
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-10-29-browser-tabs-link-routing-design.md`（状态 + 实现 commit）
- Test: full desktop suite, typecheck, build

- [ ] **Step 1: Update design-contract expectations**

Remove `BrowserDock.tsx` from the `DockPanelHeader` panels list; add a browser-specific contract:
```ts
expect(read("src/renderer/mafw/components/BrowserDock.tsx")).toContain("TabsV2")
expect(css).toContain(".mafw-browser-tabbar")
```

- [ ] **Step 2: Full gates**

```bash
cd packages/desktop
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```

- [ ] **Step 3: Document**

Add AGENTS.md §5.5 bullet: browser multi-tab, link routing, known limitations (OAuth popup / dock-close page state reset), test count, commits.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/tests/design-contract.test.ts AGENTS.md docs/superpowers/specs/2026-10-29-browser-tabs-link-routing-design.md
git commit -m "docs(desktop): browser tabs and link routing delivery notes"
```

## Self-Review

- Spec §3/§4 → Tasks 2/3; §5 → Task 4; §6 → Tasks 1-4; §7 → Tasks 2/3; §8 → Tasks 1-5; §9 → Task 6.
- Type names: `BrowserLinkAction`, `BrowserOpenRequest`, `BrowserTab`, `BrowserNavRequest` used consistently.
- Test ownership: link policy Task 2; routing Task 3; tab store Task 1; BrowserDock TabsV2 Task 4; data:image Task 5; final contracts Task 6.
- Known sequencing: Task 3 leaves BrowserDock single-tab temporarily; Task 4 replaces it with multi-tab. Each intermediate commit keeps `npm test` green.
