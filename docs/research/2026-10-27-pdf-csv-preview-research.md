# PDF / CSV 预览调研（2026-10-27 增补）

背景：文件 tab 已支持图片与 SVG「打开即看」。用户追问「还有 pdf，csv 等呢」。回答 PDF/CSV 的业界呈现方式与我们的落地路线。

## 一、业界

| 产品 | PDF | CSV/TSV | 机制 |
|---|---|---|---|
| **Kimi Code Desktop** | ✅ 文件预览面板直接渲染 | ✅ 渲染（表格） | 官方文件预览支持 Markdown/JSON/HTML/PDF/CSV/图片/文本 |
| **JetBrains** | 插件（PDF Viewer，基于 JCEF/Chromium） | ✅ 内置 **文本↔表格**双视图（Edit DSV files as tables） | CSV 是编辑器能力；PDF 是 Chromium 内嵌 |
| **VS Code** | 扩展（vscode-pdf = pdf.js） | 扩展（Excel Viewer / edit-csv） | 核心无内置 |
| **Zed** | ✗ | ✗（文本） | 仅图片查看器 |
| **dsh-file-viewer 插件** | ✅ | ✅ | 通用只读预览层 |

收敛：**PDF 直接渲染**（浏览器内核的 PDF 查看器即可）、**CSV 默认表格视图 + 一键源码**（JetBrains 形态最完整）。

## 二、我们的路线

- **PDF → 浏览器 surface**（单 webview，复用 `mafw-file://`）：
  - MIME 表补 `application/pdf`；
  - webview 需开 Chromium PDF 插件（`plugins` 属性；main 侧 `mainWindowWebPreferences` 不动，只对工作台浏览器的 guest 开）；
  - 收益：零新依赖、Chromium 完整 PDF 能力（翻页/缩放/搜索）；与 HTML「文件进浏览器」同构。
  - 备选（不采用）：pdf.js 进文件 surface —— 多一个 ~MB 级依赖 + worker 配置，v1 不划算。
- **CSV/TSV → 文件 surface 表格预览**（默认表格，tab 头「源码」一键回文本，与 SVG 同模式）：
  - 纯函数 `csv-parse.ts`（RFC4180：引号、转义引号、CRLF、分隔符嗅探 `,` `;` `\t`）；
  - 渲染上限：行 500 / 列 50 / 单元格 200 字符，超出提示「已截断」；
  - 表格只读；源码可编辑（沿用编辑器 dirty/保存语义）。
- **非目标（继续延后）**：Markdown 预览（可复用 session-ui 渲染器，另案）、JSON 树视图、XLSX/Office（需要解析依赖，opencode 走的是 Office 预览但我们是 Electron，成本不同）。

## 三、风险

- webview `plugins` 打开 = Chromium 内置 PDF 插件可用；partition 权限全拒/无 node 不变，仅本地 `mafw-file://` 导航可达（http(s) 站点也能嵌入 PDF —— 与系统浏览器行为一致，接受）。
- 大 CSV：解析与 DOM 有上限，超限截断提示；解析失败（非 CSV）退回文本视图。

## 来源

- Kimi Code Desktop 界面导览/文件预览（Markdown/JSON/HTML/PDF/CSV/图片/文本）：<https://www.kimi.com/help/kimi-code/desktop-interface-and-sessions>
- JetBrains「Edit DSV files as tables」：<https://www.jetbrains.com/help/idea/editing-csv-and-tsv-files.html>；PDF Viewer 插件（JCEF）：<https://plugins.jetbrains.com/plugin/14494-pdf-viewer>
- VS Code：vscode-pdf（pdf.js）/ Excel Viewer 扩展
- 本仓库：`src/shared/mafw-file.ts`、`BrowserDock.tsx`、`EditorDock.tsx`
