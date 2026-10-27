# 工作台文件预览设计：文件 tab（图片/SVG）+ HTML 进浏览器

日期：2026-10-27
状态：已按用户裁决定稿（SVG 默认文本+预览动作；HTML 单 webview 导航；L2「代码」改名「文件」）
调研：`docs/research/2026-10-27-workbench-file-preview-research.md`（业界五家 + IDE 参照）
前序：本切片不改 dock 结构/档位/推挤规则（左 rail 线已定稿）；终端归属裁决（只属工作台视图）不受影响。

## 1. 目标 / 非目标

**目标**：
- G1：工作台 L2「代码」tab 改名「**文件**」——该 surface 不再只看代码（用户原话：变成文件 tab）。
- G2：图片文件（png/jpg/jpeg/gif/webp/ico/bmp/avif）在文件 surface 内开**只读预览 tab**（复用编辑器 tab 条）。
- G3：SVG **默认打开预览**（打开即看，2026-10-27 rev 用户裁决 + VS Code 1.97 默认；Zed 的文本默认是少数派且社区讨论 #52255 正在请求改预览），编辑器头部提供一键「源码」切换回文本编辑（比 VS Code 的 Reopen With 更轻）。
- G4：HTML/HTM 文件在**浏览器 surface** 打开（单 webview 导航 + 自动切 surface），经 `mafw-file://` 自定义协议——不向 `file://` 开口子（browser-policy 既有禁令不动）。
- **G5（2026-10-27 增补）**：PDF 文件在**浏览器 surface** 直接渲染（Chromium PDF 查看器，webview 开 `plugins`；MIME `application/pdf`；调研 `docs/research/2026-10-27-pdf-csv-preview-research.md`）。
- **G6（2026-10-27 增补）**：CSV/TSV 在文件 surface 默认**表格预览**（行 500/列 50/单元格 200 字符上限，超限截断提示），tab 头「源码」一键回文本编辑（与 SVG 同模式）；纯函数 CSV 解析（RFC4180 + 分隔符嗅探）。
- **G7（2026-10-27 增补）**：Markdown（md/markdown）在文件 surface 默认**渲染预览**（复用 `@mafw/session-ui/markdown`——sanitize + 代码高亮 + 表格，与聊天同款），tab 头「源码」一键回文本编辑；预览内容取草稿缓冲（切回预览反映最新源码）。
- **G8（2026-10-27 增补）**：JSON 默认**树视图**（可折叠、默认展开两层、每层 500 项上限、解析失败显式报错），tab 头「源码/树」切换。
- **G9-G11（2026-10-27 增补）**：XLSX/DOCX/PPTX 只读预览 tab（同图片：不 dirty/不参与保存冲突）——xlsx = exceljs 表格 + sheet 切换（行 200/列 50 上限，公式不执行）；docx = docx-preview 渲染；pptx = pptx-preview 幻灯片渲染。三个解析库全部**动态 import 懒加载**；数据走 `mafw-file://` + `fetch(arrayBuffer)`（协议加 `corsEnabled` + ACAO 头）。`.xls/.doc/.ppt` legacy → 只读提示 + 外部应用打开；解析失败 → 错误横幅 + 外部打开。

**非目标（v2+）**：图片缩放/拖拽平移；SVG 进浏览器渲染；Markdown 预览（可复用 session-ui 渲染器，另案）；JSON 树视图；XLSX/Office 预览；图片批注（与 G1/G2 管线交汇，另案）；浏览器多文件 tab（多 webview，大改）。

## 2. IA 与词汇

- `WorkbenchSurface` 内部 id **保持 `"code"`**（低 churn：localStorage 持久值/LEGACY_TABS/CSS 类 `mafw-rw-l2-tab-code` 全部不动），仅 `WORKBENCH_SURFACES` label `代码 → 文件`。roving-tabindex/键盘导航零影响。
- 新增词汇 `FileKind = "image" | "svg" | "html" | "text"`，纯函数 `fileKindFor(rel)`（扩展名表驱动，大小写不敏感）。

## 3. `mafw-file://` 协议（数据通道与安全模型）

选 protocol 流式而非 base64 IPC：不占 IPC 载荷、无 1MB 上限、图片与 HTML 共用一条通道；仓库有先例（`windows.ts` rendererProtocol：`protocol.handle` + host 校验 + `..`/absolute 逃逸拒绝 + `net.fetch(pathToFileURL)` range 流式）。

- **URL 形态**：`mafw-file://<rootToken>/<urlEncodedRelPath>`。`rootToken` = 每次会话根注册时生成的**不透明随机 token**（不编码真实路径，防猜测/枚举；origin 按 rootToken 天然隔离——同根内 HTML 的相对子资源同源可加载）。
- **注册面**：`registerSchemesAsPrivileged` 在 app ready **之前**加 scheme（`standard/secure/supportFetchAPI/stream`）；`protocol.handle` 必须同时挂在 **defaultSession（renderer `<img>`）与浏览器 partition `persist:workbench-browser`（webview 导航）** 两个 session 上——Electron 的 protocol 是 per-session，只挂一边另一边 404。
- **Root allowlist**：main 维护 `Map<token, absRoot>`；workbench 根变化（`benchRoot()`）时经 IPC 注册/注销；handler 拒绝未知 token、`..`/absolute 逃逸、不存在文件（404）。
- **MIME 表**：图片八型 + `svg→image/svg+xml` + `html/htm→text/html` + HTML 相对子资源常见型（css/js/mjs/json/map/woff/woff2/ttf/otf/mp4/webm/mp3/wav/ico/txt）；未知 → `application/octet-stream`。
- **渲染器 CSP**：核查 `index.html`/rendererProtocol 响应头的 img-src/media-src 是否需补 `mafw-file:`（build 期与 dev 5173 两条路都要验）。
- **webview 侧既有加固自动继承**：browser-session.ts 对该 partition 权限全拒/attach 校验不变；本地 HTML 内脚本可运行（用户自己项目文件，信任模型=系统浏览器打开），但无 node、无权限。

## 4. 文件 surface：图片预览 tab 与 SVG 切换

- **模型**：`editor-state.ts` `OpenFile` 增加 `kind: FileKind`（默认 `"text"`）；`openFile(m, rel, content, opts)` 扩展。图片 tab **无 text**、恒 `readOnly`、永不 dirty、不参与保存/备份/冲突流程；外部变更 → 重新加载（URL 加 `?v=<mtimeMs>` buster 刷新 `<img>`）。
- **渲染**：EditorDock 内容区按 active tab kind 分流——`text/svg(源码)` → CodeMirror 现状；`image` / `svg(预览态)` → `<img src={mafwFileUrl(...)}>` 只读预览（`object-fit: contain`、居中、`--bg-inset` 底、下方一行 metadata：尺寸 naturalWidth×naturalHeight + 文件大小 + 相对路径）。
- **SVG 切换**：默认预览（缺省即渲染）；active tab 为 svg 时编辑器头部显示「源码/预览」toggle（ButtonV2 ghost，状态仅内存、per-tab）。首次打开会先注册协议 token（失败则退回源码态）；源码态 CodeMirror 可编辑，切回源码时强制重测防 0 尺寸视图。
- **tab 条**：图片/svg tab 与文本 tab 同款（图标用 `image`/`file-code` 区分）；关闭/外部变更监听语义一致。
- **fs 通道**：预览不经 `readFile`（二进制会被拒）；图片只需要 `stat`（大小/mtime）+ protocol URL。preload `window.api.fs` 增加 `statFile(root, rel)` 薄封装（如已有则复用）。

## 5. HTML / PDF → 浏览器 surface

- **分流**：MafwShell `onOpenFile(rel)` 改为经纯函数 `fileOpenPlan(rel)`： `"browser"`（html/htm/**pdf**）/ `"editor"`（其余全部——含图片、svg、csv/tsv，编辑器内部再按 kind 渲）。
- **PDF**：`mafw-file://` 直连 Chromium PDF 查看器——MIME `application/pdf` + 浏览器 webview 开 `plugins` 属性（仅工作台 guest；partition  hardening 不变）。
- **导航链路**：`fileOpenPlan = "browser"` → 经 IPC 注册 root（幂等）得 token → 拼 `mafw-file://` URL → renderer store `browser-nav.ts`（`requestBrowserNavigate(url)` signal）→ BrowserDock 订阅并 `load(url)`（`load` 既有 policy 闸生效）+ `openWorkbenchSurface("browser")` 切 surface。既有 `browser-open-url` 通道（main→preload→BrowserDock 直连订阅，`BrowserDock.tsx:167`）保持不动。
- **browser-policy 放行**：`navigationDecision`/`windowOpenDecision`/`isAllowedSrc` 增加 `mafw-file:` → allow/navigate（该 scheme 只有我们自己能产出 URL）；`file:`/`data:`/`javascript:` 禁令原样不动。地址栏对 `mafw-file://` URL 显示解码后的相对路径（面板设计契约禁 emoji，不用图标前缀），手动编辑地址仍走 `normalizeAddress` 现状规则。
- **边界**：root 注销后旧 URL 全部 404（token 失效）；跨 root 的 html 文件先注册对应 root。

## 6. 样式

- 预览容器：`.mafw-file-preview`（flex 居中、`overflow:auto`、`--bg-inset`）；metadata 行 10px `--text-3`。
- SVG toggle 复用编辑器头部按钮区（与保存/外部编辑器/改动同行，仅 active=svg 时渲染）。

## 7. 测试策略（TDD）

- **纯函数**：`file-kind.test.ts`（扩展名矩阵/大小写/无扩展名/点文件）、`mafw-file-url.test.ts`（build/parse 往返、逃逸拒绝、未知 token、MIME 表）、`fileOpenPlan` 分流矩阵、`navigationDecision` 放行表（mafw-file allow + file/data/javascript 仍 deny）、editor-state kind 传播与 readOnly 不变量。
- **接线契约**：WorkbenchShell/MafwShell 源码断言（label 文件、fileOpenPlan 使用）、preload/main 注册点断言（双 session protocol.handle、registerSchemesAsPrivileged 时序注释钉死）。
- **GUI 冒烟（dev app）**：scratch 项目放真 png/svg/html（html 带相对 css/js/img 子资源）→ 点击分流正确、图片预览显示、SVG 源码↔预览互切、html 渲染且相对资源加载、地址栏友好显示、执行/审阅视图不受影响。

## 8. 验收清单

1. 文件树点 png/jpg/webp → 文件 tab 内只读预览（contain + metadata）；切换 tab 再回来仍正常。
2. 点 svg → **直接预览**（图）；头部「源码」→ 可编辑源码；「预览」→ 回到渲染图。
3. 点 html → 自动切浏览器 surface，页面渲染、相对子资源加载、地址栏显示友好路径。
4. html 内 http(s) 链接 window.open → dock 内导航（既有语义不回归）；`file:`/`javascript:` 仍拒。
5. L2 tab 显示「文件」；旧 localStorage 值/键位导航不回归。
6. 未知 token / 逃逸路径 / 不存在文件 → 404；root 切换后旧图片 URL 失效不残留。
7. desktop 全量测试绿 + tsgo rc=0 + electron-vite build rc=0。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| protocol 只挂 defaultSession → webview 404 | §3 钉死双 session 注册 + 契约测试 |
| 本地 HTML 脚本在 webview 执行 | 信任模型=用户自有文件；partition 权限全拒/无 node 不变；不向 `file:` 开口 |
| 大图片 OOM | 流式 protocol 无 1MB 上限；`<img>` 解码由 Chromium 管；不做 base64 |
| rootToken 泄漏 → 枚举 | token 随机不透明、root 切换即失效、URL 不含真实路径 |
| SVG 预览 XSS（inline svg 脚本） | 预览一律 `<img src>`（img 上下文 svg 脚本不执行），禁止 inline `<svg>` 注入 |
