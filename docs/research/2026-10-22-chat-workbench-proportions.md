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

## 来源

- VS Code: code.visualstudio.com/docs/editing/getting-started/userinterface（activity bar 48 / sidebar 默认 300）
- Cursor: forum.cursor.com（sidebar 最小宽度、chat 不随面板缩放）
- Codex: github.com/openai/codex issues #25010 / #43725 / #16669（内容限宽与宽屏留白）
- Claude Artifacts / ChatGPT Canvas: 分屏比例报道与产品文档
- 黄金比例：nngroup.com/articles/golden-ratio-ui-design、Figma resource library
