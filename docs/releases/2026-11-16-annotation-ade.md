# 2026-11-16 · Desktop 批注升级为 ADE 高亮模式

- **版本**：`v5.1.0`（桌面交互变更，不升版本号）
- **提交**：`d9f85cd3`（ADE 调研补全）、`e1b0277d`（交互实现）
- **范围**：desktop renderer + preload/IPC + shared annotation store；gateway / runtime 契约零改动
- **依据**：`docs/research/2026-11-16-desktop-annotation-ux-research.md`

## 现状

- **选中不再自动弹表单**：源码 / 预览选区只出现浮动 toolbar（`引用` / `批注`）；
  `Ctrl+M` 仍可直接打开 composer。streaming / 正在刷新时不会误开。
- **Composer 收成 300px**：引文摘要 + 人类可读位置 + 2 行自动增高输入；
  只有 `取消` / `批注`，`Ctrl/⌘↵` 保存，`Esc` 取消；保存即加入 pending，随下一条消息发送。
- **quote 高亮改用 CSS Custom Highlight API**：pending 22% 实线 / held 9% 虚线 / active 38% + 2px；
  高亮随正文滚动、不改 DOM。刷新或切回文件后按引文重新锚定，不再丢高亮。
- **源码行走编辑器行装饰**：CodeMirror / Monaco 都支持 `pending` 实线、`held` 虚线；
  不再画小点代替高亮。
- **右侧 margin rail**：当前文件的 pending 批注卡（引文、正文、位置、`随下一条发送` 勾选、删除）；
  窄容器自动隐藏，仍可从 comments pill 访问。
- **comments pill 取代旧小列表**：位于聊天 Send 左侧，显示条数；点开逐条勾选
  `随下一条发送`（取消勾选 = held，保留但不发），支持删除 / 清空。
- **发送语义**：`sendableFor` 只取非 held 批注；发送后 pending 出清，高亮 / rail 卡消失；
  held 继续留在 pending。刷新后 held 状态从磁盘恢复。
- **不再无限 pulse**：高亮、图钉、点标记全部静态；只在首次出现时做一次 120–180ms 进场。
- 旧 `PendingAnnotations` 列表、`mafw-annot-marks` 角落条、`Enter 发送 / Ctrl+Enter 攒草稿`
  双动作与 420px 浮卡全部退役。
- 预览锚点能力保留：json 节点路径、表格单元格、图片区域、pptx 页码；图片批注仍随消息附件发送。

## 实现

- `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`：选区 toolbar、300px composer、
  margin rail、三态同步、删除/发送后清高亮、引文重锚定。
- `packages/desktop/src/renderer/mafw/annotation-selection.ts`：toolbar 定位（上方优先、clamp）。
- `packages/desktop/src/renderer/mafw/annotation-highlights.ts`：CSS Custom Highlight 三态 +
  `findQuoteRange` 引文重锚定；不支持时回退到 rect 层。
- `packages/desktop/src/renderer/mafw/annotation-highlight.ts`：源码行高亮映射（纯函数）。
- `packages/desktop/src/renderer/mafw/components/AnnotationSheet.tsx`：ADE 式 composer。
- `packages/desktop/src/renderer/mafw/components/CommentsPill.tsx`：批注 pill + 勾选/删除/清空。
- `packages/desktop/src/renderer/mafw/annotation-store.ts`：`held` / `sendableFor` /
  `setAnnotationHeld`；`takeForSend` 保留 held。
- `packages/desktop/src/shared/annotations.ts` + `src/main/ipc.ts` + `src/preload/*`：
  `annotations-set-held` 持久化。
- `packages/desktop/src/renderer/mafw/editor/{cm,monaco}-setup.ts`：批注行装饰。
- `packages/desktop/src/renderer/mafw/mafw.css`：三态 `::highlight`、toolbar、rail、pill；删除旧列表样式。

## 测试

- 新增 **17** 个测试：
  - `annotation-store.test.ts`：held 保留 / 不随发送、`takeForSendById` 忽略 held（2）
  - `shared/annotations.test.ts`：`setAnnotationHeld` 纯逻辑 + repo 持久化（3）
  - `shared/annotations-wiring.test.ts`：main IPC + preload 接线（1）
  - `annotation-selection.test.ts`：toolbar 上方优先 / 下方回退 / 左右 clamp（4）
  - `annotation-highlight.test.ts`：源码行高亮过滤 / held / 多行（3）
  - `annotation-highlights.test.ts`：quote 三态优先级（2）
  - `annotation-marks.test.ts`：`removeMarkByAnnotation`、`marksForSession`（2）
- 全量：`npm test` → **3937 pass / 0 fail**；`npx tsgo --noEmit -p tsconfig.json` 通过。
- 构建：`npx electron-vite build` 通过（56.50s）。
- 手工验证（dev workbench，CDP 驱动）：markdown 引文 → toolbar → composer → 高亮 + rail +
  pill；held 勾选切换 22% → 9% 虚线；源码 CodeMirror 行高亮；整页 reload 后按引文恢复高亮；
  删除/清空后高亮、rail、pill 同步消失。
- Live drill（2026-11-17）：Lead 会话 `ses_e62c4d612ffeMEMsCQq7V3snek` 发送
  `Live drill：请只回复「收到」…` + 1 条 quote 批注；网关历史确认用户消息包含
  `【批注 1】`、引文、`我的批注：…`，Agent 回复「收到」；发送后 pending / rail / CSS highlight
  全部清空。

## 已知边界

- 已发送批注不保留历史 / resolve（ADE 也没有；需要审计时再走 P1 `已发送` tray）。
- 引文重锚定按首个匹配恢复；同一文本多处出现时可能锚到第一处（P1 可加前后文指纹）。
- margin rail 目前是右侧浮层，不改正文宽度；窄容器隐藏，仅保留高亮 + pill。
