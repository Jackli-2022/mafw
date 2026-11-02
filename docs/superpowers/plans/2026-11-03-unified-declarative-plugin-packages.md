# Unified Declarative Plugin Packages (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one gateway-hosted plugin package format with declarative Desktop panels, config pages, tool cards, message windows, plugin actions/events, and atomic hot reload.

**Architecture:** `PluginHost` activates one trusted CJS entry per package inside gateway, validates all contributions, and publishes an opaque revision plus a sanitized `PluginClientDescriptor`. Desktop stores descriptors, renders only the shared `@mafw/plugin-contract` DTO, and invokes gateway actions through authenticated SDK/preload methods. File changes stage a candidate package; successful candidates are committed atomically, while failures keep the old active revision.

**Tech Stack:** TypeScript, Node CJS gateway, Jest, SolidJS desktop, Electron preload/IPC, `node:test`, Ajv, JSON Schema, SSE.

**Spec:** `docs/superpowers/specs/2026-11-03-unified-declarative-plugin-packages-design.md`

## Global Constraints

- Gateway Host code is trusted local CJS and runs in-process; Desktop never receives or executes plugin Host code.
- One unified `plugin.json + index.js` package, one `activate(ctx)` result, one RegistrationBag, one lifecycle; no separate Desktop plugin entry.
- Native runtime events still pass only through the existing mapper/tool-assembler/facade chain. Unified plugin events must be registered `plugin:<package>:<event>` names; canonical names are rejected.
- Desktop business UI must not branch on `runtimeName`, runtime capability flags, or native runtime DTOs.
- Use `@mafw/plugin-contract` as the single source for plugin DTOs, Widget/View validation, limits, and config form schema subset.
- Action input/output schemas use standard JSON Schema through Ajv; config pages use the restricted form subset only.
- Revision is opaque `<gatewayBootId>:<counter>`. Never treat it as a persistent integer.
- Unchanged packages are not reactivated. Candidate failure keeps the old active instance.
- Active-runtime changes remain pending until explicit apply; never interrupt a busy runtime automatically.
- Panels are individual workbench L2 tabs. Message windows live inside the main MAFW window, never separate BrowserWindows.
- Host actions have AbortSignal, timeout, output-size cap, and request-generation checks. A removed package cannot complete late into the new revision.
- Use existing MAFW UI components (`ButtonV2`, `TextInputV2`, `SwitchV2`, `SelectV2`, `TooltipV2`, `LoaderV2`, `ToastV2`) and design tokens.
- Every task ends with focused tests green and a commit. Final delivery reports new test count and full-suite counts.

## Review Focus

- A gateway restart must invalidate old Desktop revisions even when the counter repeats; stale action responses must not overwrite new views.
- Editing one package must not reactivate unrelated packages or clear their timers, caches, and scroll state.
- A failed candidate must leave the previous active package fully usable, including its panel, tool card, message window, actions, and events.
- Disable/delete must close open message windows, remove panel tabs/tool-card proxies/config pages, and restore built-in UI.
- Changing the active runtime package while a session is busy must produce pending state, not a silent runtime switch or partial UI update.

---

### Task 1: Shared Plugin Contract Package

**Files:**
- Create: `packages/plugin-contract/package.json`
- Create: `packages/plugin-contract/tsconfig.json`
- Create: `packages/plugin-contract/src/types.ts`
- Create: `packages/plugin-contract/src/limits.ts`
- Create: `packages/plugin-contract/src/validate.ts`
- Create: `packages/plugin-contract/src/index.ts`
- Create: `packages/plugin-contract/src/validate.test.ts`
- Modify: `package.json` (workspace build order and packed files)
- Modify: `packages/gateway-sdk/package.json` (workspace dependency)
- Modify: `packages/desktop/package.json` (workspace dependency)

**Interfaces:**
- Produces: `PLUGIN_UI_LIMITS`, `PluginClientDescriptor`, `PluginUiContribution`, `PluginPanelDescriptor`, `PluginToolCardDescriptor`, `PluginConfigPageDescriptor`, `PluginMessageWindowDescriptor`, `PluginActionDescriptor`, `PluginEventDescriptor`, `PluginView`, `Widget`, `PluginJsonSchema`
- Produces: `validateClientDescriptor(value: unknown): { ok: true; value: PluginClientDescriptor } | { ok: false; error: string }`
- Produces: `normalizePluginView(value: unknown): PluginView | null`
- Produces: `validateConfigFormSchema(value: PluginJsonSchema): string[]`
- Limits: max 256 widgets, depth 12, text 64 KiB, image data URL 2 MiB, tool/action payload 256 KiB, default action timeout 15s, max 60s.

- [ ] **Step 1: Write failing contract tests**

Add tests that construct one descriptor with a panel, config page, tool card, message window, action event and action widget; assert it validates. Add cases for unknown slot, cross-package action reference, unknown event reference, depth > 12, > 256 nodes, 64 KiB text overflow, invalid config field kind, and an image URL that is not `data:image/*`.

- [ ] **Step 2: Run the tests and verify failure**

Run in `packages/plugin-contract`: `node --test src/validate.test.ts`
Expected: FAIL because the package and exports do not exist.

- [ ] **Step 3: Implement the package and validator**

Use hand-written structural validation with no DOM/Electron/gateway imports. `normalizePluginView` sanitizes known widgets and rejects over-limit input rather than truncating silently. Export all types and validators from `src/index.ts`. Set `main` to `dist/index.js`, `types` to `dist/index.d.ts`, add a `build` script, and add the package to root build order before gateway and SDK.

- [ ] **Step 4: Verify package tests, build, and imports**

Run: `node --test src/validate.test.ts` — PASS.
Run: `npm run build -w @mafw/plugin-contract` — exit 0.
Run: `node -e "console.log(Object.keys(require('./packages/plugin-contract/dist/index.js')))"` — includes validator exports.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-contract package.json packages/gateway-sdk/package.json packages/desktop/package.json
git commit -m "feat(plugin-contract): add shared plugin DTO validators"
```

### Task 2: Gateway Contribution Validation and Lifecycle Bag

**Files:**
- Create: `gateway/src/plugins/registration-bag.ts`
- Create: `gateway/src/plugins/package-validator.ts`
- Create: `gateway/tests/unit/plugins/registration-bag.test.ts`
- Create: `gateway/tests/unit/plugins/package-validator.test.ts`
- Modify: `gateway/src/plugins/package-types.ts`
- Modify: `gateway/src/plugins/package-context.ts`
- Modify: `gateway/package.json` (Ajv dependency)
- Modify: `gateway/src/index.ts` (inject config updater into package context)

**Interfaces:**
- Produces: `createRegistrationBag(): RegistrationBag` with `add(name, dispose)`, `effect(dispose)`, `dispose()`; `dispose()` is idempotent and LIFO.
- Produces: `PluginActionDeclaration`, `PluginEventDeclaration`, `UnifiedPluginContributions`, `ActivatedContributions`
- Produces: `validateUnifiedContributions(name, contributions, canonicalTypes): string[]`
- Produces: `ctx.config.update(patch: Record<string, unknown>): void` limited to the current package namespace.
- `PluginPackageContext.pluginConfig()` must read fresh config on every call.

- [ ] **Step 1: Write failing lifecycle and validation tests**

Bag tests: LIFO order, idempotent double dispose, failed disposer does not block later cleanup, every added disposer can attach diagnostics. Validation tests: only `plugin:<package>:*` events; canonical event rejected; action/UI references resolve; config form subset accepted; malformed action handler rejected; live `pluginConfig()` changes after config update.

- [ ] **Step 2: Run tests and verify failure**

Run in `gateway`: `npx jest --runInBand tests/unit/plugins/registration-bag.test.ts tests/unit/plugins/package-validator.test.ts`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement bag, contribution types, validator, config update**

`validateUnifiedContributions` runs after `activate()` returns and before any publication. It validates events/actions/UI against `@mafw/plugin-contract`, rejects cross-refs, and returns human-readable diagnostics rather than throwing per field. `ctx.config.update` must merge under `plugins.<package>.config` and call the injected `config.persistOverrides`; it never permits arbitrary top-level keys.

- [ ] **Step 4: Verify focused tests and typecheck**

Run both Jest files — PASS.
Run in `gateway`: `npx tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins gateway/tests/unit/plugins gateway/package.json gateway/src/index.ts
git commit -m "feat(gateway): validate unified plugin contributions"
```

### Task 3: PluginHost Fingerprints, Staging, Revisions, and Atomic Commit

**Files:**
- Create: `gateway/src/plugins/package-fingerprint.ts`
- Create: `gateway/src/plugins/package-fingerprint.test.ts`
- Create: `gateway/src/plugins/client-descriptor.ts`
- Create: `gateway/src/plugins/client-descriptor.test.ts`
- Modify: `gateway/src/plugins/package-host.ts`
- Modify: `gateway/src/plugins/package-types.ts`
- Modify: `gateway/src/index.ts` (host wiring and snapshot callback)
- Modify: existing PluginHost tests under `gateway/tests/unit/plugins/`

**Interfaces:**
- Produces: `fingerprintPackage(mainFile: string): string`; ignores `node_modules`, `.git`, `.plugin-manager`, logs and temp files.
- Produces: `PluginHost.getClientSnapshot(): { revision: string; plugins: PluginClientDescriptor[] }`
- Produces: `PluginHost.getPending(name): { revision: string; error?: string } | null`
- Produces: `PluginHost.applyPending(name): Promise<{ applied: boolean; revision?: string; error?: string }>`
- Produces: callbacks `onSnapshot(snapshot)` and `onStateChanged()`.
- Host constructor remains compatible for legacy loaders; new options are optional deps.

- [ ] **Step 1: Write failing fingerprint, descriptor, and host tests**

Cover: unchanged fingerprint reuses the same activation object and does not call `activate()` again; changed package gets a new revision; failed candidate leaves old descriptor; two changed packages commit in one snapshot; unrelated package revision unchanged; revision has a new bootId after a new host instance; delete removes descriptor.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx jest --runInBand tests/unit/plugins/package-fingerprint.test.ts tests/unit/plugins/client-descriptor.test.ts tests/unit/plugins/package-host.test.ts`
Expected: FAIL on missing APIs and reactivation behavior.

- [ ] **Step 3: Implement staging and atomic publication**

Scan descriptors, compute fingerprints, and carry unchanged active packages forward. Activate only new/changed candidates into private RegistrationBags. Dispose replaced packages only during commit, then publish one immutable snapshot and increment `<bootId>:<counter>`. A failed candidate is recorded in package state but never replaces the active descriptor. Make cache invalidation cover the package's local module subtree only.

- [ ] **Step 4: Verify focused tests and gateway typecheck**

Run the three Jest files — PASS.
Run in `gateway`: `npx tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins gateway/tests/unit/plugins gateway/src/index.ts
git commit -m "feat(gateway): stage plugin packages by fingerprint"
```

### Task 4: Plugin Actions and Registered Events

**Files:**
- Create: `gateway/src/plugins/plugin-actions.ts`
- Create: `gateway/src/plugins/plugin-events.ts`
- Create: `gateway/tests/unit/plugins/plugin-actions.test.ts`
- Create: `gateway/tests/unit/plugins/plugin-events.test.ts`
- Modify: `gateway/src/plugins/package-host.ts`
- Modify: `gateway/src/plugins/package-context.ts`
- Modify: `gateway/src/plugins/package-types.ts`

**Interfaces:**
- Produces: `PluginActionRegistry.register(packageName, actions, bag, validator)`
- Produces: `PluginActionRegistry.invoke(packageName, action, input, { sessionID?, signal? }): Promise<unknown>`
- Produces: `PluginEventRegistry.register(packageName, declarations, bag)`
- Produces: `PluginEventRegistry.emit(packageName, eventType, properties, sessionID?): { ok: boolean; error?: string }`
- `ctx.emit` becomes a package-scoped wrapper; unregistered/canonical events return no broadcast and increment diagnostics.

- [ ] **Step 1: Write failing action/event tests**

Actions: input schema rejection before handler, output schema rejection, timeout abort, unload abort, unknown action 404-like error, successful output preserved. Events: registered event broadcasts once, schema failure drops, `turn.completed` spoof rejected, another package's namespace rejected, package unload makes late emits no-op.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx jest --runInBand tests/unit/plugins/plugin-actions.test.ts tests/unit/plugins/plugin-events.test.ts`
Expected: FAIL because registries do not exist.

- [ ] **Step 3: Implement registries and host wiring**

Compile action schemas with Ajv once per revision; support only draft 2020-12 schemas without remote `$ref`. Wrap handler invocation with timeout, AbortSignal, payload caps, and revision capture. Wrap `ctx.emit` to call the event registry. Publish `plugins.changed` separately through the gateway broadcast when the host snapshot commits.

- [ ] **Step 4: Verify focused tests and full gateway plugin suites**

Run the two files — PASS.
Run: `npx jest --runInBand tests/unit/plugins` — PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins gateway/tests/unit/plugins
git commit -m "feat(gateway): add plugin actions and registered events"
```

### Task 5: Package Manager Filesystem Operations and Pending Apply

**Files:**
- Create: `gateway/src/plugins/package-state-store.ts`
- Create: `gateway/src/plugins/package-manager.ts`
- Create: `gateway/tests/unit/plugins/package-state-store.test.ts`
- Create: `gateway/tests/unit/plugins/package-manager.test.ts`
- Modify: `gateway/src/plugins/package-host.ts`
- Modify: `gateway/src/index.ts`

**Interfaces:**
- Produces: `PackageStateStore(dir)` with `read()`, `isDisabled(name)`, `setDisabled(name, disabled)`, atomic persistence to `~/.mafw/plugin-package-state.json`.
- Produces: `PackageManager.installFromPath({ path, overwrite, requestId }): Promise<InstallResult>`
- Produces: `PackageManager.checkPath(path): Promise<CheckResult>`
- Produces: `PackageManager.enable(name)`, `disable(name)`, `remove(name)`, `reload(name)`, `applyPending(name)`.
- Produces: `InstallResult { name, version, activeRevision?, pendingRevision?, saved, application: 'applied'|'pending'|'failed', error? }`

- [ ] **Step 1: Write failing manager tests**

Cover: absolute source path only; source must contain matching `plugin.json`; atomic directory copy; overwrite refused without flag; traversal/absolute destination rejected; disable state persists across new store instance; remove disposes package then recursively deletes only inside plugin root; check activates and disposes without changing client revision; active-runtime change returns pending; applyPending commits and changes revision.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx jest --runInBand tests/unit/plugins/package-state-store.test.ts tests/unit/plugins/package-manager.test.ts`
Expected: FAIL because manager APIs are missing.

- [ ] **Step 3: Implement state store and manager**

Use temp path + rename for state JSON and install copies. Resolve and validate every source/destination with realpath and containment. Disabled packages remain installed but are skipped by the host. Owner changes that include an active runtime are staged and returned as pending; do not call runtime switch from this task.

- [ ] **Step 4: Verify focused tests and plugin suite**

Run both Jest files — PASS.
Run: `npx jest --runInBand tests/unit/plugins` — PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/plugins gateway/tests/unit/plugins gateway/src/index.ts
git commit -m "feat(gateway): manage unified plugin packages"
```

### Task 6: REST Routes, Route Catalog, SDK, and Preload

**Files:**
- Create: `gateway/src/routes/plugin-packages.ts`
- Create: `gateway/tests/unit/routes/plugin-packages.test.ts`
- Modify: `gateway/src/routes/plugins.ts`
- Modify: `gateway/src/routes/wave2-handlers.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/index.ts` (deps and handlers)
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/events.ts`
- Modify: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/main/mafw-ipc.ts`

**Interfaces:**
- Produces HTTP: `GET /api/plugins/client`, `POST /api/plugins/packages/install`, `POST /api/plugins/check`, `POST /api/plugins/:name/apply`, `POST /api/plugins/:name/reload`, `POST /api/plugins/:name/actions/:action`.
- Extends `POST /api/plugins/{enable,disable,delete}` bodies with `{ package: string }` while preserving `{ type, filename }`.
- SDK: `plugins.client()`, `plugins.installPackage({ path, overwrite?, requestId? })`, `plugins.check({ path })`, `plugins.apply(name)`, `plugins.reload(name)`, `plugins.invoke(name, action, input, sessionID?)`, `plugins.enablePackage/disablePackage/removePackage`.
- Preload exposes only these named methods; no generic invoke.

- [ ] **Step 1: Write failing route and SDK tests**

Route tests: success and error mapping for each endpoint; package-mode enable/disable/delete; invalid JSON/body; action 404; stale package revision returns 409. SDK tests assert paths/methods/body and error text. Event union test asserts `plugins.changed` is a flat event.

- [ ] **Step 2: Run tests and verify failure**

Run in `gateway`: `npx jest --runInBand tests/unit/routes/plugin-packages.test.ts` — FAIL.
Run in `packages/gateway-sdk`: `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/client.test.ts` — FAIL on missing methods.

- [ ] **Step 3: Implement routes, catalog entries, SDK, and preload**

Add handlers through the existing registry dispatch. Validate bodies with the same manager schemas. Include package name, revision, descriptors, and diagnostics in responses. Preserve legacy Hub behavior. Add `plugins.changed` to `FLAT_EVENT_TYPES` and the flat broadcast path. Regenerate OpenAPI with `npm run emit:openapi --prefix gateway`.

- [ ] **Step 4: Verify route/SDK tests and contract freshness**

Run focused Jest — PASS.
Run SDK test file — PASS.
Run: `npm run emit:openapi --prefix gateway` then `npm test --prefix gateway -- --runInBand tests/unit/routes/api-contract.test.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes gateway/tests/unit/routes packages/gateway-sdk packages/desktop/src/preload packages/desktop/src/main/mafw-ipc.ts
git commit -m "feat(plugins): expose unified package manager APIs"
```

### Task 7: Desktop Plugin Store and SSE Revision Router

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-store.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-store.test.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-client.ts`
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/plugins.ts`
- Create: `packages/desktop/src/renderer/mafw/sse/handlers/plugins.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`
- Modify: `packages/desktop/src/renderer/mafw/session-events.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts` or nearest existing test

**Interfaces:**
- Produces Solid signals: `pluginClientRevision()`, `pluginDescriptors()`, `pluginPending()`, `pluginDiagnostics()`
- Produces: `refreshPluginClient()`, `applyPluginClientSnapshot(snapshot, bootId?)`, `ingestPluginsChanged(event)`, `ingestPluginEvent(event)`
- Produces pure: `diffPluginDescriptors(prev, next)` returning `{ added, changed, removed, unchanged }`
- Dispatcher handles `plugins.changed` before session-id routing and routes `plugin:*` to the plugin event hub.

- [ ] **Step 1: Write failing store/router tests**

Cover: first snapshot builds baselines; same bootId/higher counter updates; new bootId with lower counter updates; unchanged descriptors preserve object identity; removed descriptors produce removal list; stale action response guard; `plugins.changed` triggers refresh once; registered plugin event reaches only its descriptor subscribers; unknown plugin event gets diagnostic and no crash.

- [ ] **Step 2: Run tests and verify failure**

Run in `packages/desktop`: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/plugins/plugin-store.test.ts src/renderer/mafw/sse/handlers/plugins.test.ts`
Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement store and dispatcher integration**

Store descriptors by package key and keep the active descriptor until a validated replacement arrives. Use a generation object `{ bootId, revision }`. `ingestPluginEvent` notifies subscription keys `package:event`; it never executes plugin code. Wire `MafwShell` `sseDeps.plugins` and call initial `refreshPluginClient()` on mount and reconnect.

- [ ] **Step 4: Verify focused tests, typecheck, and build**

Run focused desktop tests — PASS.
Run in `packages/desktop`: `npx tsgo --noEmit -p tsconfig.json` — exit 0.
Run: `npx electron-vite build` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/plugins packages/desktop/src/renderer/mafw/sse packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/session-events.ts
git commit -m "feat(desktop): track plugin revisions over SSE"
```

### Task 8: Declarative View Renderer and Dynamic Workbench Panels

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginViewRenderer.tsx`
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginPanelSurface.tsx`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-view-model.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-view-model.test.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginSurfaceHost.tsx`
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/shared/ui-plugins.ts` (re-export contract Widget types)

**Interfaces:**
- Produces: `PluginViewRenderer(props: { view: PluginView; onAction(action: string, input?: unknown): void })`
- Produces: `PluginPanelSurface(props: { descriptor: PluginClientDescriptor; panel: PluginPanelDescriptor; sessionID: string | null })`
- Produces pure: `pluginSurfaces(descriptors): Array<{ id: string; label: string; panel: PluginPanelDescriptor; descriptor: PluginClientDescriptor }>`
- Workbench surface type becomes `"code" | "browser" | "terminal" | `plugin:${string}``.
- `WorkbenchShell` receives `pluginSurfaces`; `WorkbenchCodeView` receives `renderPluginSurface(id)`.

- [ ] **Step 1: Write failing surface/model tests**

Cover stable sort by order/title/package, overflow list, delete active surface falls back to `code`, panel descriptor missing action excluded with diagnostic, unknown Widget becomes text fallback, `action` widget emits exact action/input, old revision fetch is discarded, panel refresh only on subscribed event.

- [ ] **Step 2: Run tests and verify failure**

Run in `packages/desktop`: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/plugins/plugin-view-model.test.ts src/renderer/mafw/workbench-views.test.ts`
Expected: FAIL on dynamic surfaces and missing helpers.

- [ ] **Step 3: Implement renderer and dynamic L2 surfaces**

Create the Widget interpreter from the shared contract, including the new `action` widget. Render plugin panels in the workbench and add their tabs after built-ins. Use an overflow menu when labels do not fit. Each panel fetches its `viewAction` with `{ input: {}, sessionID }`; subscribe to `refreshOn`. Store the response only when its bootId/revision still matches. On descriptor removal, unmount the panel and switch to `code` if active.

- [ ] **Step 4: Verify focused tests and desktop build**

Run focused tests — PASS.
Run: `npx tsgo --noEmit -p tsconfig.json` and `npx electron-vite build` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/plugins packages/desktop/src/renderer/mafw/workbench-views.ts packages/desktop/src/renderer/mafw/workbench-views.test.ts packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/shared/ui-plugins.ts
git commit -m "feat(desktop): render declarative plugin panels"
```

### Task 9: Declarative Config Pages

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginConfigPage.tsx`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-config-form.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-config-form.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/plugins/PluginSurfaceHost.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`

**Interfaces:**
- Produces pure: `initialFormValues(schema, loaded)`, `validateFormValues(schema, values)`, `formFields(schema)`
- Produces: `PluginConfigPage(props: { descriptor; page; sessionID? })`
- Save sequence: invoke `saveAction`, update local state, optionally invoke `plugins.reload(name)` when `reloadOnSave === true`, show toast on failure.

- [ ] **Step 1: Write failing form tests**

Cover text/number/boolean/select defaults, required validation, unknown field rejection, no secret field rendering, save success, `reloadOnSave` triggers exactly one reload, save failure keeps draft and displays error.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/plugins/plugin-config-form.test.ts`
Expected: FAIL because the form helpers do not exist.

- [ ] **Step 3: Implement config form and page**

Use the shared restricted schema. Build fields with `TextInputV2`, `SwitchV2`, `SelectV2`, and `ButtonV2`. Load via `plugins.invoke(name, loadAction)`, save via `saveAction`. Disable form while request is pending; discard responses from older revisions.

- [ ] **Step 4: Verify tests and typecheck**

Run focused test — PASS.
Run: `npx tsgo --noEmit -p tsconfig.json` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/plugins packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): render plugin config pages"
```

### Task 10: Unified Declarative Tool Cards

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-tool-card-model.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-tool-card-model.test.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginToolCard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/registered-tools.ts`

**Interfaces:**
- Produces pure: `toolCardModel(req: RenderRequest): { tool; canonicalTool?; input; output?; metadata?; status; truncated: boolean }`
- Produces: `effectiveToolCardTargets(descriptors, legacyEntries): { target; descriptor }[]`
- Tool declaration matches through `aliasKeys` and existing canonical-tool resolution; default only fills unoccupied tools, `override:true` may replace built-ins/legacy.

- [ ] **Step 1: Write failing model/conflict tests**

Cover alias matching (`mafw_search_hybrid`, `mafw_mafw_search_hybrid`), canonicalTool matching, payload truncation at 256 KiB with flag, running status does not invoke plugin, completed invokes once, legacy conflict without override keeps legacy, duplicate unified overrides reject later candidate, failure falls back to original card.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/plugins/plugin-tool-card-model.test.ts`
Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement proxy registration and rendering**

Reuse the restore-original/proxy pattern from `UserPluginCards.tsx`. Register unified cards through `ToolRegistry` after built-in MAFW cards, and reapply on plugin revision changes. Only invoke `viewAction` for completed/error parts; render through `PluginViewRenderer`; fall back fail-open.

- [ ] **Step 4: Verify tests and desktop build**

Run focused test — PASS.
Run: `npx tsgo --noEmit -p tsconfig.json` and `npx electron-vite build` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/plugins packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx packages/desktop/src/renderer/mafw/components/tool-cards/registered-tools.ts packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): render unified plugin tool cards"
```

### Task 11: Main-Window Message Windows

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-windows.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-windows.test.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginMessageWindow.tsx`
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginWindowHost.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/plugins/PluginViewRenderer.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css` or nearest plugin stylesheet

**Interfaces:**
- Produces pure: `openPluginWindow(state, { key, descriptor, declaration, event })`, `closePluginWindow(state, key)`, `applyWindowRevision(state, snapshot)`
- Window key: `<package>:<declaration.id>`; one instance per key, later triggers update it.
- `modal:false` does not steal focus; `modal:true` traps focus; dismissible windows close on Esc.

- [ ] **Step 1: Write failing window state tests**

Cover single instance update, multiple declarations, modal/modeless semantics flags, trigger event payload passed to `viewAction`, close button/Esc, disable/delete closes and releases focus, changed descriptor refetches, stale revision response discarded, unknown event ignored.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/plugins/plugin-windows.test.ts`
Expected: FAIL because state module does not exist.

- [ ] **Step 3: Implement window host and wire SSE**

Render in `MafwShell` above the main workspace, inside the application document. Each open window invokes the declaration's `viewAction` with `{ event: { type, properties }, sessionID }`. Render actions through `PluginViewRenderer`. Do not create BrowserWindow or change OS window state.

- [ ] **Step 4: Verify tests, typecheck, and build**

Run focused test — PASS.
Run: `npx tsgo --noEmit -p tsconfig.json` and `npx electron-vite build` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/plugins packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css
git commit -m "feat(desktop): add declarative plugin message windows"
```

### Task 12: Plugin Packages Management UI

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pages/PluginPackagesSection.tsx`
- Create: `packages/desktop/src/renderer/mafw/pages/plugin-packages-model.ts`
- Create: `packages/desktop/src/renderer/mafw/pages/plugin-packages-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Modify: `packages/desktop/src/main/mafw-ipc.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`

**Interfaces:**
- Produces IPC `mafw-plugins-choose-directory` returning `{ path: string | null }`, sender validated to main window.
- Produces section rows with active/pending/error/disabled states, revision, contributions, check/install/update/disable/delete/apply/reload/config actions.
- Adds install-from-directory and check preview before overwrite.

- [ ] **Step 1: Write failing UI model tests**

Cover status labels, contribution badges, pending apply visibility, failed candidate retaining active state, overwrite diff summary, disabled package actions, choose-directory cancellation, and delete confirmation requirements.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pages/plugin-packages-model.test.ts`
Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement management section and IPC picker**

Insert `PluginPackagesSection` into the existing Plugins nav before the legacy Hub groups. Use native directory selection only; never expose filesystem paths generically to renderer. Show package error, pending reason, active revision, contributions, and config/open-source actions. Use existing toast/confirmation patterns.

- [ ] **Step 4: Verify tests, typecheck, and build**

Run focused test — PASS.
Run: `npx tsgo --noEmit -p tsconfig.json` and `npx electron-vite build` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pages packages/desktop/src/main/mafw-ipc.ts packages/desktop/src/preload
git commit -m "feat(desktop): manage unified plugin packages"
```

### Task 13: Example Package, Author Guide, Packaging, and Full Verification

**Files:**
- Create: `docs/examples/plugins/service-monitor/plugin.json`
- Create: `docs/examples/plugins/service-monitor/index.js`
- Create: `docs/examples/plugins/service-monitor/index.test.js`
- Create: `docs/guides/plugin-authoring.md`
- Create: `gateway/tests/integration/plugin-package-e2e.test.ts`
- Modify: `gateway/scripts/deploy-local.mjs`
- Modify: `packages/desktop/scripts/stage-gateway.ts`
- Modify: root `package.json`, `gateway/package.json`, `packages/gateway-sdk/package.json`, `packages/desktop/package.json` for contract build/package wiring
- Modify: `.github/workflows/ci.yml` if package test/build order needs the new workspace

**Interfaces:**
- Example contributes: one `panel`, one `configPage`, one `toolCard`, one `messageWindow`, `refresh` action, `saveConfig` action, and `plugin:service-monitor:changed` event.
- Example uses only public contract and no third-party dependency.

- [ ] **Step 1: Write failing end-to-end test**

Use temporary plugin home and a fake broadcast sink. Install the example from its source directory, check it, assert validated descriptor, invoke panel/config actions, emit registered event, spoof `turn.completed` and assert no broadcast, modify panel title, reload, assert new revision, then disable/delete and assert no actions or events remain. Run it once with an active runtime fixture and assert pending until apply.

- [ ] **Step 2: Run test and verify failure**

Run in `gateway`: `npx jest --runInBand tests/integration/plugin-package-e2e.test.ts`
Expected: FAIL until example and wiring are complete.

- [ ] **Step 3: Implement example, docs, and packaging wiring**

Write the guide with package layout, contribution example, schemas, slots, event/action rules, hot reload, revision and security model. Update build order: plugin-contract before gateway/SDK/desktop. Root package must include `packages/plugin-contract/package.json` and `dist/`. `stage-gateway.ts` must copy the built contract package into `gateway-bundle/node_modules/@mafw/plugin-contract`; `deploy-local.mjs` must copy it to the target package's node_modules. Verify both paths resolve at runtime.

- [ ] **Step 4: Run full phase-1 verification**

Run:
- `npm run build -w @mafw/plugin-contract`
- `npm test --prefix gateway -- --runInBand`
- `npm test -w @mafw/sdk`
- `npm test -w @mafw/desktop`
- `npm test -w @mafw/session-ui`
- `npx tsc --noEmit` in `gateway`
- `npx tsgo --noEmit -p tsconfig.json` in `packages/desktop`
- `npx electron-vite build` in `packages/desktop`
- `npm run emit:openapi --prefix gateway`
- contract freshness tests

Expected: all pass; record exact new-test and total-suite counts.

- [ ] **Step 5: Commit**

```bash
git add docs/examples/plugins docs/guides/plugin-authoring.md gateway/tests/integration gateway/scripts/deploy-local.mjs packages/desktop/scripts/stage-gateway.ts package.json gateway/package.json packages/gateway-sdk/package.json packages/desktop/package.json .github/workflows/ci.yml
git commit -m "feat(plugins): ship unified declarative plugin example"
```

### Task 14: GUI Smoke and Phase-1 Acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-11-03-unified-declarative-plugin-packages-design.md` only if implementation reveals a genuine contract correction
- No product files unless smoke exposes a bug

- [ ] **Step 1: Run the real Desktop smoke**

Start gateway and Desktop dev app. Install `docs/examples/plugins/service-monitor` through Plugins → install from directory. Verify panel tab, config page, tool card, message window, action callback, registered event refresh, revision update after editing, failed candidate rollback, disable/delete cleanup, and legacy plugin regression. For message windows also verify: a modal window traps Tab/Shift+Tab and restores focus to the previously focused element on close; Esc closes a dismissible modal but is consumed without closing a non-dismissible one; Esc in a modeless window closes only when focus is inside it; with 3+ real-height modeless windows the capped stack scrolls and every close button stays reachable.

- [ ] **Step 2: Record evidence and any defects**

Capture the exact package revision before/after reload, failed-check error, and the restored built-in UI after delete. If a defect is found, write a failing test first, fix it, rerun Task 13 verification.

- [ ] **Step 3: Commit smoke fixes only when needed**

```bash
git add <changed-files>
git commit -m "fix(plugins): resolve phase-1 smoke findings"
```
