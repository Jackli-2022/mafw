# Chat 与 Workbench 的比例与面板处理调研

日期：2026-10-22
背景：三列布局（46px 图标轨 | chat | 工作台）上线后，用户提出「chatview 与右侧 dock 的美学比例」以及「content 和 main 大小不一致」的问题。

## 一、已定位并修复的尺寸 bug

实测（1138 CSS 宽窗口）：

```
main:    480x1060  @46,38
content: 480x233   @46,864   ← 只有 233px 高，贴在底部
chat:    464x225   @54,868
dock:    953x1060  @38..    ← 正常
```

根因：`.mafw-content { grid-row: 2 }` 依赖 `.mafw-content:only-child` 覆盖为 `1/-1`；chat 的 ResizeHandle 作为 `.mafw-main` 的第二个子元素使 `:only-child` 失效，content 掉进 `grid-template-rows: 1fr` 的隐式 auto 行（行 2），行 1 留空。

修复：`.mafw-content { grid-row: 1 / -1 }`（显式跨全部行），实测 content = 480x1066 与 main 完全一致。契约测试 `tests/main-content-geometry.test.ts`。commit `d5d08727`。

## 二、业界比例数据

| 产品 | chat / 侧栏宽度 | 主区 | 面板处理 | 备注 |
|---|---|---|---|---|
| VS Code | activity bar 48px；primary sidebar 默认 300（可拖 170+） | 编辑器吃剩余 | **flush**，1px 分隔线，header ~35px | 行的基准形态 |
| Cursor | agent 侧栏可拖，用户常拖到「接近窗口一半」；最小宽度有保护 | 编辑器吃剩余 | flush | 用户抱怨 chat 内容不随面板缩放/被居中 |
| Codex desktop | chat 内容**居中 + max-width**（约 768），两侧留白 | 右 panel flush 可拖 | flush + 内容限宽 | issue #25010/#43725/#16669 都在抱怨宽屏两侧空太多 → 教训：限宽的是**内容列**，不是面板本身 |
| Claude Artifacts | 开启 artifact 时约 50/50；关闭时 chat ~400 | 预览区 | flush | 分屏时对话与产出并置 |
| ChatGPT Canvas | 约 50/50 分屏 | 编辑区 | flush，聊天内容限宽居中 | 同上 |
| Slack / Linear | 导航 240-280 | 内容吃剩余 | flush | 导航型产品惯例 |
| 黄金分割 | sidebar : main ≈ **38.2 : 61.8** | — | — | 通用 UI 美学比例（NN/g、Figma 等） |

## 三、我们的比例测算

可用宽度 = 窗口宽 − 46px（图标轨）。当前默认 chat = 340px：

| 窗口 | 可用 | chat 340 占比 | 黄金 38.2% 对应 | chat 420 占比 |
|---|---|---|---|---|
| 1138 | 1092 | 31.1% | 417 | 38.5% |
| 1280 | 1234 | 27.6% | 471 | 34.0% |
| 1440 | 1394 | 24.4% | 533 | 30.1% |
| 1920 | 1874 | 18.1% | 716 | 22.4% |

结论：
- **340 偏窄**：低于 Cursor/Claude 的 400+ 区间，且偏离黄金分割；中文 13px 下每行约 45 字，读长回复偏挤。
- **420 左右**是甜点：1138 宽时占 38.5%（黄金附近），1280 宽 34%，仍给工作台 65%+。
- 宽屏（≥1440）不必按 38.2% 线性放大 chat（会到 500+），建议 **clamp(38.2% 可用宽, 360, 520)**，默认落在 400-470。
- 工作台 = 剩余（现状正确）；黄金比例在这里天然成立：chat 38% / 工作台 62%。

## 四、面板处理不一致（视觉层）

现状混用两套语言：

- chat 面板：**浮起卡片**——`margin: 4px 8px`、`border-radius: var(--r-xl)`、`box-shadow: var(--shadow-float)`、背景 `bg-raised`
- 工作台：**flush 面板**——贴边、仅 1px 左边框、背景 `bg-base`
- header 高度也不同：工作台 head 8px padding + 32px tab = 48px；chat 卡片顶部仅 4px 外边距 + 自身 titlebar

同一层级的两块主区域，一个像"卡片"一个像"画布"，这是用户看到的「大小不一致」的第二层来源。

三种统一方案（mockup 里并排）：

- **A. 统一卡片**：chat 与工作台都是 8px 外边距 + 同半径圆角卡片，中间 8px 缝隙；整体像 Linear/Notion 的模块化工作台。
- **B. 统一 flush**：去掉 chat 的 margin/圆角/阴影，两面板贴边 + 1px 分隔线，header 统一 44px；最接近 VS Code/Cursor/Codex。
- **C. 面板 flush + 内容卡片**：面板本身贴边，chat 的消息/输入区在面板内居中限宽（~720px）并用卡片承托；业界聊天产品（Codex/ChatGPT/Claude）的通行做法。改动量最大。

## 五、建议

1. 比例：默认 chat = `clamp(0.382 * available, 360, 520)`（1138 宽约 417）；min 320 / max 560 可拖。
2. 面板：优先 **B（统一 flush）**——最省改动、与 IDE 工作台定位一致、工作台是第一主角；若想要更"产品化"的柔和感选 A。
3. header 统一高度 token（44px），让 chat titlebar 与工作台 tab 行基线对齐。
4. 工作台内容左右内边距与 chat 内容内边距统一（16px）。

## 六、2026-10-26 增补：各家桌面端配比实测（工作台合并讨论）

数字均为源码 / 一手 issue 实证（MAFW 现状：chat = 38.2% × 可用宽 clamp 360–520、工作台吃剩余，`workbench-defaults.ts` 测试钉扎 1092→417 / 1234→471 / 700→360）：

| 产品 | 对话:工作台 | 依据 |
|---|---|---|
| **opencode desktop**（anomalyco/opencode v2） | 对话列**固定默认 600px**、review 吃剩余 → @1440 ≈ 42/58、@1920 ≈ 31/69 | 源码 `packages/app/src/context/layout.tsx`：`DEFAULT_SIDEBAR_WIDTH=344`（左栏，默认收起）/ `DEFAULT_SESSION_WIDTH=600` / `DEFAULT_FILE_TREE_WIDTH=200` / `DEFAULT_TERMINAL_HEIGHT=280`；issue #30618（对话列 max-width 帽把 review 最小顶到 ~55% 窗宽，用户抱怨） |
| **Zed** | Agent Panel 默认右 dock **640px 固定** → @1440 ≈ 44/56 | 2026-09-28 美学调研实测 |
| **Codex desktop** | 无固定比例：对话**内容**限宽 ~768px 居中（`--thread-content-max-width`），右 browser 面板 flush 可拖（宽度跨项目全局共享，#20236 被抱怨）；TUI 分屏提案 = **50/50**（#38073，codex-rs `SideContentWidth::Half`） | issues #16669 / #10516 / #20236 / #38073 |
| **Kimi Code desktop** | 默认 ≈ **50/50**（右预览默认 = 剩余一半、对话 min 320、左栏默认 270） | 官方文档（结构：右面板 tab 随会话 + 底部终端 + 顶栏中部 panel tabs）+ 社区逆向 spec `spec-kimi-code`（数字，非官方） |
| **Claude desktop** | pane 开 ≈ 50/50；无常驻右栏（自由 pane 可拖重排/弹出） | 2026-09-29 面板开关调研 |
| **dsh**（DeepSeek Harness） | 未公布数字；右栏 = dockkit 停靠面（files/browser/guide/text/subagentchat），pane 可分栏/浮出/收回，布局仅内存 | 官方 reference（只有编程接口 `ctx.sidebarRight`） |
| **VS Code** | sidebar 300px ≈ 21%（导航性质，仅参照）；编辑器吃剩余 | 官方文档 |

**两派收敛**：对等派 50/50（Kimi / Claude / Codex TUI 提案 / Cursor 用户手拖）vs 工作台派（opencode 600 固定 / Zed 640 固定 / Codex 内容限宽 768 / VS Code）。MAFW 现状 38/62 属工作台派且更激进（宽屏 clamp 后 28/72）。**同派内我们的对话列 clamp 520 也窄于 opencode 600 / Zed 640**——若对话区显挤，先抬 cap 到 600 比改整体比例更贴业界。

## 来源

- VS Code: code.visualstudio.com/docs/editing/getting-started/userinterface（activity bar 48 / sidebar 默认 300）
- Cursor: forum.cursor.com（sidebar 最小宽度、chat 不随面板缩放）
- Codex: github.com/openai/codex issues #25010 / #43725 / #16669（内容限宽与宽屏留白）
- Claude Artifacts / ChatGPT Canvas: 分屏比例报道与产品文档
- 黄金比例：nngroup.com/articles/golden-ratio-ui-design、Figma resource library
