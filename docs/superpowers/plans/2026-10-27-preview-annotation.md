# 预览批注 + 交互重写实施计划（2026-10-27）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 checkbox。

**Goal:** 把批注触发面从源码选区扩展到全部预览面（md/docx 划选、json 节点、csv/xlsx 单元格、图片/svg 拖框、pptx 图钉），并把交互从「浮钮→弹框→二选一」重写为「标记即输入，Enter 发送 / Ctrl+Enter 攒草稿」，加锚点反馈态。

**Architecture:** 既有管线零改动（annotation-store → PendingAnnotations → buildAnnotationBatch → takeForSend）。新增：anchor 联合类型（shared）+ 纯逻辑 `annotation-anchor.ts` + 共享输入浮层 `AnnotationPopover` + 反馈标记 `annotation-marks.ts`（SSE turn.completed 驱动状态翻转）。

**Spec:** `docs/superpowers/specs/2026-10-27-preview-annotation-design.md`；调研 `docs/research/2026-10-27-annotation-interaction-research.md`

## Global Constraints

- 测试：desktop `npm test`（node --test + `@mafw/test-shim`，纯逻辑与 src 同目录 `.test.ts`）；UI 契约测试放 `packages/desktop/tests/`。
- UI 组件纪律（AGENTS.md §5.10）：禁裸 `<button>`/`<input>`/裸 `title`；一律 ButtonV2 / TextareaV2 / TooltipV2。面板内禁 emoji。
- 样式全部入 `mafw.css` + 主题 token；动效走 `--dur-fast`(140ms) / `--dur-surface`(280ms) 既有 token；脉冲动画 opacity-only + reduced-motion 降级。
- 不新增依赖。图片裁剪用 canvas（`crossOrigin="anonymous"` + mafw-file ACAO 已具备）。
- `imageDataUrl` 只存内存（annotation-store 内存镜像 Map），**不落 electron-store**；发送时转附件（同 pending-captures 路径），发送后清。
- 每任务一次 commit；全程 tsgo rc=0。

## Review Focus

1. `object-fit:contain` letterbox：图片渲染盒 ≠ 容器盒，拖框坐标必须基于渲染盒换算（T7 专项测试：宽图/高图两例）。
2. 划选浮条与复制/拖选冲突：浮层按钮 `mousedown preventDefault` 保选区（T4 钉扎）。
3. 多会话并行时反馈标记串会话：marks 按 sessionID 隔离（T9 测试）。
4. PPTX slide 边界可能不可知：降级为纯坐标 + 文案不带页码（T8 含 spike 步骤与降级断言）。
5. 旧持久批注数据（无 anchor 字段）必须照常渲染/发送（T1 兼容测试）。

---

### Task 1: anchor 类型 + 纯逻辑 `annotation-anchor.ts`

**Files:**
- Modify: `packages/desktop/src/shared/annotation-types.ts`（追加 `AnnotationAnchor` + `Annotation.anchor?` / `Annotation.imageDataUrl?`）
- Create: `packages/desktop/src/renderer/mafw/annotation-anchor.ts`
- Test: `packages/desktop/src/renderer/mafw/annotation-anchor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type AnnotationAnchor =
    | { kind: "quote"; quote: string; context?: string }
    | { kind: "jsonPath"; path: string; valueSummary: string }
    | { kind: "cell"; sheet?: string; ref: string; value: string }
    | { kind: "region"; x: number; y: number; w: number; h: number; slide?: number }
  describeAnchor(a: AnnotationAnchor): string                    // 卡片标签："$.a.b" / "B2" / "区域 12%,34%" / "节选"
  anchorBlockLines(rel: string, a: AnnotationAnchor): string[]   // 发送文本块的位置描述行（不含批注正文）
  jsonPathOf(path: (string | number)[]): string                  // ["a","b",0] → "$.a.b[0]"
  a1Ref(row: number, col: number): string                        // 1-based → "B2"；col>26 → "AA1" 式
  normalizeRect(x0,y0,x1,y1, boxW, boxH): {x,y,w,h}              // px→0-1，clamp，最小 0.005
  letterboxRect(natW, natH, boxW, boxH): {left,top,w,h}          // contain 渲染盒
  ```

- [ ] **Step 1: 写失败测试**：describeAnchor 四类标签；anchorBlockLines 四类格式（quote 带「渲染预览」标注、cell 带 sheet、region 带百分比、jsonPath 带当前值）；jsonPathOf 含数组索引/特殊键（`$."a.b"` 转义）；a1Ref(2,2)="B2"、(1,27)="AA1"；normalizeRect 越界 clamp + 反向拖拽归一；letterboxRect 宽图（natW>boxW 按比例）与高图两例。
- [ ] **Step 2: 跑测试确认失败** `node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/annotation-anchor.test.ts`
- [ ] **Step 3: 实现** annotation-types.ts 追加 + annotation-anchor.ts。
- [ ] **Step 4: 兼容测试**：构造无 anchor 的旧 Annotation 对象，`anchorBlockLines` 不被调用时走原行号路径（editor-annotation 现状不变）。
- [ ] **Step 5: 跑过 + `npx tsgo -b` rc=0 + commit** `feat(desktop): annotation anchor types + pure helpers`

### Task 2: 共享输入浮层 `AnnotationPopover` + 批注卡标签

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/AnnotationPopover.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PendingAnnotations.tsx`（anchor 标签 + 类型图标）
- Test: `packages/desktop/tests/annotation-popover-ui.test.ts`

**Interfaces:**
- Produces:
  ```tsx
  <AnnotationPopover left top placeholder onSubmit={(comment, mode: "send" | "draft")} onCancel />
  // Enter=send / Ctrl+Enter=draft / Shift+Enter=换行 / Esc=cancel；挂载自动 focus
  // hint："Enter 发送 · Ctrl+Enter 攒草稿 · Shift+Enter 换行"
  ```

- [ ] **Step 1: 失败 UI 契约测试**：组件含 `.mafw-annot-pop`、TextareaV2、两个 ButtonV2（发送/攒草稿）、hint 文案、无 emoji、无裸 button/input。
- [ ] **Step 2: 确认失败 → 实现**（TextareaV2 + keydown 捕获分工 + 进场 140ms 动效类）。
- [ ] **Step 3: PendingAnnotations 标签**：无 anchor → 旧 `rel:Lx-y`；有 anchor → `rel › describeAnchor(anchor)`（Task 1 导出）；图标按 kind 映射 lucide 名（text / braces / grid / crop）。
- [ ] **Step 4: 全量 desktop 测试 + tsgo + commit** `feat(desktop): shared annotation popover (Enter send / Ctrl+Enter draft)`

### Task 3: 源码面交互重写（Ctrl+M + 统一浮层）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`（annot-anchor 按钮 + annot-pop → AnnotationPopover；Ctrl+M keydown；`submitAnnotation` 保签名）
- Test: `packages/desktop/tests/annotation-popover-ui.test.ts`（追加）

**Interfaces:**
- Consumes: Task 2 AnnotationPopover；现有 `submitAnnotation(comment, "draft"|"send")`（L488）。
- Produces: `submitAnnotationAnchored(anchor: AnnotationAnchor | undefined, comment: string, mode: "send" | "draft")` —— T4-T8 的预览面全部走这一个出口；anchor=undefined 时完全等价旧行号行为。

- [ ] **Step 1: 失败测试**：EditorDock 源码含 `Ctrl+M`/`ctrlKey.*KeyM` 快捷键、`AnnotationPopover` 引用、浮钮保留（发现性入口）、「加入批注/立即发送」双按钮文案消失。
- [ ] **Step 2: 实现**：选区存在时 Ctrl+M → 开 AnnotationPopover（位置=选区 coords）；浮钮点击同效；popover onSubmit → submitAnnotation；onCancel/Esc → clearSelection。
- [ ] **Step 3: submitAnnotationAnchored 抽出**：旧 submitAnnotation 变其 anchor=undefined 特化；onAddAnnotation prop 类型扩 `{rel, startLine, endLine, code, comment, anchor?, imageDataUrl?}`（WorkbenchShell 透传 store）。
- [ ] **Step 4: desktop 全量 + tsgo + commit** `feat(desktop): source annotation interaction - Ctrl+M direct input, Enter send`

### Task 4: Markdown / DOCX 划选批注

**Files:**
- Modify: `EditorDock.tsx`（md 预览容器 + OfficePreview docx host 的 selection 监听）
- Create: `packages/desktop/src/renderer/mafw/quote-anchor.ts`（选区快照 → quote anchor；与 quote-selection.ts 的抑制逻辑同模式）
- Test: `quote-anchor.test.ts` + UI 契约追加

**Interfaces:**
- Consumes: `submitAnnotationAnchored`（T3）；QuoteToolbar 的 Portal/mousedown-preventDefault 模式（ChatPane L656-720 参照）。
- Produces: `captureQuoteSelection(container: HTMLElement): { quote: string; context?: string; left: number; top: number } | null`（quote 截 500；context=前后各 60 字符）。

- [ ] **Step 1: 失败测试**：captureQuoteSelection 折叠选区→null、正常选区→quote+context、超 500 截断；EditorDock md 预览块含 `data-annotatable="quote"`；浮钮 mousedown `preventDefault`（保选区，断言源码含该调用）。
- [ ] **Step 2: 实现**：md 预览容器 + OfficePreview docx host 挂 `data-annotatable="quote"`；EditorDock 统一 `selectionchange`（去抖 150ms）→ 选区落在 annotatable 容器内 → 显示批注浮钮（单钮「批注 Ctrl+M」）→ 点击/Ctrl+M → AnnotationPopover → submitAnnotationAnchored({kind:"quote",...})。
- [ ] **Step 3: 全量 + tsgo + commit** `feat(desktop): quote annotations on markdown/docx previews`

### Task 5: JSON 树节点批注

**Files:**
- Modify: `JsonPreview.tsx`（递归增 `path: (string|number)[]` prop；hover 行尾批注入口 → `props.onAnnotate?.(path, valueSummary, anchorRect)`）
- Modify: `EditorDock.tsx`（json 预览块接 onAnnotate → popover）
- Test: `annotation-anchor.test.ts` 追加 jsonPathOf 边界 + UI 契约（`data-annotatable="json"`）

- [ ] **Step 1: 失败测试**：JsonPreview 组件含 onAnnotate 回调与 hover 入口（`.mafw-json-annot`）；jsonPathOf 嵌套路径。
- [ ] **Step 2: 实现**：入口用 ButtonV2 ghost small（图标 message-square-plus 类 lucide）；valueSummary 用 `jsonSummary()`（已有）；点击 → popover（位置=入口 rect）→ anchor `{kind:"jsonPath", path: jsonPathOf(path), valueSummary}`。
- [ ] **Step 3: 全量 + tsgo + commit** `feat(desktop): json tree node annotations`

### Task 6: CSV/XLSX 单元格批注

**Files:**
- Modify: `EditorDock.tsx`（CSV/TSV 表格块：cell 渲染加 data-row/data-col + click 接线）
- Modify: `OfficePreview.tsx`（xlsx 表格同样接线；onAnnotate prop 透传 sheet 名）
- Test: `annotation-anchor.test.ts` 追加 a1Ref 已覆盖 + UI 契约

**Interfaces:**
- Consumes: `a1Ref`（T1）；表格现有渲染（EditorDock table 块、OfficePreview sheet 表格）。
- Produces: `onAnnotateCell(anchor: {kind:"cell", sheet?, ref, value}, left, top)`。

- [ ] **Step 1: 失败测试**：table cell 含 `data-cell-ref="B2"`；OfficePreview 透传 sheet。
- [ ] **Step 2: 实现**：`<td>/<th>` 加 data-cell-ref（渲染时由行列算 a1Ref）；容器 click 委托（event.target closest('[data-cell-ref]')）→ popover；xlsx 带当前 sheet 名。
- [ ] **Step 3: 全量 + tsgo + commit** `feat(desktop): cell annotations for csv/xlsx tables`

### Task 7: 图片/SVG 拖框批注 + 裁剪附件

**Files:**
- Modify: `EditorDock.tsx`（`.mafw-file-preview` 内插 relative wrapper + 拖框层）
- Create: `packages/desktop/src/renderer/mafw/region-capture.ts`（拖框状态机 + canvas 裁剪）
- Modify: `annotation-store.ts`（内存 `imageDataUrls: Map<annId, dataUrl>`，持久化路径排除）+ `use-send-message.ts`（region 批注的 dataUrl → 附件，文件名 `annotation-<id>.png`，复用 capture 附件路径）
- Test: `region-capture.test.ts` + UI 契约

**Interfaces:**
- Produces:
  ```ts
  startRegionDrag(e: PointerEvent, imgBox: {left,top,w,h}): RegionDrag    // 状态机：move→rect，up→final
  cropImageRegion(srcUrl: string, rect01: {x,y,w,h}, natW: number, natH: number): Promise<string /*dataUrl*/>
  ```
- Consumes: `letterboxRect/normalizeRect`（T1）；`imageMeta`（EditorDock 已有 natural 尺寸记录）。

- [ ] **Step 1: 失败测试**：normalizeRect 经 letterbox 换算两例（宽图黑边上下、高图黑边左右）；拖框 <8px 视为误触取消；store imageDataUrl 不进持久化序列化（断言 IPC 写入载荷无 dataUrl）。
- [ ] **Step 2: 实现**：wrapper `position:relative`；拖框层绝对定位全铺，pointerdown/move/up（setPointerCapture）；松手 → 显示选框（accent 虚线）+ AnnotationPopover（位置=框右下角）；提交 → anchor region + cropImageRegion → imageDataUrl 存内存镜像。
- [ ] **Step 3: use-send-message**：发送打包时 region 批注带 dataUrl → attachments（参照 pending-captures 的 capture-<id>.png 联动删除：批注删除时附件也删）。
- [ ] **Step 4: 全量 + tsgo + commit** `feat(desktop): drag-region image annotations with crop attachment`

### Task 8: PPTX 图钉批注

**Files:**
- Modify: `OfficePreview.tsx`（pptx host 点击 → pin）
- Test: UI 契约

- [ ] **Step 1: spike**：dev 跑起来看 pptx-preview 渲染 DOM 是否有每页容器（决定 slide 序号可不可知）。**结论写入本任务 commit message**。
- [ ] **Step 2: 实现**：host 上 click → 相对坐标归一化 → popover；若 slide 容器可识别 → anchor.slide = 序号（1-based），否则不带 slide（agent 文案只说坐标）。
- [ ] **Step 3: 全量 + tsgo + commit** `feat(desktop): pptx pin annotations`

### Task 9: 反馈态标记（pending → responded）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/annotation-marks.ts`（per-session marks：立即发送成功的批注登记；turn.completed → responded）
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`（turn.completed → marks dep.markResponded(sessionID)）
- Modify: `EditorDock.tsx`（当前文件 marks 渲染：像素面渲染钉/框，文本面+源码面渲染顶部 marks 条「⏳ 处理中 / ✓ 已回应」；点击 → `props.onOpenReview?.()`，WorkbenchShell 传入切审阅）
- Test: `annotation-marks.test.ts` + dispatcher 测试追加

**Interfaces:**
- Produces:
  ```ts
  addMark(sessionID: string, rel: string, anchor?: AnnotationAnchor): void
  marksFor(sessionID: string, rel: string): { anchor?: AnnotationAnchor; status: "pending" | "responded" }[]
  markResponded(sessionID: string): void
  clearMarks(sessionID: string): void   // root 切换
  ```

- [ ] **Step 1: 失败测试**：marks 按 sessionID 隔离（两会话互不见）；markResponded 只翻该会话；dispatcher turn.completed 接线。
- [ ] **Step 2: 实现**；EditorDock marks 条/钉渲染（脉冲=处理中、✓=已回应；脉冲 opacity-only + reduced-motion）。
- [ ] **Step 3: 全量 + tsgo + commit** `feat(desktop): annotation feedback marks (pending->responded)`

### Task 10: 发送打包 anchor 分支 + 视觉收口 + GUI 冒烟

**Files:**
- Modify: `editor-annotation.ts`（annotationBlock/buildAnnotationPrompt 走 anchorBlockLines；无 anchor 路径逐字不变）
- Modify: `mafw.css`（popover/高亮/钉/框/marks 条全部样式）
- Test: `editor-annotation.test.ts` 追加四类 anchor 打包文本断言

- [ ] **Step 1: 失败测试**：四类 anchor 的 buildAnnotationBatch 文本快照（quote 带引文块、jsonPath 带路径行、cell 带 sheet+ref、region 带百分比+「截图见附件」）。
- [ ] **Step 2: 实现 + CSS**。
- [ ] **Step 3: 全量 desktop 测试 + tsgo + electron-vite build 三绿**。
- [ ] **Step 4: GUI 冒烟**（dev app 重启防 Vite 缓存坑）：md 划选→Enter 发送→composer 无草稿卡直接发；json 节点批注；xlsx 单元格；图片拖框→裁剪附件出现在附件条；源码 Ctrl+M；Ctrl+Enter 攒草稿→批注卡标签正确；turn 完成后 marks 翻「已回应」。
- [ ] **Step 5: commit** `feat(desktop): annotation batch anchor formats + visuals`，更新 AGENTS.md 交付记录。
