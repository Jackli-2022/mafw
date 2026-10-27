# JSON / Office 预览调研与方案（2026-10-27 增补）

背景：文件 tab 已支持 图片/SVG/CSV/TSV/Markdown/HTML/PDF。用户要求补 **JSON 树视图** 与 **XLSX / Office（docx/pptx）** 预览。

## 一、业界

- **opencode desktop**：office/PDF 文档预览仍在 spec（issue #44949，桌面端点击附件应开 in-app Document Preview）；无现成实现可抄。
- **VS Code**：Office 靠扩展（Fast Office Viewer 等 = docx-preview + SheetJS/exceljs 组合）；JSON 内置文本无树。
- **JetBrains**：JSON 有结构视图/格式化；Office 插件（PDF Viewer 用 JCEF）。
- **Kimi Code Desktop**：文件预览含 JSON（渲染）；Office 未在文件预览列表（其文档/表格是另一产品能力）。

结论：**JSON 自研树视图**是标准做法；**Office 一律走 JS 解析库**（浏览器原生不渲染 Office）。

## 二、库选型（懒加载）

| 格式 | 库 | 许可 | 说明 |
|---|---|---|---|
| JSON | 自研 | — | 解析 + 可折叠树（默认展开 2 层），源码一键切换；≤1MB（readFile 闸） |
| XLSX | **exceljs 4.4**（MIT） | 维护中 | 多 sheet 表格预览；行 200/列 50 上限；`.xls` legacy 不支持 → 外抛 |
| DOCX | **docx-preview 0.4**（Apache-2.0，依赖 jszip） | 成熟方案 | DOM 渲染保真度好；只读 |
| PPTX | **pptx-preview 1.0.7**（ISC；npm 包商用免费，源码仅限个人学习——作为依赖使用 OK） | 纯前端 | init(container,{width,height}) + preview(ArrayBuffer) |

- 三者均**动态 import**（Vite code-split）：不打开 Office 文件不加载；主包不受影响。
- 二进制读取复用 **`mafw-file://` 协议 + fetch(arrayBuffer)**（不新增 IPC、不受 readFile 1MB 文本闸限制）；协议需补 MIME：`xlsx/docx/pptx`。
- 安全：office 文件是用户自有项目文件；渲染在 renderer（无 node），Office 宏/外链不执行；docx-preview/pptx-preview 均无脚本执行面。

## 三、范围与回退

- **v1 支持**：JSON（树）、XLSX（表格+sheet 切换）、DOCX（渲染）、PPTX（渲染）。
- **回退**：`.xls/.doc/.ppt` 旧二进制格式 → 只读提示 + 「外部应用打开」；解析失败 → 错误横幅 + 外部打开。
- **非目标**：Office 编辑/公式计算/宏；pptx 动画与精确排版（库能力边界）；超大表格虚拟滚动（上限截断提示）。

## 四、UI 约定

- JSON：默认树预览 + tab 头「源码/树」切换（沿用 sourceMode）。
- Office（xlsx/docx/pptx）：纯预览 tab（同图片：只读、不 dirty、无源码切换），加载态 Loader、失败态 DockBanner + 外部打开动作。

## 来源

- opencode issue #44949（Document Preview for office files and PDFs）
- npm：exceljs@4.4.0（MIT）、docx-preview@0.4.1（Apache-2.0）、pptx-preview@1.0.7（ISC，npm 包商用免费）
- VS Code Fast Office Viewer 扩展说明（docx-preview 组合）
