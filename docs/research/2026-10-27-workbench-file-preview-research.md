# 工作台文件预览调研：代码 tab 拓宽（图片）+ HTML 进浏览器

日期：2026-10-27
背景：用户要求——「代码」tab 拓宽到能展示 png/svg 等图片；html 可放到「浏览器」打开、变成文件 tab。先调研业界（opencode / Codex / Claude / dsh desktop / Kimi + IDE 参照系），只调研不决策。

## 一、现状（代码级）

- **文件打开链路**：`FilesDock` 点击 → `WorkbenchCodeView.openFile(rel)` → MafwShell `onOpenFile` = **一律** `requestOpenEditor(root, rel)` + 切代码 surface（`MafwShell.tsx:2146-2151`）。
- **读取闸**：main `fs-workspace.ts` `readFile` —— `MAX_READ_BYTES = 1MB`，`sniffBinary` 判二进制 → `{ok:false, reason:"binary"|"too-large"|"encoding"}`；EditorDock 对 binary 只显示「只读提示」占位（`EditorDock.tsx:124-129`）。**图片目前完全无法展示**（无 base64/流式读图通道）。
- **HTML**：只能以源码文本进编辑器；浏览器 webview 被 `browser-policy.ts` 钉死 **http(s) 唯一允许**，`file:`/`data:`/`javascript:` 一律 deny——本地 HTML 渲染无路。
- **已有先例**：`windows.ts:40,279` 已注册 `protocol.registerSchemesAsPrivileged` + `protocol.handle(rendererProtocol)`（生产包渲染进程自用协议）——加 `mafw-file://` 类协议是仓库内走过的熟路。

## 二、业界做法

### 2.1 五家 agent 桌面

| 产品 | 非文本文件预览 | 要点 |
|---|---|---|
| **Kimi Code Desktop** | **右栏「文件预览」统一面板**：Markdown / JSON / **HTML（渲染）** / PDF / CSV / **图片** / 代码文本（官方界面导览）；聊天中提到的文件路径一点即开；内置浏览器预览网页效果 | 五家中最全，「一个预览面吃多类型」范式代表 |
| **Codex desktop** | **「rich previews for non-code files」**（VentureBeat 2026 大更新报道）+ 图片编辑（放大查看/评论/挑选/定向修改，10-26 复测 §2.3） | 非代码文件富预览已被 Codex 做成卖点 |
| **Claude Code Desktop** | 文件编辑器 = source view；**Browser pane 承担 app 预览**（dev server 起服后自动开）；聊天内图片内联展示是 **open feature request**（claude-code #35893） | 没有通用图片预览面板；HTML 预览走浏览器 pane 语义（与我们「html 进浏览器 tab」同构） |
| **opencode desktop** | **无内置图片预览**（社区自己拿 static file server 攒预览系统：.svg→inline svg 或 image URL、.ico 先转 png）；v2.0.25 有 Office（Word/Excel/PPT）预览；agent 侧 `read` 工具按内容识别 PNG/JPEG/GIF/WebP 读成 media（attachments 文档） | agent 读图 ≠ UI 看图；UI 侧是空白，社区 hack 证明需求 |
| **dsh desktop** | 无内置；社区插件 **dsh-file-viewer**（右栏通用只读预览：图片/PDF/CSV/Markdown/JSON/YAML/源码/大文件） | 需求侧证：用户自己动手补 |

### 2.2 IDE 参照系

| 产品 | 图片 | SVG | HTML |
|---|---|---|---|
| **VS Code** | 二进制图片默认开**只读图片预览**编辑器（editorAssociations 机制：文件类型↔编辑器关联，`Reopen With` 切换） | **1.97 起默认预览 → 用户 backlash**（要看源码的人被迫改 `workbench.editorAssociations`）；issue #239889 抱怨预览/源码不易互切 | **核心无内置预览**；官方 Live Preview 扩展 / Live Server / 外抛系统浏览器 |
| **Zed** | 内建 image_viewer（带 metadata） | 默认预览 → issue #10403「SVG 没法当代码编辑」→ 补**显式动作**「Open SVG Preview」（project panel 右键） | 无内置渲染预览（任务/外抛） |
| **JetBrains** | 编辑器内图片预览 | 文本+预览切换 | 内建 preview 图标 / 外抛浏览器 |

### 2.3 收敛规律

1. **二进制图片 → 只读视觉预览做默认**，全行业无争议（VS Code/Zed/JetBrains/Kimi/Codex 一致）。
2. **SVG 是「文本+图」混合体，默认预览两家都翻车**（VS Code 1.97 backlash、Zed #10403）——收敛解 = **默认开文本源码，预览做成显式动作**（右键/按钮），双向可切。
3. **HTML 两条路线**：Kimi 式内嵌渲染预览 vs VS Code 式外抛/扩展。我们自带浏览器 surface（webview + 导航加固），HTML 渲染预览的天然归宿就是浏览器 tab（与 Claude「Browser pane 承担 app 预览」同构）。
4. **本地文件渲染必须有协议/路由层**：opencode 社区 hack 用 static file server；Electron 正道是 custom protocol（`protocol.handle`）——我们已有先例（windows.ts）。裸 `file://` 被我们自己的 browser-policy 明令禁止，不该为预览开口子。
5. **「编辑源码」入口必须保留**（VS Code Reopen With 语义）——预览不消灭文本编辑路径。

## 三、我们的方案空间（供 spec 裁决）

**A. 扩展名分流（推荐骨架）**——点击处分流，各归各位：
- `png/jpg/jpeg/gif/webp/ico/bmp/avif` → **代码 tab 内开只读图片预览 tab**（复用 editor tab 条，内容区换 `<img>`；保留「查看源码/十六进制」不必做，二进制本来就没有文本意义）
- `svg` → **默认文本编辑器**（可编辑）+ tab 条显式「预览」动作（吸取 VS Code/Zed 教训）
- `html/htm` → **浏览器 surface 打开**（`mafw-file://` 自定义协议，scoped 到会话根目录 + 路径逃逸防护 + `browser-policy` allowlist 加该 scheme；自动切 surface）
- 数据通道二选一：base64 IPC（简单，需放宽 1MB 上限/分块）vs **`mafw-file://` protocol.handle**（流式、不占 IPC、图片与 HTML 共用一条通道）——倾向后者

**B. Kimi 式统一预览层**（Markdown/PDF/CSV/JSON 全包一个预览面）——大工程，留后续立项；A 落地后其图片/HTML 部分可直接并入。

**C. 只做图片不做 HTML**（最小切）——不符合用户原话（html 明确要进浏览器）。

## 四、开放问题（spec 阶段需用户拍板）

1. **SVG 默认形态**：文本+预览动作（推荐，IDE 教训）vs 默认预览。
2. **「变成文件 tab」语义**：浏览器目前单 webview + 地址栏——html 打开 = 导航当前 webview（小改），还是浏览器 surface 要支持多文件 tab（大改，需 webview 多实例/切换）？
3. **图片大小上限与通道**：1MB readFile 上限对图片太低；protocol 流式无此问题但需新协议注册与 CSP/权限审查。
4. **图片 tab 交互深度**：v1 只读展示（适应/原始大小、尺寸 metadata）够不够？缩放/拖拽平移留 v2？（Zed 有 metadata；Codex 有评论/挑选——那是批注方向，与 G1/G2 管线有交集但不属本次）
5. 编辑器 tab 条对预览 tab 的 dirty/外部变更监听语义（图片只读，无 dirty；外部变更 → 重新加载）。

## 来源

- Kimi Code Desktop 界面导览/文件预览：<https://www.kimi.com/help/kimi-code/desktop-interface-and-sessions>（右栏「文件预览：Markdown、JSON、HTML、PDF、CSV、图片、代码或文本文件」）
- Codex desktop 大更新：VentureBeat「OpenAI drastically updates Codex desktop app…generate images, preview webpages…rich previews for non-code files」（2026）；图片编辑见 `docs/research/2026-10-26-six-way-frontend-gap-resurvey.md` §2.3
- Claude Code Desktop docs（Browser pane 预览 dev server）+ claude-code issue #35893（聊天内图片内联，open）
- opencode：attachments 文档（read 工具读图）、v2.0.25 Office 预览（10-26 复测 §2.1）、社区预览 hack（reddit r/opencode 1vcgfhb）
- dsh-file-viewer 插件：<https://github.com/liguobao/dsh-file-viewer>
- VS Code：Custom Editor API / editorAssociations / SVG 1.97 默认预览争议（SO #79363302、issue #239889）；Zed：image_viewer 设置、issue #10403、「Open SVG Preview」context menu（preview releases）
- 本仓库：`MafwShell.tsx:2146`、`EditorDock.tsx:118-129`、`fs-workspace.ts:60-123`、`browser-policy.ts:28-56`、`windows.ts:40,279`、`BrowserDock.tsx:46-83`
