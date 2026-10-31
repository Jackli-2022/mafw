---
name: office-editing
description: Edit Office files (pptx first, then xlsx/docx) with the persistent Python kernel. Use when the user asks to modify an existing deck/spreadsheet/document, fill a template, replace text/images, or generate an editable PPTX. Prefer python-pptx/openpyxl/python-docx over raw OOXML; always snapshot before saving.
argument-hint: "[file] [change]"
metadata:
  author: mafw
  version: "1.0.0"
---

# Office Editing（PPT 起步）

用 `mafw_python`（会话持久内核）里的 `python-pptx` / `openpyxl` / `python-docx` 编辑**真实文件**；
保存前后走文件级历史与工作台预览，不直接拼 OOXML。

## 何时使用

- 改现有 `.pptx` / `.xlsx` / `.docx`：改文字、备注、表格、图片、页序、主题色。
- 从模板/数据生成可编辑的 PPTX。
- 用户在工作台预览里批注了 Office 文件，要求按批注修改。
- 不适用：只想预览/讲解（用工作台预览即可）；PDF 编辑（另议）；整页图片式 PPT。

## 0. 环境检查（只做一次）

在 `mafw_python` 里执行：

```python
import importlib.util
print({m: bool(importlib.util.find_spec(m)) for m in ("pptx", "openpyxl", "docx", "PIL")})
```

缺包时，在 **bash** 里运行（不要用 pip 污染其他环境）：

```bash
mafw office setup
```

它会创建/刷新 `~/.mafw/pykernel`（ipykernel + numpy/pandas/matplotlib + office 三件套 + Pillow），
把 `mafw_office.py` 装进 site-packages，并把本技能同步到全局 opencode 技能目录。
之后 `mafw_python` 的默认解释器优先使用该 venv（网关重启后生效；临时可设 `MAFW_PYTHON_BIN` 指向它）。
查看状态：`mafw office status`。仓库贡献者可回退 `node gateway/scripts/setup-pykernel.mjs`。

## 1. 确定绝对路径与工作台根

- 文件路径一律用**绝对路径**（内核 cwd 是 gateway cwd，不是会话目录）。
- 会话目录 = 工作台文件树根（普通会话=项目目录，worktree=worktree 目录）。
- 不要编辑 PowerPoint/WPS 正在打开的文件（锁/覆盖风险）；先让用户关闭。

## 2. 先快照，再编辑

`mafw_office.snapshot([...])` 调 gateway 文件级历史（内核环境里有 `MAFW_SESSION_ID`）：

```python
import mafw_office, os
path = r"C:\work\proj\deck.pptx"
print(mafw_office.snapshot([path], reason="office-edit"))
```

失败（`ok: False`）不阻塞编辑，但要在最终回复里说明“本次没有文件历史备份”。

## 3. 先 inspect，再动手（PPT）

```python
import mafw_office, json
info = mafw_office.inspect_deck(path)
print(json.dumps({
  "slide_count": info["slide_count"],
  "slides": [
    {"index": s["index"], "title": s["title"], "notes": s["notes"],
     "shapes": [{"name": x["name"], "type": x["type"], "text": x.get("text", "")[:120]} for x in s["shapes"]]}
    for s in info["slides"]
  ],
}, ensure_ascii=False, indent=2))
```

要点：先看清楚页数、标题、占位符/文本框名字、备注、表格/图表/图片；**不要凭猜测改**。

## 4. 常用编辑配方

### 4.1 保格式替换文字（含表格/备注）

```python
import mafw_office
res = mafw_office.replace_text(path, {"2025": "2026", "旧产品名": "新产品名"})
print(res)  # {"ok": True, "replacements": 3, "out": ...}
```

- 单 run 内命中 → 只改该 run，字体/字号/颜色保留。
- 跨 run 命中 → 合并该段落到第一个 run（仅该段行内格式丢失）。
- 默认同时处理表格与备注；`slides=[2,3]` 可限定页；`out=...` 输出副本（推荐先副本再确认）。

### 4.2 改备注

```python
mafw_office.set_notes(path, 3, "讲稿：本页强调留存率，不要念数字。")
```

### 4.3 改单个文本框（保格式）

`target` 用 inspect 得到的 shape 名称（或 shape_id）：

```python
mafw_office.set_text(path, 2, "Title 1", "2026 年度回顾")
mafw_office.set_paragraphs(path, 2, "Content Placeholder 2", ["第一段", "第二段"])
```

- 保留该段第一个 run 的字体/字号/颜色；其余 run 清空。
- 不要用 `.text =` 整段赋值（会丢行内格式）。

### 4.4 新增/删除/移动页

```python
mafw_office.add_slide(path, layout_index=1, index=2)  # layout 从 inspect 的 slide_layout 选
mafw_office.delete_slide(path, 3)
mafw_office.move_slide(path, 2, 1)
```

页序操作已经封装 `p:sldIdLst`；不要再手写 XML。

### 4.5 替换图片（保留位置尺寸）

```python
mafw_office.replace_image(path, 2, "Picture 4", r"C:\work\proj\new.png")
```

`target` 是 inspect 里的 picture shape 名称；底层兼容 python-pptx 1.x 的
`get_or_add_image_part` / `rEmbed`。

### 4.6 改表格单元格 / 图表数据

```python
mafw_office.set_table_cell(path, 2, "Table 3", row=2, col=2, text="$1.2M")

chart = slide.shapes["营收图"].chart
from pptx.chart.data import CategoryChartData
data = CategoryChartData()
data.categories = ["Q1", "Q2", "Q3"]
data.add_series("营收", (1.0, 1.2, 1.5))
chart.replace_data(data)
```

图表数据仍走 python-pptx 原生 `replace_data`（helper 未封装）。

## 5. 保存后必须校验

- 重新 `inspect_deck(path)` 打开：页数、修改处文字、表格/图片/备注仍在。
- xlsx 用 `inspect_workbook`、docx 用 `inspect_document` 做同样的重开校验。
- 报告 `replacements` 数量与页数；若为 0，说明没匹配到，不要声称已改。
- 工作台预览会自动刷新（fs watch）；让用户看预览确认视觉。视觉细节（溢出/重叠）目前需要用户或以后用 PowerPoint COM 导出 PNG 检查。

## 6. 边界与纪律

- **不要**改 SmartArt / 动画 / OLE / 3D 模型（python-pptx 不建模；通常原样保留但不可编辑）。
- **不要**用 `Presentation().slides` 的默认 4:3 新建后直接覆盖现有模板；新 deck 显式设 16:9（13.333×7.5 in）或沿用模板尺寸。
- **不要**整段赋值 `.text =` 改已有文字（丢行内格式）；用 `replace_text` 或逐 run 改。
- 文件被占用/保存失败 → 提示用户关闭 PowerPoint；不要重试覆盖。
- 批量修改前先输出副本（`out=...`），确认后再 `os.replace` 覆盖原文件。
- 每次写文件前都 `snapshot`；没有备份的破坏性操作不做。
- 生成新 deck 优先用模板（用户提供的 pptx）而不是默认空白。

## 7. xlsx / docx

先 inspect，改完重开校验；保存前 `snapshot`。

### 7.1 xlsx

```python
print(mafw_office.inspect_json_workbook(path))   # sheets / max_row / max_col / 前 20 行
mafw_office.set_cells(path, [
    {"sheet": "Sheet1", "cell": "B2", "value": 99},
    {"cell": "C3", "value": "new"},              # 省略 sheet = 第一个 sheet
])
```

- `set_cells` 保留单元格样式；公式按字符串写入，不执行。
- 图表/宏（xlsm）不建模；复杂图表改数据请先确认用户接受风险。

### 7.2 docx

```python
print(mafw_office.inspect_json_document(path))   # 段落前 100 条 + 表格
mafw_office.replace_text_docx(path, {"2025": "2026"})
```

- `replace_text_docx` 走 run 级替换（保字体/字号）；跨 run 命中会合并该段 run。
- 页眉页脚/批注/复杂域代码暂不覆盖，复杂版式先 inspect 并向用户确认。

两者同样遵守“先 inspect → 快照 → 小步改 → 重开校验”。

## 8. 参考

- python-pptx 文档：https://python-pptx.readthedocs.io/
- 本仓库 helper：`gateway/scripts/office/mafw_office.py`（安装后在 kernel site-packages）
- 文件级历史 API：`POST /api/file-history/snapshot`、`GET /api/file-history`、`POST /api/file-history/restore`
- 调研：`docs/research/2026-10-31-office-agent-editing-research.md`
