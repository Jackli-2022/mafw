# Workbench 合并实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把右 dock 的 files/editor/browser/terminal 四 tab 合并为单一宽工作台面（IDE 骨架 + 三档比例），统一面板骨架，并交付 G1 全屏截屏批注（轻版）与 G2 网页元素点选。

**Architecture:** 先立共享面板骨架（Header/Empty/Banner + lucide 换装）治「割裂」，再合并布局（新 `Workbench.tsx` 吃掉 11-tab RightDock、四件套进 IDE 骨架、七个会话面板收浮层图标轨、对话:工作台三档吸附 420/520/640），最后在合并后的 composer/浏览器面上叠 G1/G2 两个「圈选即上下文」捕获管线（新 pending-capture 类型，与既有代码批注共用发送打包）。

**Tech Stack:** SolidJS + `@mafw/ui/v2` 原语；Electron main（`desktopCapturer`、frameless 选区遮罩窗、webview `executeJavaScript`）；xterm/webview 现有设施零行为回退。

**Spec:** `docs/superpowers/specs/2026-10-26-workbench-merge-design.md`（设计已定稿；本 plan 从其论证）

## Global Constraints

- 禁裸 `<button>`/`<input>`/`title` 属性：一律 `@mafw/ui/v2` 组件（ButtonV2/TooltipV2/LoaderV2/ToastV2；AGENTS §5.10）
- 禁 emoji 图标（工作台+会话轨范围）：用 `@mafw/ui/icon`（lucide），缺口补 icon map 条目
- 动效只用 `--dur-fast`/`--dur-surface` + `--ease-*` token；无 spring
- 主题禁字面色值（token 单块选择器结构；G2 悬停高亮走 CSS class 变量）
- **行为不得回退**：terminal bridge（目录归属/持久 PTY/两步结束/gone-reopen）、browser 加固（权限全拒/window.open 拦截/partition 锁）、per-turn diff store（`session-turn-diffs.ts`）原样保留
- 测试 = `npm test`（node --test + `@mafw/test-shim`，纯逻辑与 src 同目录 `.test.ts`）+ 关键视觉契约进 `tests/design-contract.test.ts`
- 每任务一 commit（conventional commit），先测后码（TDD）
- 比例基数 = **可用宽**（`window.innerWidth − 图标轨 − 推挤左栏`）；px 墙 320/760 优先于比例

## Review Focus

1. **旧宽度键迁移踩空**：存量用户 `mafw-chat-width`（px）与 `mafw-right-dock-width` 在启动迁移后，三档换算值必须落在合法档位——非法/缺失一律回默认档 40，绝不能出现 0 宽或 760+ 残留（Task 3 契约测试钉死）
2. **窄视口（<1200px）工作台 overlay 语义**：宽屏三列、窄屏 overlay 盖对话（浮层不推挤、Esc 可关）——错会把小窗布局挤碎（Task 4 布局测试）
3. **分离条双击与拖动冲突**：双击回默认档必须不触发 collapse、不残留 40 之外的中间态；拖动全程吸附语义（松手即最近档）被 UI 层偷偷破坏（Task 3 纯函数 + Task 4 联防）
4. **G1 多显示器/DPI 越界**：负坐标/跨屏选区裁剪不越界、不颠倒；点取消（无选区）不得发空 capture（Task 6 纯函数）
5. **G2 注入脚本异常吞没**：webview `executeJavaScript` 抛错（页面 CSP/跳转中）必须降级为「无元素信息、仅区域截图」，不得让点选模式卡死或崩 renderer（Task 7 try/catch 测试）

---

### Task 1: 面板骨架原语 `DockPanelHeader` / `DockEmpty` / `DockBanner`

**Files:**
- Create: `src/renderer/mafw/components/dock-panel.tsx`
- Test: `src/renderer/mafw/components/dock-panel.test.ts`

**Interfaces:**
- Consumes: `@mafw/ui/v2`（ButtonV2/TooltipV2/LoaderV2）；`@mafw/ui/icon`（v2 Icon）
- Produces（Task 2-4 消费）:
  - `DockPanelHeader(props: { title: string; children?: JSX.Element })` —— `.mafw-panel-head`（左标题 + 右动作 slot，统一 `border-bottom`）
  - `DockEmpty(props: { icon?: string; text: string; hint?: string })` —— `.mafw-panel-empty`（居中灰字，替代四种私产空态）
  - `DockBanner(props: { kind: "info" | "warn" | "error"; text: string; action?: { label: string; onClick: () => void }; busy?: boolean })` —— `.mafw-panel-banner`（常驻内联 + 恢复动作 + 可选 LoaderV2；泛化 TerminalDock banner 卡片）

- [x] **Step 1: 写失败测试**（`dock-panel.test.ts`）

```ts
import { describe, test, expect } from "vitest-safe-import-see-testshim" // 按仓内现有测试头（node:test）
// 实际用 node:test describe/test + @mafw/test-shim register，参考 components/turn-diffs.test.ts 头部
import { readFileSync } from "node:fs"
// 本任务以「源码契约 + 纯函数」双轨测：组件渲染测试用 test-shim 的 Solid 环境（参考既有组件测试），
// 这里先钉类名/结构契约：
test("DockPanelHeader renders title + actions slot", () => { /* render, expect head 含 title 与 slot children */ })
test("DockEmpty renders centered text", () => { /* */ })
test("DockBanner kind→tone class 映射（info/warn/error）", () => { /* */ })
```

- [x] **Step 2: 跑测试确认失败**：`node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/dock-panel.test.ts` → 模块不存在 FAIL
- [x] **Step 3: 实现三组件**（`dock-panel.tsx`）：结构对齐 TerminalDock banner 卡片视觉（`--bg-float` 卡、`--r-md`、`--shadow-float`）；Header 高度基准 32px、padding 8px 12px；图标走 `@mafw/ui/icon` v2 `Icon`
- [x] **Step 4: 跑测试确认通过**（同 Step 2 命令 → PASS）
- [x] **Step 5: Commit** `feat(desktop): shared dock panel primitives (header/empty/banner)`

### Task 2: 工作台面换骨架 + lucide 换装 + 结构清理

**Files:**
- Modify: `src/renderer/mafw/components/FilesDock.tsx` / `EditorDock.tsx` / `BrowserDock.tsx` / `TerminalDock.tsx` / `ChangesDock.tsx`（各接 DockPanelHeader/DockEmpty/DockBanner）
- Modify: `packages/ui/src/components/icon.tsx`（icon map 补 `globe`/`monitor` 等缺口条目——内容补齐，非组件面扩张）
- Modify: `src/renderer/mafw/mafw.css`（删 `.mafw-right-dock-resizer` 死块；FilesDock 去自身 overflow 收敛双滚动；`.mafw-browser-view` 去 `background:#fff` 换 token）
- Test: `tests/design-contract.test.ts`（增契约）

**Interfaces:**
- Consumes: Task 1 三原语
- Produces: 五面板的「骨架统一」事实（后续视觉契约依赖）；icon map 新条目名（Task 4 会话轨直接用）

- [x] **Step 1: 失败契约测试**（design-contract 增三条）：
  - files/editor/browser/terminal/changes 五组件源码 `toContain("DockPanelHeader")`
  - `BrowserDock.tsx` `not.toContain("#fff")` 且 `toContain("mafw-browser-blank")`（主题化空态类）
  - `mafw.css` `not.toContain(".mafw-right-dock-resizer")`（死代码删除）；`FilesDock` 无自有 overflow（`.mafw-file-tree` 无 `overflow`）
- [x] **Step 2: 跑 `npm test` 确认新契约 FAIL**
- [x] **Step 3: 实施换装**：每面板接入 Header（标题+动作收进统一头）；空态/加载/错误换 DockEmpty/DockBanner（editor 错误从 toast 改内联 Banner；browser 空态 = webview 懒挂载 + `DockEmpty`（未启动时））；FilesDock loading→LoaderV2；emoji 图标全部换 lucide `Icon`；dock-width 对称化（`suggestDockWidth` 对 browser/terminal 生效——改 `applyRightDock` 的 tab 门为四个 workbench tab）
- [x] **Step 3.5: webview 懒挂载**：BrowserDock onMount 建 webview → 改「首次 `started()` 才建」；`src/main/browser-session.ts` 加固逻辑不动
- [x] **Step 4: `npm test` 全量 PASS（预期 desktop 1463+新增）**
- [x] **Step 5: Commit** `feat(desktop): workbench panels adopt shared skeleton (header/empty/banner, lucide, lazy webview)`

### Task 3: 绝对 px 档位纯函数（420/520/640 + 护栏）

**Files:**
- Create: `src/renderer/mafw/workbench-detents.ts`
- Test: `src/renderer/mafw/workbench-detents.test.ts`（同目录）

**Interfaces:**
- Produces（Task 4 消费）:
  - `type WorkbenchDetent = 420 | 520 | 640`
  - `export const WORKBENCH_DETENTS: WorkbenchDetent[] = [420, 520, 640]`
  - `export const WORKBENCH_DEFAULT_DETENT: WorkbenchDetent = 520`
  - `export const CHAT_PX_FLOOR = 320` / `CHAT_PX_CEIL = 760` / `WORKBENCH_MIN_WIDTH = 520`
  - `export function chatPxForDetent(detent: WorkbenchDetent, availableWidth: number): number` —— `clamp(detent, 320, min(760, availableWidth − 520))`
  - `export function snapDetent(px: number, availableWidth: number): WorkbenchDetent` —— 按**实际像素距离**吸附
  - `export function ratioPercentFromDrag(px: number, availableWidth: number): number` —— 实时比例显示（一位小数）
  - `export function migrateLegacyChatWidth(storedPx: number | null, availableWidth: number): WorkbenchDetent` —— 存量 px → 像素最近档
  - `export function normalizeDetent(stored: string | number | null): WorkbenchDetent` —— localStorage 值归一（合法 420/520/640，其余→520）

- [x] **Step 1: 写失败测试**（spec 数值表全钉）：

```ts
test("chatPxForDetent：绝对档 + 护栏（工作台下限 520 / 墙 320-760）", () => {
  expect(chatPxForDetent(420, 1394)).toBe(420)
  expect(chatPxForDetent(520, 1394)).toBe(520)
  expect(chatPxForDetent(640, 1394)).toBe(640)
  expect(chatPxForDetent(640, 1154)).toBe(634) // 护栏：available − 520
  expect(chatPxForDetent(420, 674)).toBe(320) // 窄窗退化（<1200 走 overlay，不参与布局）
})
test("snapDetent：按实际像素距离吸附（无比例语义）", () => {
  expect(snapDetent(430, 1394)).toBe(420)
  expect(snapDetent(500, 1394)).toBe(520)
  expect(snapDetent(600, 1394)).toBe(640)
  expect(snapDetent(200, 1394)).toBe(420)
  expect(snapDetent(1000, 1394)).toBe(640)
})
test("migrateLegacyChatWidth：旧 px → 像素最近档（缺失/非法→520）", () => {
  expect(migrateLegacyChatWidth(417, 1394)).toBe(420)
  expect(migrateLegacyChatWidth(558, 1394)).toBe(520)
  expect(migrateLegacyChatWidth(697, 1394)).toBe(640)
  expect(migrateLegacyChatWidth(null, 1394)).toBe(520)
  expect(migrateLegacyChatWidth(Number.NaN, 1394)).toBe(520)
  expect(migrateLegacyChatWidth(400, 0)).toBe(520)
})
test("normalizeDetent：持久化值归一", () => {
  expect(normalizeDetent("420")).toBe(420)
  expect(normalizeDetent("640")).toBe(640)
  expect(normalizeDetent("999")).toBe(520)
  expect(normalizeDetent(null)).toBe(520)
})
```

- [x] **Step 2: 跑测试 FAIL**（模块不存在）
- [x] **Step 3: 实现**（纯函数，无 Solid 依赖）：`chatPxForDetent` 用显式 `cap = max(320, min(760, available − 520))`；`snapDetent` 比较各档**钳制后**的像素值与入参距离；`migrateLegacyChatWidth` 复用 `snapDetent`；`normalizeDetent` 白名单。
- [x] **Step 4: 跑测试 PASS**
- [x] **Step 5: Commit** `feat(desktop): workbench absolute px detents (420/520/640, guard rails)`

### Task 4: Workbench 布局合并（Workbench.tsx + 会话图标轨 + 迁移）

**Files:**
- Create: `src/renderer/mafw/components/Workbench.tsx`
- Create: `src/renderer/mafw/components/SessionRail.tsx`（右侧细图标轨 + 浮层面板）
- Create: `src/renderer/mafw/components/session-rail.css.ts` 不存在——样式进 mafw.css（`.mafw-session-rail*`）
- Modify: `src/renderer/mafw/MafwShell.tsx`（RightDock JSX 块 2095–2220 重构为 Workbench + SessionRail；`bodyColumns()` 接档位；`applyRightDock` 简化；旧键迁移）
- Modify: `src/renderer/mafw/workbench-defaults.ts`（`CHAT_WIDTH.max` 520→760；`defaultChatWidth` 改档位语义）→ 由 Task 3 函数替代，保留旧导出做迁移期兼容
- Test: `src/renderer/mafw/workbench-layout.test.ts`（纯函数：布局列/迁移）+ `tests/design-contract.test.ts`（结构契约）+ 既有 `tests/main-content-geometry.test.ts` 必须保持绿

- [x] **Step 1: 失败测试**（workbench-layout.test.ts）：
  - `bodyColumnsFor(detent, availableWidth, { narrow, leftPush })` → 列串 `"0px 520px minmax(0, 1fr)"`（默认档/1092 可用）
  - 窄视口：`"overlay"` 模式返回不推挤（workbench 浮层）
  - `migrateDockKeys()`：`mafw-chat-width=417` + `mafw-right-dock-width=520` → `mafw-workbench-detent="420"`（写新键、旧键删除）
- [x] **Step 2: 跑 FAIL**
- [x] **Step 3: 实现 `Workbench.tsx`**：
  - 骨架 = `DockPanelHeader`（工作台标题/目录名）+ 主体 flex：左 `FilesDock`（定宽树，可收）+ 右主区（`EditorDock`/`BrowserDock` tab 切换，内容常挂载 display 切换）+ 底部 `TerminalDock`（可收起，`active` 语义 = 底部区展开）
  - 分隔条 = ResizeHandle 包装（desktop 侧 `WorkbenchDivider` 内组件：拖动中 `ratioPercentFromDrag` 实时预览 + 松手 `snapDetent` + 双击回 `WORKBENCH_DEFAULT_DETENT`；不向 ResizeHandle 传 collapseThreshold 防 collapse 误触）
  - 窄视口（`viewportNarrow()`）：沿用 `.mafw-dock-slot.overlay` 机制
  - localStorage：新键 `mafw-workbench-detent`（枚举 "420"|"520"|"640"）；迁移读旧 `mafw-chat-width`（MafwShell.tsx:1489）
- [x] **Step 4: 实现 `SessionRail.tsx`**：右侧 44px 图标轨（lucide，无 emoji）；七个会话面板图标（tasks/trajectory/usage/notes/changes/subagents/background，badge 保留沿用现有信号）；点击 → 浮层面板（`createPresence` 过渡挂载，`Portal` 到 dock 层，Esc/点外关闭）；面板内容 = 现有七组件原样挂进浮层（不重构面板内部）
- [x] 旧 RightDock 的 11-tab 结构退役：`dock-tab.ts` 的 `DockTab` union 缩为会话面板七值 + `files`/`editor`/`browser`/`terminal` 移入 Workbench 内部 tab 类型；`normalizeDockTab` 迁移旧值（"files"→workbench 打开+files tab）
- [x] **Step 5: design-contract 增契约**：MafwShell 源码 `not.toContain("<RightDock")`、`toContain("<Workbench")` + `toContain("<SessionRail")`；`RightDock.tsx` 文件删除
- [x] **Step 5.5: 保持既有契约绿**：`tests/main-content-geometry.test.ts`（content/main 几何）、`workbench-defaults.test.ts`（老用例改档位语义）、design-contract 旧 RightDock 契约更新
- [x] **Step 6: 全量 `npm test` PASS + `npx tsgo -b` rc=0 + `npx electron-vite build` rc=0**
- [x] **Step 7: Commit** `feat(desktop): merge files/editor/browser/terminal into wide workbench with detent ratios and session rail`

### Task 5: G1 截屏批注 —「pending capture」管线（renderer 侧）

**Files:**
- Create: `src/renderer/mafw/chat/pending-captures.ts`（store + 纯逻辑）
- Modify: `src/renderer/mafw/chat/use-send-message.ts`（deps 增可选项，与 annotation 同型）
- Modify: `src/renderer/mafw/components/ChatPane.tsx`（composer 上方渲染 PendingCaptures 列表）
- Create: `src/renderer/mediafn/capture-to-composer.ts`（主进程截图 → composer 的桥，见 Task 6 接口）
- Test: `src/renderer/mafw/chat/pending-captures.test.ts`

**Interfaces:**
- Consumes: `useSendMessage` deps 模式（`pendingAnnotationCount/takeAnnotations/formatAnnotations` 同型三件）
- Produces:
  - `type PendingCapture = { id: string; sessionID: string; kind: "screenshot" | "element"; comment: string; dataUrl: string; meta?: { tag?: string; selector?: string; text?: string; rect?: { x: number; y: number; width: number; height: number } } }`
  - `pendingCaptures: (sid) => PendingCapture[]` / `addPendingCapture(input: Omit<PendingCapture, "id"|"createdAt">) / removePendingCapture(sid, id) / clearPendingCaptures(sid) / takeCapturesForSend(sid) / formatCaptureBatch(items): string`（对齐 annotation-store.ts 模式；内存态 + 不落盘——截屏是易失草稿）
  - `useSendMessage` deps 新增（可选）：`takeCaptures?: (sid) => PendingCapture[]`、`formatCaptures?: (items) => string`

- [x] **Step 1: 失败测试**（对齐 annotation-store 现有测试模式）：add/remove/take/格式化批（含 element meta 渲染成引用块：截图评注 + 元素信息行）
- [x] **Step 2: FAIL**
- [x] **Step 3: 实现三件套** + use-send-message 发送路径接入（`bodyMessage` 组装处，annotationBlock 之后追加 captureBlock；queue 路径同 annotations 一样打包）+ ChatPane 渲染 `PendingCaptures` 列表（缩略图 + 评注 chip，✕ 移除）+ 截图作为附件：`dataUrl` 直接走 `useAttachments` 的 `addPastedFile` 语义（构造 File 对象 `new File([blob], "screenshot-<ts>.png", { type: "image/png" })`）→ 图片走既有媒体管道（uploadBinary → createTask → 指针）
- [x] **Step 4: `npm test` PASS（预期 +6~8 用例）**
- [x] **Step 5: Commit** `feat(desktop): pending-capture pipeline (screenshot/element annotations queued above composer)`

### Task 6: G1 截屏批注 — 全屏框选（main 进程）

**Files:**
- Create: `src/main/capture/screenshot-capture.ts`（desktopCapturer + 遮罩窗编排）
- Create: `src/main/capture/screenshot-region.ts`（纯函数：多屏坐标/裁剪/光标状态）
- Modify: `src/main/mafw-ipc.ts`（注册 `mafw-capture-start` handle：拉起遮罩窗；`mafw-capture-result` push）
- Modify: `src/preload/index.ts` + `src/preload/types.ts`（`window.api.capture = { start: () => Promise<CaptureResult | null> }`；`CaptureResult = { dataUrl: string; rect: { x: number; y: number; width: number; height: number } | null }`）
- Test: `src/main/capture/screenshot-region.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `addPendingCapture`（renderer 消费结果）
- Produces: preload `capture.start()` → `{ dataUrl, rect } | null`（null = 用户取消）

- [x] **Step 1: 失败测试**（screenshot-region 纯函数）：
  - 跨屏坐标：`cropRectForScreen({ x: -300, y: 100, width: 800, height: 500 }, screenBoundsA, captureBitmapSizeA)` → 裁剪参数正确（负 x 截到屏内部分）
  - `normalizeSelection(start, end)`（拖动方向任意 → 正向 rect）
  - `scaleForDpi(rect, scaleFactor)` → 位图像素坐标
- [x] **Step 2: FAIL**
- [x] **Step 3: 实现编排**：每显示器一个 frameless 透明遮罩窗（`desktopCapturer.getSources({ types: ["screen"], thumbnailSize: 全分辨率 })` 预取 → 遮罩窗显示暗化缩略/主题暗层 + 拖框 UI）→ 确认（Enter/双击松手）→ 裁剪 `nativeImage.crop(rect)` → dataUrl → `mafw-capture-result` push 到 renderer → 遮罩窗全关。Esc = 取消（返回 null）。捕获失败（Linux Wayland）→ resolve null + toast（renderer 侧提示改用系统截图+粘贴）
- [x] **Step 4: 跑纯函数测试 PASS**
- [x] **Step 5: 接 preload + IPC（`mafw-capture-start` / `mafw-capture-result` push）**
- [x] **Step 5.5: renderer 侧接按钮**：composer 工具条 📷 → `Icon "camera"` ButtonV2（TooltipV2「截屏批注」）→ `window.api.capture.start()` → 结果 `addPendingCapture({ kind: "screenshot", dataUrl, comment: "" })` → 用户在 PendingCaptures 列表补评注（轻版：文字侧车，无画布）
- [x] **Step 6: `npm test` + tsgo + build 全绿**
- [ ] **Step 6.5: 手动冒烟（GUI 待 dev app）**（dev app）：多显示器框选、Esc 取消、app 外内容可截、评注→发送→媒体指针到达 agent
- [x] **Step 7: Commit** `feat(desktop): fullscreen screenshot capture with region selection (G1 light)`

### Task 7: G2 网页元素点选（浏览器面板）

**Files:**
- Create: `src/renderer/mafw/browser/element-pick.ts`（纯逻辑：注入脚本源、元素信息字段抽取/截短）
- Create: `src/renderer/mafw/browser/element-pick-inject.ts`（注入 JS 源码字符串常量，见算法块）
- Modify: `src/renderer/mafw/components/BrowserDock.tsx`（点选模式切换按钮 + 悬停高亮 class 注入 + 捕获 → addPendingCapture({ kind: "element", ... })）
- Test: `src/renderer/mafw/browser/element-pick.test.ts`

**Interfaces:**
- Consumes: Task 5 `addPendingCapture`；Task 6 的截图能力（webview `capturePage`，非 desktopCapturer）
- Produces: 浏览器面板「点选」模式（用户点按钮 → webview 进入 pick 模式 → 悬停高亮 → 点击捕获 → 评注 → 待发）

- [x] **Step 1: 失败测试**（element-pick 纯逻辑）：
  - `pickPayloadFromElement(el)`（DOM 语义的纯映射，测试用 jsdom-free 的对象模拟或抽取逻辑拆为 `buildElementInfo({ tagName, id, className, textContent, href, value, src, title, placeholder, ariaLabel, rect })` → `{ tag, selector, outerHTML(截短 500), text(截短 200), rect, attrs }`；selector = `tag#id.class1.class2`（无 id 时生成 nth-of-type 路径，深度 cap 4）
  - `buildPickScript(highlightClass, onSelectExpr)` → 注入脚本字符串（try/catch 包裹、双击/右键取消语义由脚本内处理）
- [x] **Step 2: FAIL**
- [x] **Step 3: 实现注入脚本**（算法钉死）：

```js
// 注入 webview 的 IIFE（properties 序列化约定见 buildPickScript 测试）
(function (HIGHLIGHT_CLASS, callback) {
  var last = null
  function clear() { if (last) { last.classList.remove(HIGHLIGHT_CLASS); last = null } }
  document.addEventListener("mousemove", function (e) {
    var el = e.target
    if (el === last) return
    clear(); last = el
    el.classList.add(HIGHLIGHT_CLASS)
  }, true)
  document.addEventListener("click", function (e) {
    e.preventDefault(); e.stopPropagation()
    callback(pickPayloadFromElement(e.target))  // 序列化回 renderer
  }, true)
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { cleanup() } }, true)
})("mafw-pick-highlight", null /* renderer 经 executeJavaScript 桥接 */)
```

- [x] **Step 4: BrowserDock 接线**：`pickMode` signal（`Icon "mouse-pointer-square-dashed"` ButtonV2 toggle）；开启 → `webview.executeJavaScript(buildPickScript(...))`；点击事件经 `window消息`（`postMessage` 或 executeJavaScript 返回值轮询——用 `webview.executeJavaScript` 的 Promise 返回 payload，一次一 pick，pick 后自动退出模式）；**try/catch：注入失败 → toast「页面不支持点选」+ 退出模式**（Review Focus #5）；捕获 payload + `webview.capturePage()` 区域截图 → `addPendingCapture({ kind: "element", comment: "", meta: payload })`
- [x] **Step 5: `npm test` + tsgo + build 全绿**
- [ ] **Step 5.5: 手动冒烟（GUI 待 dev app）**：localhost 页点选按钮/输入框/链接 → 元素信息正确、悬停高亮、Esc 退出、CSP 严格页降级 toast
- [x] **Step 6: Commit** `feat(desktop): browser element picking (G2) with element info + region capture`

### Task 8: 收尾 — AGENTS.md 记录 + 全量门禁

**Files:**
- Modify: `AGENTS.md`（§5.5 增交付记录：feature 名、commits、测试计数、门禁）
- Modify: `docs/superpowers/plans/2026-10-26-workbench-merge.md`（本文件勾选完成）

- [x] **Step 1: 全量门禁**：desktop `npm test`、`npx tsgo -b`、`npx electron-vite build`、（涉及 ui 包改动）`packages/ui` 测试 + root `npm run test:desktop`
- [x] **Step 2: AGENTS.md 交付记录**（版本号 + commit 哈希 + 新增测试数/全量数——用户要求显式记录）
- [x] **Step 3: Commit** `docs: workbench merge delivery record`

## 验收冒烟清单（GUI，dev app）

1. 工作台四件套同屏：树 + 编辑器 tab + 底部终端（浏览器 tab 切换）
2. 分隔条拖动三档吸附 + 双击回 40；刷新后档位持久
3. 会话轨七图标点击浮层、Esc 关、badge 实时
4. G1：composer 📷 → 全屏框选（含 app 外）→ 评注 → 发送 → 指针到达
5. G2：浏览器点选 → 悬停高亮 → 捕获元素信息+截图 → 评注 → 发送
6. 窄窗（<1200px）工作台 overlay、对话不被推挤
7. 旧用户升级：`mafw-chat-width` 迁移到档位、无 0 宽/越界
