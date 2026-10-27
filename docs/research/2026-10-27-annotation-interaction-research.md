# 批注（Annotation）交互调研（2026-10-27）

背景：工作台文件预览矩阵已成型（图片八型 / SVG / CSV / TSV / Markdown / JSON / HTML / PDF / XLSX / DOCX / PPTX）。用户要求研究"在文件（包括预览态）上批注"的交互。本文调研业界模式、锚点技术、并给出本仓库的候选方案。**尚未定稿，待用户确认批注的核心目的**（见文末开放问题）。

## 一、业界交互模式（四类）

### 1. 选区 → 浮条（Hypothesis / Medium / ChatGPT quote / Cursor "Add to Chat"）
- **交互**：在正文上划选 → 附近浮出小工具条（高亮 / 批注 / 引用 / 发送给 AI）。
- **代表**：Hypothesis（网页批注，划选→Annotate/Highlight）；ChatGPT/Perplexity 的"选中文字→Quote/Reply"；Cursor/VS Code Copilot 的"选中代码→Ctrl+Shift+L Add to Chat"（把选区作为 @Code 引用插进对话）。
- **特点**：零学习成本、不需要进入"批注模式"；选区即锚点。
- **适配**：文本类（代码/Markdown/JSON/CSV 单元格/DOCX 渲染文本/PDF 文本层）。

### 2. 图钉批注（Figma / Markup / BugHerd）
- **交互**：点进"批注模式"→ 在画布任意位置点一下 → 落一个编号图钉 → 弹评论框；图钉可回复/解决（resolve）。
- **代表**：Figma 评论（坐标锚定、线程、resolve）、macOS 标记、BugHerd/Heurio（把任意网页变成可批注画布）。
- **特点**：锚点=归一化坐标（x%, y%），天然适配像素类内容；需要"模式开关"避免和正常点击冲突。
- **适配**：图片、SVG 预览、PPTX 幻灯片、PDF 页面、XLSX 表格区域。

### 3. 行槽/边距批注（GitHub PR / VS Code Review / Google Docs）
- **交互**：悬停某行 → 行槽出现"+"→ 展开评论框；或选中段落 → 右边距批注卡。
- **代表**：GitHub PR 行评论（锚 diff position，代码变动后自动重定位或标记 outdated）；Google Docs 边距评论。
- **特点**：与"审阅"场景绑定深；行级粒度，适合代码/diff。
- **适配**：源码态、CSV/表格行、Markdown/JSON 源码行。

### 4. 手写/墨迹覆盖层（macOS Preview / OneNote）
- 自由绘制、箭头、方框。表达力最强但实现最重，且难转成结构化锚点。**建议不做**（非目标）。

## 二、锚点技术（批注的硬核问题：文件会变）

批注的难点不是 UI，是**锚点存活**——尤其本仓库场景里 agent 会改文件。业界锚点策略（Hypothesis / W3C Web Annotation）：

| 策略 | 存活能力 | 适用 |
|---|---|---|
| 位置（offset / XPath / 行列） | 脆弱：任何前置编辑即漂移 | 只读预览、版本固定时 |
| **TextQuote（exact + prefix/suffix 上下文）+ 模糊重锚** | 抗移动/抗周边编辑；目标文本被删则失效（可检测"孤儿"） | 文本类首选（Hypothesis 生产验证） |
| 结构选择器（JSON Pointer / CSS selector / A1 单元格 / slide#shape#） | 抗格式变化；结构重排会断 | JSON、XLSX、HTML、PPTX |
| 归一化坐标（x%, y% + rect） | 图像不变即存活；图像替换即失效（合理） | 图片/SVG/PDF 页 |
| 语义锚（tree-sitter 节点路径/符号名） | 抗挪动、抗格式化 | 代码（重，v2 候选） |

**组合策略（Hypothesis 模式）**：一条批注存多个选择器，重锚时按 精确范围 → 引文+上下文 → 模糊匹配 逐级降级；全部失败则标记"孤儿批注"（orphan）而不静默消失。

## 三、按我们已适配的文件类型映射

| 类型 | 推荐交互 | 锚点 | 难点 |
|---|---|---|---|
| 源码/文本 | 行槽评论 + 划选浮条 | 行:列 + TextQuote 双写 | agent 编辑后重锚 |
| Markdown 预览 | 划选浮条（渲染文本） | TextQuote（对源码重锚） | 渲染↔源码位置换算 |
| JSON 树 | 点节点 → 批注 | **JSON Pointer** + 值摘要 | 结构稳定，天然精准 |
| CSV/TSV/XLSX | 点单元格/选行 → 批注 | sheet + A1（或 header 名+行键） | 列增删 → A1 漂移，header 锚更稳 |
| DOCX 预览 | 划选浮条 | TextQuote（段落文本） | 渲染 DOM 易变，引文锚最稳 |
| PPTX 预览 | 图钉（点击幻灯片） | slide 序号 + 归一化坐标 | 简单直接 |
| 图片/SVG 预览 | 图钉（可带矩形框选） | 归一化坐标 (+rect) | 无；最成熟模式 |
| PDF | 划选（文本层）+ 图钉 | page + TextQuote / page + rect | Chromium PDF viewer 是 plugin，难注入——**建议 v1 不支持 PDF 批注** |
| HTML 预览 | 划选浮条 + 图钉 | CSS selector + TextQuote | 在 webview 内，需 postMessage 桥 |

## 四、批注的"去向"决定架构（三个候选，可叠加）

- **A. 喂给 agent（引用式，免持久化）**：批注=选中内容+位置说明+一句人话，插入聊天输入框（扩展已有 @引用文件 机制：`@file.md#L12-L18` + 引文）。解决"指着文件某处让 agent 改"这一最高频痛点。**零存储、零锚点存活问题**（即时引用）。
- **B. 持久批注层（sidecar）**：`<root>/.mafw/annotations.jsonl`，每条 {file, selectors[], body, status, createdAt}；树角标 + tab 内批注面板 + 预览内标记（高亮/图钉）。解决"审阅留痕、多轮任务跟踪"。需要重锚引擎。
- **C. 内联写回文件**：如 Markdown 里插 `> [!note]` / HTML 注释。**不建议**（污染文件、写权限冲突）。

候选路线：**v1 = A（选区→引用到对话，覆盖文本类+图片坐标描述）→ v2 = B（持久层+重锚）**。A 是 B 的子集（B 的"发送到对话"按钮复用 A 的引用格式）。

## 五、开放问题（定方向前需要用户拍板）

1. **核心目的**：批注主要是为了"指给 agent 改"（A 优先），还是"自己的审阅笔记要留下来"（B 优先），还是两者都要（A→B 路线）？
2. v1 范围：先做哪些类型的批注？（建议：文本划选 + 图片图钉 两类起步）
3. PDF/HTML（webview 内）批注是否接受 v1 缺席？

## 六、交互逻辑深挖：「人标出 → agent 改」的回路（2026-10-27 增补）

用户反馈：现有批注交互逻辑难受。先解剖现状链路，再对照业界。

### 现状链路（我们的）

```
选中文本 → 浮动「批注」按钮出现 → 点击按钮 → 弹出输入框 → 输入
  → 二选一：「加入批注」（草稿卡攒在 composer 上方）/「立即发送」
  →（草稿路径）再去 composer 点发送
```

**5-6 步、每步都有决策点**：浮钮要等要点、发送前要做"攒还是发"的选择题、草稿路径还要多一次发送动作。且发送后锚点处无任何反馈——人要去聊天流/审阅面板自己找 agent 改没改。

### 业界对照（四种交互逻辑）

| 工具 | 链路 | 步数 | 关键设计 |
|---|---|---|---|
| **Cursor Cmd+K** | 选中 → Cmd+K → 就地输入框（出现在选区正上方）→ **Enter = 直接执行** → inline diff → Cmd+Enter 接受 / Esc 拒绝 | 3 | 输入框贴着选区；无草稿概念；执行结果原地 diff |
| **VS Code Copilot** | 选中 → Ctrl+I → inline chat | 3 | 同上 |
| **GitHub PR review** | 行槽 + → 评论框 → 显式二选一：**Add single comment**（立即）/ **Start a review**（攒批量统一提交） | 3 | 二选一存在但**语义清晰**（单条 vs 审阅批次），且 review 模式一旦开始后续评论自动并入 |
| **Figma 评论** | 点击落钉 → **就地输入框直接打开** → Enter 发布 | 3 | 落钉动作完成即输入，没有中间按钮 |

共同模式：**标记动作完成 = 输入框已经在标记旁等着了**；中间没有一个"点按钮召唤输入框"的步骤。GitHub 证明了"立即发 vs 攒批量"可以并存，但它的二选一是**模式级**（一旦进 review 模式，后续自动攒），不是**每条都要选**。

### 提炼的交互逻辑原则

1. **标记即输入**：选区/落点完成 → 输入框就地打开。砍掉中间浮钮（或浮钮降级为键盘不熟用户的发现性入口）。
2. **Enter = 最快路径**：默认立即发送给 agent；**Ctrl+Enter = 加入草稿**（批量审阅场景的显式次要动作）。消灭"每条都要选"的决策疲劳。
3. **回路闭合在原地**：发送后锚点处留「处理中」标记（点/高亮）；agent 回合结束 → 标记变「已回应」，点击跳到审阅面板对应 diff。人不用去别处找结果。
4. **键盘可达**：选中后 `Ctrl+M`（或直接开始打字）打开输入框；Esc 取消。

### 对现状的改造点（与预览批注 spec 合并）

- 源码面与预览面**同一套交互**：标记 → 就地输入 → Enter 发送。
- 「加入批注/立即发送」双按钮 → Enter / Ctrl+Enter 分工；PendingAnnotations 草稿卡保留（批量场景），但变成次要路径。
- 新增锚点反馈态（pending → responded），点击跳审阅。

### 来源补充

- Cursor Docs / cursor.com/docs/inline-edit：Cmd+K inline edit、Cmd+Enter accept / Esc reject
- VS Code Docs：Inline chat (Ctrl+I)
- GitHub Docs：Commenting on a pull request（single comment vs review 双路径）
- anthropics/claude-code#62180：社区明确把 Cursor 式 inline edit 列为更快的工作流

- Hypothesis Fuzzy Anchoring（web.hypothes.is/blog/fuzzy-anchoring）——生产级重锚策略
- W3C Web Annotation Data Model（TextQuoteSelector/TextPositionSelector/RangeSelector/FragmentSelector/refinedBy）
- wal.sh《Annotation Systems for Evolving Documents》——锚点存活性分类
- GitHub PR 行评论（diff position 重定位/outdated 标记）；VS Code Copilot / Cursor "Add to Chat"（选区→@引用）
- Figma 评论（坐标图钉 + 线程 + resolve）；BugHerd/Heurio（网页图钉化）
