---
name: office-editing
description: Edit Office files (pptx, xlsx, docx) and PDFs with the persistent Python kernel. Use when the user asks to modify an existing deck/spreadsheet/document, fill a template, replace text/images, fill PDF forms, add PDF watermarks/page ops, or generate an editable PPTX. Prefer python-pptx/openpyxl/python-docx and mafw_pdf over raw OOXML; always snapshot before saving.
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

# 图表：categories + {系列名: 数值}；先 inspect 拿 shape 名
mafw_office.set_chart_data(
    path, 2, "Chart 1",
    categories=["Q1", "Q2", "Q3"],
    series={"营收": [1.0, 1.2, 1.5], "成本": [0.6, 0.7, 0.8]},
)
```

- `inspect_deck` 的 chart 信息含 `categories` / `series_values`，改前先看。
- 图表类型（柱/线/饼）不变；只替换数据。

## 5. 保存后必须校验

- 重新 `inspect_deck(path)` 打开：页数、修改处文字、表格/图片/备注仍在。
- xlsx 用 `inspect_workbook`、docx 用 `inspect_document` 做同样的重开校验。
- 报告 `replacements` 数量与页数；若为 0，说明没匹配到，不要声称已改。
- 工作台预览会自动刷新（fs watch）；结构正确不等于版面正确。

### 5.1 视觉质检（Windows + Office）

```python
# pptx / xlsx / docx 自动分派：PowerPoint / Excel / Word COM → PDF → PNG
render = mafw_office.render_office(path, r"C:\work\proj\.render", width=1280, montage=True)
print(render)  # {ok, engine, out_dir, pdf, images:[...], montage?: {path,...}}

# 只渲染指定页（仅 pptx）
render = mafw_office.render_deck(path, r"C:\work\proj\.render", slides=[1, 2])
```

- 多页文档用 `montage=True`：生成一张拼图 `render["montage"]["path"]`，只对拼图调一次
  `mafw_media_ask`，比逐页调用省时省钱；单页时无 `montage`。
- 需要逐页细看时再关掉 montage。

- xlsx 走 Excel COM、docx 走 Word COM；导出 PDF 后用 pypdfium2 转 PNG，`images[].page` 是页号。
- `ok: False`（`pywin32-missing` / `pypdfium2-missing` / `render-failed` / 非 Windows）→ 说明原因，
  请用户看工作台预览；不要假装做过视觉检查。
- 对每张 PNG 调 `mafw_media_ask`（`mediaPath=<png>`）：
  「检查这页是否有文字溢出、元素遮挡、文字截断、明显错位或留白异常；只报告问题，不要改文件。」
- 有版面问题 → 改内容/字号/位置 → 重新 render → 再检查。
- 只有实际看过渲染图，才能说「视觉已验证」。渲染目录是临时产物，交付前可删除。

## 6. 边界与纪律

- **不要**改 SmartArt / 动画 / OLE / 3D 模型（python-pptx 不建模；通常原样保留但不可编辑）。
- **不要**用 `Presentation().slides` 的默认 4:3 新建后直接覆盖现有模板；新 deck 显式设 16:9（13.333×7.5 in）或沿用模板尺寸。
- **不要**整段赋值 `.text =` 改已有文字（丢行内格式）；用 `replace_text` 或逐 run 改。
- 文件被占用/保存失败 → 提示用户关闭对应 Office 应用；不要重试覆盖。
- legacy `.xls/.doc/.ppt` 先 `convert_legacy` 成现代副本再编辑，不要直接改原文件。
- 批量修改前先输出副本（`out=...`），确认后再 `os.replace` 覆盖原文件。
- 每次写文件前都 `snapshot`；没有备份的破坏性操作不做。
- 生成新 deck 优先用模板（用户提供的 pptx）而不是默认空白。

## 7. xlsx / docx

先 inspect，改完重开校验；保存前 `snapshot`。

### 7.1 xlsx

```python
print(mafw_office.inspect_json_workbook(path, include_formulas=True))  # 值 + 公式 + merged
mafw_office.set_cells(path, [
    {"sheet": "Sheet1", "cell": "B2", "value": 99},
    {"cell": "C3", "value": "new"},              # 省略 sheet = 第一个 sheet
])
mafw_office.set_formulas(path, [{"sheet": "Sheet1", "cell": "D2", "formula": "=SUM(B2:B9)"}])
mafw_office.set_cell_style(path, [{
    "sheet": "Sheet1", "cell": "A1", "bold": True, "size": 14,
    "fill": "FFF2CC", "number_format": "0.0%", "align": "center", "border": "thin",
}])
mafw_office.set_sheet_layout(path, sheet="Sheet1", columns={"A": 24}, rows={"1": 32}, freeze="A2")
mafw_office.add_image(path, "Sheet1", "F2", r"C:\work\proj\logo.png", width=96, height=48)
mafw_office.add_chart(
    path, "Sheet1", "column", data_range="B1:B4",
    categories="A2:A4", title="季度营收", anchor="E2",
)
mafw_office.add_sheet(path, title="附录", index=2)
mafw_office.rename_sheet(path, "附录", "Appendix")
mafw_office.delete_sheet(path, "Appendix")
```

- `set_cells` / `set_cell_style` 保留未指定的样式；`fill/color` 用 6 位 RGB。
- `set_formulas` 只写公式字符串；**Excel 打开时才重算**，openpyxl 不计算。需要最终数值时用 Excel COM 打开保存，或让用户确认。
- `add_image` 需要 Pillow；`set_sheet_layout` 的 `freeze=""` 可取消冻结。
- 图表/宏（xlsm）不建模；复杂图表改数据请先确认用户接受风险。

### 7.2 docx

```python
print(mafw_office.inspect_json_document(path))   # 段落（含 index/style）+ 表格 + 页眉页脚
mafw_office.set_paragraph(path, 1, "新的第一段")          # 1-based body index，保 run 格式
mafw_office.add_paragraph(path, "插入的一段", after=1)
mafw_office.docx_set_table_cell(path, 1, 1, 1, "新值")    # 表 1 / 行 1 / 列 1
mafw_office.add_table_row(path, 1, ["新行 A", "新行 B"])
mafw_office.docx_add_table(path, [["列1", "列2"], ["a", "b"]], style="Table Grid")
mafw_office.set_header(path, "2026 年度报告")
mafw_office.set_footer(path, "内部资料 · 第 1 页")
mafw_office.docx_add_picture(path, r"C:\work\proj\shot.png", width_inches=4.5)
mafw_office.replace_text_docx(path, {"2025": "2026"})
mafw_office.docx_add_comment(path, 1, "这里需要补充数据来源", author="Reviewer")
mafw_office.docx_insert_toc(path, levels=3, title="目录")
mafw_office.docx_set_page_number_footer(path, "第 {PAGE} 页 / 共 {NUMPAGES} 页")
mafw_office.docx_update_fields(path)   # Word COM：更新 TOC/页码域
```

- 批注用 `docx_add_comment`（1-based body 段落），`inspect_document` 会返回 `comments`。
- TOC/页码是 Word 域：插入后设 `w:updateFields`，再用 `docx_update_fields`（Windows + Word）更新；
  没有 Word 时让用户打开文档按 F9 更新。
- `.xlsm` 走 `keep_vba=True` 编辑，保留宏容器；openpyxl 仍不建模宏/复杂图表。

- `replace_text_docx` 走 run 级替换（保字体/字号），覆盖正文段落、表格、页眉、页脚；跨 run 命中会合并该段 run。
- `set_header` / `set_footer` 默认第 1 节；多节文档用 `section_index`。
- 批注、复杂域代码（TOC/页码域）、图表暂不覆盖；复杂版式先 inspect 并向用户确认。

两者同样遵守“先 inspect → 快照 → 小步改 → 重开校验 → 渲染质检”：
结构校验后用 `render_office` 导出 PNG，再按 §5.1 用 `mafw_media_ask` 看是否有溢出/遮挡/错位。

## 8. Legacy .xls / .doc / .ppt

不要直接改 legacy 二进制；先转成现代格式，编辑转换副本：

```python
res = mafw_office.convert_legacy(path, out=r"C:\work\proj\converted.xlsx")
print(res)  # {ok, engine, out} 或 {ok:False, reason:'exists'|'not-legacy'|...}
```

- 默认输出同名 `.xlsx/.docx/.pptx`；目标已存在会返回 `exists`，换 `out` 或显式 `overwrite=True`。
- 转换可能改变排版/字体；编辑副本后让用户确认是否替换原文件，不要静默覆盖 legacy。
- 转换后按正常流程 `inspect → snapshot → 编辑 → 校验 → render`。

## 9. PDF（有限编辑）

PDF 没有流式文本模型，**不能像 docx 一样改字**。`mafw_pdf` 覆盖结构编辑、表单、叠加和渲染：

```python
import mafw_pdf
print(mafw_pdf.inspect_json_pdf(path))          # 页数/尺寸/元数据/表单字段/文本摘录
print(mafw_pdf.extract_text(path, pages=[1]))   # 指定页文本

mafw_pdf.fill_form(path, {"customer": "Alice"}, out=r"C:\work\proj\filled.pdf")
mafw_pdf.add_text(path, "APPROVED", x=72, y=100, pages=[1], font_size=14, out=r"C:\work\proj\stamped.pdf")
mafw_pdf.watermark(path, "DRAFT", out=r"C:\work\proj\wm.pdf", opacity=0.15, angle=45)
mafw_pdf.add_image(path, r"C:\work\proj\logo.png", x=72, y=200, width=96, height=72, out=r"C:\work\proj\logo.pdf")

mafw_pdf.rotate_pages(path, [1], 90, out=...)
mafw_pdf.delete_pages(path, [2], out=...)
mafw_pdf.reorder_pages(path, [2, 1], out=...)
mafw_pdf.add_blank_page(path, 2, out=...)
mafw_pdf.merge_pdfs([a, b], r"C:\work\proj\merged.pdf")
mafw_pdf.split_pdf(path, r"C:\work\proj\parts", ranges=["1-2", "3"])
mafw_pdf.set_metadata(path, {"Title": "合同", "Author": "MAFW"}, out=...)
render = mafw_pdf.render_pdf(path, r"C:\work\proj\.render", width=1280)
```

- **坐标**：points（1/72 inch），从页面**左上角**起算；页尺寸从 `inspect_pdf` 取（A4 = 595×842）。
- **改文字**：优先改源 docx/pptx 后重新导出；PDF 只能叠加/水印/表单。用白底矩形盖住旧字再叠新字会漂移字体/位置，且**旧词仍在文本层**（复制/搜索会出现新旧两份），非必要不要做。
- **加密 PDF**：`inspect_pdf(..., password=...)`；编辑函数也接受 `password`（部分函数未透传时先解密另存）。
- 表单字段先 `inspect_pdf` 看 `form_fields`；`fill_form` 后可重开确认 `/V` 值。
- 页面操作默认写回原文件；建议 `out=` 输出副本，确认后再替换。
- 渲染质检：`mafw_pdf.render_pdf` → `mafw_media_ask`；多页用 `montage_images` 拼图（与 Office 相同）。
- 流程：`snapshot → inspect_pdf → 编辑副本 → 重开 inspect → render → mafw_media_ask`。

## 10. 参考

- python-pptx 文档：https://python-pptx.readthedocs.io/
- 本仓库 helper：`gateway/scripts/office/mafw_office.py`（安装后在 kernel site-packages）
- 文件级历史 API：`POST /api/file-history/snapshot`、`GET /api/file-history`、`POST /api/file-history/restore`
- 调研：`docs/research/2026-10-31-office-agent-editing-research.md`
