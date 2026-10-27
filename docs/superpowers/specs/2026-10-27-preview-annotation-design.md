# 预览批注（指给 agent 改）设计（2026-10-27）

## 意图

工作台文件预览矩阵（图片/SVG/CSV/Markdown/JSON/DOCX/XLSX/PPTX）目前没有批注触发面——批注只能在 CodeMirror 源码选区发起。用户场景：**看着预览，指着某处让 agent 改**（一次性引用，非持久审阅笔记）。调研：`docs/research/2026-10-27-annotation-interaction-research.md`。

## 核心决策

- **复用既有批注管线零改动**：`annotation-store`（electron-store 持久）→ `PendingAnnotations`（composer 上方批注卡）→ `buildAnnotationBatch`（发送打包文本块）→ `takeForSend`（发送即清）。本特性只扩展**触发面**与**锚点类型**。
- **锚点联合类型**：`Annotation` 增加可选 `anchor` 字段（discriminated union），现有 `{startLine, endLine, code}` 行号锚保留不动（向后兼容持久数据）。
- **去向 = 指给 agent 改**（用户 2026-10-27 裁决）：一次性引用，发送即清；不做持久批注层/重锚引擎/树角标（那些是 B 路线，未来需要再说）。

## 锚点类型与交互

| # | 预览面 | 交互 | anchor | agent 文本格式 |
|---|---|---|---|---|
| A1 | Markdown / DOCX 渲染 | 划选文本 → 浮动「批注」按钮（QuoteToolbar 同款：Portal + mousedown preventDefault）→ 小输入框 | `{kind:"quote", quote, context?}`（选中文本，截 500 字符） | `文件 rel 节选："…"（渲染预览）` |
| A2 | JSON 树 | 点击节点行尾「批注」入口（hover 显现）→ 输入框 | `{kind:"jsonPath", path, valueSummary}` | `文件 rel 路径 $.a.b（当前值 …）` |
| A3 | CSV/TSV/XLSX 表格 | 点击单元格 → 输入框 | `{kind:"cell", sheet?, ref, value}`（ref=A1 样式；xlsx 带 sheet 名） | `文件 rel 工作表"销售" 单元格 B2（当前值 …）` |
| A4 | 图片 / SVG 预览 | **拖框选区**（mousedown+drag 在相对定位 wrapper 上）→ 松手出输入框 | `{kind:"region", x, y, w, h}`（0-1 归一化） | `图片 rel 区域 (x%, y%, w%×h%)` + **裁剪 PNG 附件**（canvas 裁剪 → 既有附件/媒体管道，同 G1） |
| A5 | PPTX 预览 | 点击某页幻灯片 → 图钉批注 | `{kind:"region", x, y, w:0, h:0, slide?}` | `文件 rel 第 N 页 (x%, y%)` |
| — | PDF | — | — | **v1 缺席**（Chromium PDF viewer 是 plugin，无法注入事件层） |
| — | HTML | — | — | 已有 G2 元素点选覆盖，不重复 |

统一交互细节：
- 批注输入框复用 `LineCommentEditorV2`（源码批注同款，「加入批注」草稿 /「立即发送」直发两个动作）。
- Esc / 点击外部取消；选区/框选随预览切换/文件切换清空。
- 批注卡在 `PendingAnnotations` 中按 anchor 类型渲染标签：`rel:L12-18`（现有）/ `rel › $.a.b` / `rel › B2` / `rel › 区域` / `rel › 节选"…"`。

## 数据模型

```ts
// src/shared/annotation-types.ts（追加，不改动现有字段）
export type AnnotationAnchor =
  | { kind: "quote"; quote: string; context?: string }
  | { kind: "jsonPath"; path: string; valueSummary: string }
  | { kind: "cell"; sheet?: string; ref: string; value: string }
  | { kind: "region"; x: number; y: number; w: number; h: number; slide?: number }

export type Annotation = {
  // …现有字段原样…
  anchor?: AnnotationAnchor       // 缺省 = 行号锚（旧数据兼容）
  imageDataUrl?: string           // A4 裁剪截图（发送时转附件，不持久化到 electron-store——体积）
}
```

注意：`imageDataUrl` 只存内存 store 层（annotation-store 加内存镜像），不落 electron-store（PNG base64 体积大）；发送时经 use-send-message 转附件（同 pending-captures 路径）。应用重启丢失区域批注的截图但保留文字锚——可接受（一次性用途）。

## 发送打包（editor-annotation.ts 扩展）

`annotationBlock` 按 anchor 分支渲染：
- 无 anchor：现有行号格式不变。
- quote：`文件 \`rel\` 节选（渲染预览）："quote"` + 批注。
- jsonPath：`文件 \`rel\` 路径 \`$.a.b\`（当前值 \`summary\`）：` + 批注。
- cell：`文件 \`rel\` 工作表"X" 单元格 \`B2\`（当前值 \`v\`）：` + 批注。
- region：`图片 \`rel\` 区域 (x%, y%, w%×h%)：截图见附件` + 批注；slide 存在时 `第 N 页` 前缀。

## 非目标

- 持久批注层 / 锚点重锚引擎 / 树角标（B 路线）。
- PDF 批注、HTML 批注（G2 已覆盖）。
- 手写墨迹、多图钉线程、resolve 状态。
- 批注卡点击跳回预览定位（nice-to-have，留后续）。

## 测试策略

- 纯逻辑：anchor → 文本块格式（每种类型矩阵）；JSON pointer 计算；A1 单元格 ref 计算（行列 → A1）；归一化坐标换算（px ↔ 0-1，含 object-fit:contain 的 letterbox 校正）；quote 截断。
- store：anchor 字段持久化兼容（旧数据无 anchor 照常渲染/发送）。
- UI 契约：各预览面批注入口存在；PendingAnnotations 新标签格式。
- GUI 冒烟：md 划选批注、json 节点批注、xlsx 单元格批注、图片拖框批注（含裁剪附件出现在附件条）、pptx 图钉。

## 风险

- **object-fit:contain letterbox**：图片实际显示区域 ≠ 容器区域，坐标换算必须基于 `<img>` 的渲染盒（已有 `recordImageDims` 记录 natural 尺寸）。
- **docx-preview DOM**：渲染 DOM 结构深，划选取 `window.getSelection().toString()` 即可（不依赖 DOM 位置）。
- **pptx-preview slide 边界**：需要识别点击落在第几页——若库不暴露 slide 结构，降级为「坐标 + 用户自选页码」或直接全图坐标（spike 时确认）。
- **Vite 模块缓存半截更新坑**（已知）：改 preview 组件后 GUI 冒烟前重启 dev。
