# Office 文件的 agent 编辑通道调研（PPT 起步）

日期：2026-10-31
状态：调研结论 + 建议方案（未实施）
范围：桌面工作台（文件 surface）的展示/编辑能力盘点；Office 文件（先 PPT）如何让 agent 编辑。

## 0. 结论先行

1. **展示能力已经很全，编辑能力只覆盖文本类**：文本/Markdown/JSON/CSV/SVG 可编辑；图片、xlsx/docx/pptx 只读预览；HTML/PDF 走浏览器 surface。Office 三件套目前**没有**任何编辑入口（人也没有，agent 也没有）。
2. **agent 现在理论上能改 pptx，但不可依赖**：只能用 bash 或 `mafw_python` 手写脚本；而 kernel venv 里 **python-pptx 未安装**，等于没有开箱即用的路径。临时 `pip install` 可行但不可发现、不可复现、无护栏。
3. **建议内置，但不要先做“结构化编辑 API”**：Phase 1 采用业界通行的 **“固定 Python 依赖 + 技能（recipes）+ 原子保存 + 结构校验”**，agent 用 `mafw_python` 调 python-pptx；预览已有的 fs-watch 自动刷新闭环直接复用。Phase 2 再按重复出现的模式抽 `mafw-office` 小 CLI/helper（inspect / apply patch / replace-text / render），Phase 3 可选视觉验证（本机有 PowerPoint，可 COM 导出 PNG）。
4. **业界对标（详见 §3.5）**：Codex/Claude Code/Muse 都是“技能 + 库 + 渲染校验”，没人靠固定结构化 API；Kimi/Grok 额外做了“文档内编辑/中间格式 + 批注 + 版本”的产品化体验。我们的 Phase 1 与 Codex 路线一致；MAFW 已具备的预览批注 + 变更时间线是差异化基础，缺的是文件级版本快照与视觉 QA。
4. 实证：**python-pptx 1.0.2 在 Python 3.14.3 上可直接装（lxml 6.1.3 / Pillow 13 都有 cp314 wheel）**，创建/读取/替换 run 文本/表格/图片/备注的 round-trip 已跑通；导入耗时约 132ms。openpyxl 3.1.5、python-docx 1.2.0 同环境也装通。

## 1. 当前工作台的文件矩阵（证据来自代码）

分类入口：`packages/desktop/src/renderer/mafw/file-kind.ts`（`fileKindFor` / `fileOpenPlan`）；只读判定：`editor-state.ts:isReadOnlyPreview`；预览渲染：`EditorDock.tsx` / `OfficePreview.tsx`。

| 类型 | 扩展名 | 展示方式 | 人类编辑 | agent 编辑（现状） |
|---|---|---|---|---|
| 普通文本 | ts/js/py/css/yaml/…（未命中其它类别） | CodeMirror + 语言高亮 | ✅ 可编辑/保存（1MB 上限、EOL 保真、mtime 冲突） | ✅ 原生 write/edit 工具 |
| Markdown | md/markdown | 渲染预览，源码一键切 | ✅ | ✅ 文本工具（预览随 fs-watch 刷新） |
| JSON | json | 折叠树，源码一键切 | ✅ | ✅ |
| CSV/TSV | csv/tsv | 表格预览，源码一键切 | ✅ | ✅ |
| SVG | svg | 预览默认，源码一键切 | ✅ | ✅ |
| 图片 | png/jpg/jpeg/gif/webp/ico/bmp/avif | 只读图片预览（natural 尺寸/大小） | ❌ | 无内置编辑工具；PIL/ffmpeg 可用但无配方 |
| Office 表格 | xlsx | exceljs 只读表格（sheet 切换，公式不执行） | ❌ | ❌（openpyxl 未装） |
| Office 文档 | docx | docx-preview 只读渲染 | ❌ | ❌（python-docx 未装） |
| Office 演示 | pptx | pptx-preview 只读渲染（含批注图钉） | ❌ | ❌（python-pptx 未装） |
| Legacy Office | xls/doc/ppt | 归为文本 → 二进制闸 → 只读提示 + 外部打开 | ❌ | ❌ |
| PDF | pdf | 浏览器 surface（Chromium PDF viewer） | ❌（查看器只读） | ❌ 无生成/编辑通道 |
| HTML/HTM | html/htm | 浏览器 surface（mafw-file://，相对资源可用） | ❌（树里默认进浏览器） | ✅ 文本工具（改源码） |
| 其它二进制 | — | 只读提示（binary/encoding/too-large） | ❌ | 视格式而定 |

补充：
- 文本编辑已有 **外部变更监听**（仅活动 tab；本轮刚补了切回 tab 重读盘）与脏冲突保护；Office 预览会随文件 mtime 变化自动重解析（本轮修了回合边界重解析白帧）。
- PPTX 预览支持**预览批注**：点击幻灯片 → 页码+归一化坐标锚 → 发送给 agent。也就是说「看预览 → 批注 → agent 改 → 预览刷新」的回路已经具备，缺的只是 agent 端的编辑通道。

## 2. agent 编辑 Office 的现状与缺口

现有可用的执行面：
- `mafw_python`（持久 Jupyter kernel，会话级，`/api/python/execute`）——跨调用保持变量；**kernel cwd 是 gateway 进程 cwd**，脚本必须用绝对路径。
- `bash`（权限审批后可用）。
- 默认 kernel 解释器：`MAFW_PYTHON_BIN` 或 `~/AppData/Local/agent-vision-toolkit/.venv-pykernel/Scripts/python.exe`（本机实证 Python 3.14.3）。

缺口（实测）：
```
pptx       MISSING
openpyxl   MISSING
docx       MISSING
lxml       MISSING
PIL/pandas/numpy/matplotlib  OK
```
即：agent 要改 pptx，必须先猜库、装库、找解释器、处理相对路径，且没有任何“先读结构再改”的规范——不可发现、不可复现、容易把文件写坏。

## 3. PPT 编辑的候选技术路线

| 路线 | 能力 | 优点 | 局限 / 代价 |
|---|---|---|---|
| **python-pptx**（Python，MIT） | 打开现有 deck、读写文本/占位符/表格/图片/备注、增删幻灯片、图表换数据 | 事实标准；纯本地；round-trip 保留未建模内容；我们 kernel 直接可跑 | 不能编辑 SmartArt/动画；文本替换要处理 run 切分；无渲染能力 |
| PptxGenJS（Node，MIT） | 从零生成 | 生成侧成熟 | **不能读改现有 deck** |
| @office-kit/pptx（Node，MIT，0.28） | 读写 + 未建模部分 round-trip 保留；配套 preview | 若做 Node 侧工具可选 | 新生态、API 面大；与现有 Python kernel 不共享 |
| pptx-automizer（Node，MIT） | 模板/母版保真合并、按 shape 名替换 | 保设计最强（模板库模式） | 需要模板与精确 shape 命名；不适合自由编辑 |
| Office COM / PowerPoint 自动化 | 直接驱动本机 PowerPoint，保真最高，可导出 PNG | 本机已装 Office；视觉验证最强 | Windows+Office 依赖；有 UI/锁文件风险；不适合作为默认编辑路径 |
| Office MCP server（python-pptx 包装） | 现成工具面（GongRzhe / pptx-mcp 等） | 免写代码 | 三方进程/依赖；工具面固定且偏生成；与我们 kernel/技能体系重复 |
| LibreOffice headless | 转 PDF/PNG 做渲染验证/格式转换 | 跨平台渲染 | 本机未安装；保真与 PowerPoint 有差 |

参考先例（2026 生态）：
- EveryInc **hands-on-deck**：agent-native CLI，`inspect` / `apply patch.json` / `diff` / `render`，原子 JSON patch + skill 包装——最接近“内置编辑通道”的形态。
- Hermes Agent 内置 **Powerpoint skill**：`pptx_create/read/edit` 辅助脚本 + 可选 soffice/pdftoppm 渲染——技能+脚本模式。
- **agent-slides / PPT-Design-Skill**：技能 + CLI + 视觉验收（PowerPoint COM 或 LibreOffice+pdftoppm）分层。
- `pptx-automizer`：模板保真路线，适合企业母版，不适合作为默认编辑。

## 3.5 业界对标：Kimi / Codex / Muse / Grok

调研口径：只看“agent 能不能改 Office 文件、怎么改、怎么验证”，不评价模型能力。产品页/第三方评测存在营销成分，下列只取可交叉验证的机制。

### Kimi（Moonshot）
- **Kimi Slides**：第一方演示产品，支持上传 PPTX 模板/文档/图片，生成后可在自带编辑器里**直接改文本、图片、形状、图表**；「添加批注，指哪改哪」+ 多轮对话迭代；**每轮自动存版本、可回退**；在线演示与导出 PPTX/PNG。
- 公开实现线索（非官方 open-kimi-ppt skill，逆向 Kimi Slides）：**PPTD 中间层（YAML 逐页描述）+ PPTX 导出 + 本地浏览器编辑器 + 导出前视觉质检**。即：不让模型直接拼 OOXML，而是先写结构化中间表示，再由渲染器产出可编辑 PPTX。
- 对我们的含义：**中间格式适合“生成新 deck”**，不适合“改用户现有 deck”（母版/既有对象会丢）；批注+版本是产品化体验，MAFW 已有批注，文件版本快照是缺口。

### Codex（OpenAI）
- 官方 **Presentations skill/plugin**：创建/编辑/预览 PPTX 与 Google Slides，导出前做**渲染 + 溢出/重叠/字体检查**；Codex 用例明确覆盖“revise an existing deck while preserving structure/style”。
- ChatGPT 桌面端 **artifact viewer**：在对话旁预览生成的文档/演示/表格/PDF；支持的预览可**加批注**并让 agent 定点修改；HTML 可交互预览；TeX 源文件旁挂 PDF 预览并自动编译刷新。
- 实现路线：**Skill + PptxGenJS/python-pptx + 渲染 QA**，PowerPoint 深度编辑另走 **ChatGPT for PowerPoint** 加载项（在打开的 PPT 里工作）。
- 对我们的含义：和本调研 Phase 1/2 最接近；我们已有的工作台预览 + 预览批注相当于 artifact viewer 的子集，补上“技能 + 渲染校验”即可对齐。

### Muse（Meta）
- **Muse Code**：终端 coding agent（Muse Spark 模型），强调长时任务、持久子代理、**本地事件日志/崩溃恢复**；读取仓库 `AGENTS.md` 与 `.agents/skills` 技能包。
- **Muse（个人 agent）**：跑在独立 Secure VM 上，跨文件/邮件/消息工作；未检索到第一方 Office/PPT 编辑器。
- 对我们的含义：**通用 agent 不内置 Office 编辑**，能力来自技能/工具；这与 MAFW 的“技能 + mafw_python”路线一致。可借鉴的是事件日志/可审计与崩溃恢复（MAFW 已有 goal_node/trajectory，文件编辑可加审计）。

### Grok（xAI）
- **Grok for PowerPoint / Word / Excel / Outlook**：Microsoft 365 加载项，在打开的文档侧边栏里改**真实可编辑的幻灯片**：大纲成稿、扩页/应用主题/重排章节、改稿前后对照、AutoSave；支持联网/X 搜索、图表与图片生成。
- **Grok 4.3+ 原生文件生成**：直接产出 .pptx/.docx/.xlsx/.pdf；Grok Build 可做多 sheet Excel 模型等 Office 工作。
- 对我们的含义：这是**“Office 内嵌 agent”**路线，和“agent 改工作区文件”是两种产品形态；MAFW 先做后者成本更低，未来若要“在 PowerPoint 里侧边栏改”需要 COM/加载项，跨平台代价高。

### 横向结论
| 产品 | 编辑载体 | 预览/校验 | 版本/回退 | 对我们的可复用点 |
|---|---|---|---|---|
| Kimi | 自有编辑器 + PPTD 中间层 | 导出前截图质检 | ✅ 每轮快照 | 批注定位、版本回退、中间格式（生成向） |
| Codex | 文件 + Skill（PptxGenJS/python-pptx） | artifact viewer + 渲染 QA | 依赖工作区/git | 技能 + 渲染校验 + 预览批注 |
| Muse | 文件 + 工具/技能 | 终端/工作区 | 事件日志/恢复 | 可审计事件、技能包 |
| Grok | Office 加载项（活文档） | Office 实时预览 | AutoSave | 活文档编辑（另一产品形态） |

**没有一家把“固定 Office 编辑 API”当作主路径**：主流是“技能 + 成熟库 + 渲染校验”，外加产品化的预览/批注/版本。MAFW 的 Phase 1 正好落在 Codex/Muse 路线；Phase 2 的 patch CLI 可吸收 hands-on-deck 的 inspect/apply/diff；Phase 3 的视觉校验对齐 Codex/Kimi。

## 4. 实证（本机）

环境：`C:\Users\15524\AppData\Local\agent-vision-toolkit\.venv-pykernel\Scripts\python.exe`（Python 3.14.3）。

安装（临时 target，不动 venv）：
```
pip install --target <tmp> python-pptx   → python-pptx 1.0.2, lxml 6.1.3(cp314 wheel), Pillow 13.0.0, XlsxWriter 3.3.1
pip install --target <tmp> openpyxl python-docx → openpyxl 3.1.5, python-docx 1.2.0
import pptx 首次导入 ~132ms
```
round-trip 探针（3 页）：标题/便签/表格/图片创建 → 重新打开 → 按 run 替换文本（保留字体/字号）→ 再打开断言：
```
slides 3, replaced_runs 1, tables 1, pictures 1, notes "speaker notes here"
```
结论：库与 Python 3.14 兼容；run 级替换能保留格式；表格/图片/备注在 round-trip 中保留。

边界：
- 文本可能被拆成多个 run（PowerPoint 自己也会），**按段落 `.text =` 会丢行内格式**；正确做法是合并 run 匹配再写回（或 hands-on-deck 的 set-text/replace-text 逻辑）。
- SmartArt / 动画 / OLE / 3D 模型：python-pptx 不建模、通常原样保留但不可编辑；不要承诺能改。
- 删除/移动幻灯片没有公开 API，需要操作 `p:sldIdLst`（pptx-automizer / PPTX-Agent 同做法）。
- 文件被 PowerPoint 打开时保存可能锁失败；保存应先写临时文件再 `os.replace`，避免预览读到半截文件（fs-watch + mtime 会触发重解析）。
- kernel cwd 不是会话目录：技能必须要求绝对路径（会话目录从 workbench/file tree 推）。

## 5. 方案比较（面向 MAFW）

### A. 固定依赖 + 技能（推荐 Phase 1）
- 在 kernel venv（或新建 `~/.mafw/pykernel` 标准 venv）预装 `python-pptx / openpyxl / python-docx / Pillow`；提供 provisioning 脚本与 `MAFW_PYTHON_BIN` 解析顺序（env → `~/.mafw/pykernel` → vision venv）。
- 新增项目技能 `.opencode/skills/office-editing/SKILL.md`：先 `inspect` 导出结构 JSON → 再编辑；覆盖 PPT 常用操作（run 级替换、备注、图片替换保位、表格、增删/移动页、主题色/字体）；保存纪律（备份、临时文件 + os.replace、重开断言）；验证（结构 diff + 工作台预览自动刷新 + 可选渲染）。
- 成本低、无新进程、对所有 runtime（opencode/pi）一致；缺点是没有强制 API，靠技能约束。

### B. 结构化工具（`mafw_office_*` / helper CLI）
- 把 inspect / replace-text / set-text / swap-image / slide 操作做成 JSON patch 接口（hand-on-deck 模式），由 Python helper 执行；agent 只发 patch。
- 可靠性最高、可审计；但 API 面大，自由编辑仍会退回写脚本，所以更适合作为 Phase 2 在 A 之上抽公共模式。

### C. 三方 MCP server
- 直接接 Office-PowerPoint-MCP-Server/pptx-mcp：最快出效果，但引入三方进程、工具面偏生成、配置/权限分散，不作为内置首选。

### D. 纯文本中转（Markdown/HTML → PPT）
- 适合“从零生成”的新 deck（我们已有 slides 技能），不适合改现有商务 deck（母版/版式/图片/图表会丢）。

### E. 预览内直接编辑（写回 OOXML）
- 交互最好但工作量最大，需要预览元素 ↔ OOXML shape 映射；不建议当前做。

## 6. 建议路线（PPT 起步）

**Phase 1（MVP，约 1-2 天量级）**
1. `gateway/scripts/setup-pykernel-office.ts`：可重复地给 kernel venv 安装 office 三件套（幂等、--upgrade 策略、失败提示）；若要做成产品级，再迁到 `~/.mafw/pykernel` 标准 venv。
2. `.opencode/skills/office-editing/SKILL.md` + `scripts/`：
   - `inspect.py`：deck → JSON（页、shape、文本、备注、表格、图片关系、占位符/版式）。
   - `replace_text.py`：跨 run 的保格式替换（段落/表格/备注）。
   - `swap_image.py`：按 rel id 替换图片字节，保留位置尺寸。
   - `slide_ops.py`：增/删/移动页（`p:sldIdLst`）。
   - 统一：`--backup`、临时文件 + `os.replace`、保存后重开断言、输出 JSON 摘要。
3. 技能文案写清工作流：**先 inspect，再改，改完重开校验 + 让工作台预览刷新**；禁止在 PowerPoint 打开文件时保存；路径必须绝对。
4. 文档/记忆：AGENTS.md 记录安装路径与技能入口。
5. 验证：真 deck 上 run 替换、图片替换、加页、备注；工作台预览自动刷新；文件二进制大小/结构 diff。

**Phase 2（按需）**
- 抽 `mafw-office` CLI（inspect/apply patch/render），agent 从“写脚本”升级为“发 patch”；加 lint（字体/溢出无法检查则结构 lint）。
- 覆盖 xlsx/docx 同构脚本（openpyxl / python-docx）。

**Phase 3（可选）**
- 视觉验证：Windows + 已装 PowerPoint → COM 隐藏实例 `Presentation.Export(folder, "PNG")`，agent 用 `mafw_media_ask` 看渲染图；跨平台回退 LibreOffice+pdftoppm（需安装，能力位门控）。
- 企业模板路线：pptx-automizer / shape 命名约定，用于品牌母版批量生成。

## 7. 待决策

1. 是否按 Phase 1 落地（装依赖 + office-editing 技能）？装到现有 vision venv 还是新建 `~/.mafw/pykernel` 标准 venv（推荐后者，跨机器可复现）？
2. 是否第一天就带 `mafw-office` helper CLI（Phase 2 提前），还是先 recipes？
3. 视觉验证是否纳入（本机有 PowerPoint，COM 导出可行；Linux/macOS 需要 LibreOffice）？
4. xlsx/docx 是否与 pptx 同批做（依赖同构，成本增量小）？

## 8. 参考

- python-pptx 文档（round-trip / text runs / charts）：https://python-pptx.readthedocs.io/
- EveryInc hands-on-deck（agent-native CLI + skill）：https://github.com/EveryInc/hands-on-deck
- Hermes Agent Powerpoint skill（helper 脚本 + 可选渲染）：https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/productivity/productivity-powerpoint
- pptx-automizer（模板保真）：https://github.com/singerla/pptx-automizer
- Office PowerPoint MCP Server（python-pptx 包装）：https://github.com/GongRzhe/Office-PowerPoint-MCP-Server
- @office-kit/pptx（Node 读写，MIT 0.28）：https://www.npmjs.com/package/@office-kit/pptx
- PptxGenJS（仅生成，MIT 4.0）：https://www.npmjs.com/package/pptxgenjs
- 2Slides MCP 生态地图（2026）：https://2slides.com/blog/powerpoint-mcp-server-ecosystem-2026
- Kimi Slides（官方能力页）：https://www.kimi.com/features/slides
- Codex “Create or revise a slide deck” 用例：https://developers.openai.com/codex/use-cases/generate-slide-decks
- Codex artifact viewer / 文件预览：https://developers.openai.com/codex/artifacts-viewer
- Muse Code（Meta）：https://dev.meta.ai/docs/muse-code/ · 发布报道：https://www.explainx.ai/blog/meta-muse-code-coding-agent-muse-spark-1-2-launch-august-2026
- Grok for PowerPoint（xAI）：https://x.ai/grok/powerpoint · Grok 4.5 Office 能力：https://x.ai/news/grok-4-5
