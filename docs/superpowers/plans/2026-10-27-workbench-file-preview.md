# Workbench 文件预览实施计划（inline TDD）

Spec：`docs/superpowers/specs/2026-10-27-workbench-file-preview-design.md`
调研：`docs/research/2026-10-27-workbench-file-preview-research.md`
执行方式：inline（本会话逐任务 RED→GREEN），直提 main。完成标准：全量测试绿 + tsgo rc=0 + electron-vite build rc=0 + GUI 冒烟。

## T1 纯函数地基：file-kind + 分流 + L2 改名

- `src/renderer/mafw/file-kind.ts`：
  - `type FileKind = "image" | "svg" | "html" | "text"`
  - `IMAGE_EXTS`（png/jpg/jpeg/gif/webp/ico/bmp/avif）
  - `fileKindFor(rel: string): FileKind`（大小写不敏感；无扩展名/点文件→text）
  - `fileOpenPlan(rel): "browser" | "editor"`（html/htm→browser）
- `workbench-views.ts`：`WORKBENCH_SURFACES` label `代码→文件`（id 保持 `"code"`）。
- RED：`file-kind.test.ts` 矩阵 + 更新 `workbench-views.test.ts` label 断言。
- 验证：`node --test src/renderer/mafw/file-kind.test.ts src/renderer/mafw/workbench-views.test.ts`。

## T2 mafw-file 共享纯逻辑（URL/MIME/解析）

- `src/shared/mafw-file.ts`：
  - `MAFW_FILE_SCHEME = "mafw-file"`
  - `buildMafwFileUrl(token, rel, version?): string`（rel 分段 encode；`?v=` 供图片刷新）
  - `parseMafwFileUrl(raw): { token, rel } | null`（忽略 query/hash；`..`/绝对/空段 → null）
  - `mimeForPath(rel): string`（图片八型 + svg + html/htm + css/js/mjs/json/map/woff/woff2/ttf/otf/mp4/webm/mp3/wav/txt；其余 octet-stream）
  - `tokenForRoot` 不放这里（main 侧随机生成）。
- RED：`tests/mafw-file.test.ts`——往返、traversal（`../`、`%2e%2e`、绝对路径）、未知/坏 URL、query 忽略、MIME 表。
- 验证：`node --test tests/mafw-file.test.ts`。

## T3 main 协议注册 + root registry + preload 暴露

- `src/main/mafw-file-protocol.ts`：
  - `createRootRegistry()`（token↔absRoot，幂等：同 root 复用 token；`clearRoot`）
  - `resolveMafwFileRequest(rawUrl, roots): { file, mime } | { status }`（纯函数，逃逸/未知 token/非本 scheme → 404）
  - `registerMafwFileProtocol(sessions, registry, io)`：对每个 session `protocol.handle` → `io.fetch(pathToFileURL(file))`（range 透传，镜像 `windows.ts` rendererProtocol）
- 接线：`windows.ts` `registerSchemesAsPrivileged` 增 `mafw-file`（standard/secure/supportFetchAPI/stream，ready 前）；ready 后对 **defaultSession + `session.fromPartition(BROWSER_PARTITION)`** 各注册一次；IPC `fs-register-root`（校验绝对路径/目录存在，返回 token）。
- preload：`window.api.fs.registerRoot(absDir): Promise<string>` + `types.ts`。
- RED：`mafw-file-protocol.test.ts`（resolve 纯函数矩阵 + 源码接线断言：双 session、privileged 列表）。
- 验证：`node --test src/main/mafw-file-protocol.test.ts`。

## T4 browser-policy 放行 mafw-file

- `shared/browser-policy.ts`：`navigationDecision`/`windowOpenDecision`/`isAllowedSrc` 增 `mafw-file:` → allow/navigate；`file:`/`data:`/`javascript:` 禁令不动。
- RED：新建 `tests/browser-policy.test.ts`（放行表 + 禁令表回归）。
- 验证：`node --test tests/browser-policy.test.ts`。

## T5 编辑器图片 tab + SVG 切换

- `editor-state.ts`：`OpenFile.kind`（默认 text）；`openFile` 增可选 `kind`；图片 tab 不变量（readOnly=true、非 dirty、无 savedContent 语义）。
- `EditorDock.tsx`：active kind 分流——image → `<img src={buildMafwFileUrl(token, rel, mtime)}>` 只读预览 + metadata（natural 尺寸/大小/相对路径）；svg → 头部「预览/源码」toggle（per-tab、内存）；外部变更 → 图片 reload（mtime 变化）。
- token 来源：renderer `file-protocol.ts` 单例（`ensureRootToken(root)` → 缓存 per-root；MafwShell 根变化时重置）。
- RED：editor-state kind 单测（openFile 不变量/root 变化清空）+ EditorDock/EditorDock 源码契约（image 分支、svg toggle）。
- 验证：`node --test src/renderer/mafw/editor-state.test.ts tests/file-preview-ui.test.ts`。

## T6 分流接线：MafwShell onOpenFile + html → browser

- `MafwShell.tsx` `onOpenFile`：`fileOpenPlan(rel)`：
  - `"editor"` → `requestOpenEditor(root, rel)` + `openWorkbenchSurface("code")`（现状）
  - `"browser"` → `ensureRootToken(root)` → `requestBrowserNavigate(buildMafwFileUrl(...))` + `openWorkbenchSurface("browser")`
- `browser-nav.ts`：`requestBrowserNavigate(url)` signal；BrowserDock `createEffect` 订阅 → `load(url)`。
- RED：`tests/file-open-plan-wiring.test.ts`（MafwShell 使用 fileOpenPlan/两分支；BrowserDock 订阅 store）。
- 验证：目标文件测试 + 全量。

## T7 地址栏友好显示

- `shared/browser-policy.ts` 或 `browser/address-display.ts`：`displayAddress(url)`——`mafw-file://` → `📄 <decoded rel>`，其余原样。
- BrowserDock `sync()`/`load()` 用 displayAddress 渲染地址栏（值仍存真实 URL）。
- RED：`tests/address-display.test.ts`。
- 验证：目标测试。

## T8 全量验证 + GUI 冒烟 + 记录

- `npm test`（desktop 全量）、`npx tsgo -b`、`npx electron-vite build`。
- GUI（dev app + CDP）：scratch 项目文件——`a.png`、`logo.svg`、`index.html`+`style.css`+`app.js`：
  1. png → 文件 tab 预览 + metadata；切走切回正常。
  2. svg → 源码；「预览」→ 图；「源码」→ 可编辑。
  3. html → 自动切浏览器、渲染、子资源加载、地址栏友好路径。
  4. 执行/审阅视图无回归；终端归属不受影响。
  5. 未知 token/逃逸 → 404（单测覆盖，GUI 抽查）。
- AGENTS.md 记交付（新增测试数/全量数/commits）+ 记忆指针。

## 风险位

- protocol 双 session 只挂一边 → webview 或 `<img>` 单边 404（T3 固定双注册 + 契约测试）。
- CSP：renderer `img-src` 需含 `mafw-file:`（dev 5173 与生产 rendererProtocol 两路都验，T8 冒烟覆盖）。
- 本地 HTML 脚本执行：partition 权限全拒不变；不向 `file:` 开口。
- rootToken 生命周期：root 切换注销旧 token（T3 registry + MafwShell effect）。
