# Claude Code Desktop 与 Codex Desktop：小窗口布局与 Composer 行为调研

- 日期：2026-11-10
- 触发问题：MAFW 的 `CHAT_PX_FLOOR = 320` 是否合理；小窗口（宽 <900px、高 <600px）下 composer 应该怎么退化。
- 范围：Claude Code Desktop（Claude Desktop 的 Code tab）、OpenAI Codex Desktop；OpenCode / Kimi / DSH 作为参照组。
- 结论先行：**320 作为硬底线是合理的；真正的问题不是这个数字，而是 MAFW 的 1088×720 窗口硬下限 + 720px 工作台并排。** 只要允许 <900 的窗口，就必须让工作台 overlay，否则 chat 会被压到 320。

## 0. 先回答：MAFW 的 320 是怎么来的

代码事实：

- `CHAT_PX_FLOOR = 320`，但默认档位是 **760**，档位为 520 / 640 / 760（`workbench-detents.ts`）。
- 窗口硬下限 `MAIN_WINDOW_MIN_WIDTH = 1088`，左侧图标轨 46px，右侧工作台保底 `WORKBENCH_MIN_WIDTH = 720`。
- 1088 − 46 − 720 = **322**；320 是比它低 2px 的整数护栏。
- 1088 窗口下 `chatPxForDetent(760, 1042) = 322`；1366 窗口下是 600；1600 窗口下是 760。
- 另一个约束是 composer：chat 320 时 composer 内容区 256px，六个控件（附件 / 上下文环 / 权限 / 会话+模型 pill / 麦克风 / 发送）必须全部可见；`composer-toolbar-css.test.ts` 把它锁成“零降级”。

所以 320 不是设计偏好，是 **窗口下限 + 工作台下限 + composer 控件宽度** 三个约束的交点。真正该讨论的是：**这三个约束是否还成立**。

## 1. 方法与证据等级

两家桌面端都是闭源；本机没有安装 Claude / Codex Desktop，无法直接读 CSS。证据来自：

- **官方文档**：Claude Code Desktop 的 layout / prompt box / pane 文档；Codex App 的官方介绍与第三方界面指南。
- **GitHub issues**：用户实测的窗口尺寸、composer 溢出、侧栏挤压、响应式重排问题；带 issue 编号和日期。
- **源码/PR**：OpenCode 的布局源码与 PR（作为可验证的参照组）。
- **第三方 UI 指南**：只用于确认控件结构，不作为精确像素来源。

文中会标注 **官方 / issue / 第三方**，不把用户报告当成产品规范。

## 2. Claude Code Desktop

### 2.1 布局模型

Claude Desktop 的 Code tab 是“会话 + 可自由编排的 pane”模型：

- 左侧：会话/项目侧栏（New、Search、Artifacts、Scheduled、Customize、按项目分组的会话列表）。
- 顶部：会话标题栏，右侧是打开/关闭 pane 的按钮（session details、terminal、changes、browser、files 等）。
- 中间：对话区。
- 右侧：session details panel（环境、文件夹、Git 分支、上下文用量、连接器、改动、输出、运行中的 server / 后台任务）。
- 底部：prompt box；prompt box 下面还有一行选择器（environment、project folder、permission mode、model、usage）。
- pane 可以拖 header 重排、拖边缘改宽、`Cmd+\` 关闭、pop out 到独立窗口、Minimize 到 session details panel 或浮在 chat 角落。

来源：官方文档 `code.claude.com/docs/en/desktop`，第三方 UI 指南 HEROPY。

### 2.2 小窗口行为（宽 <900 / 高 <600）

Claude 的策略是 **“先收 chrome，再收 chat”**：

| 行为 | 证据 | 说明 |
|---|---|---|
| 左侧栏在窗口 < ~700px 时自动隐藏 | issue #108198（用户实测，Windows 4.23118.0） | 不是设置项；用户抱怨无法常开 |
| 窗口最小宽度约 **600px** | issue #49856（Windows/macOS 用户报告） | 这是窗口级下限，不是 chat 面板下限 |
| 标题栏按钮放不下时移入 **⋮ 菜单** | 官方文档 | 窄窗优先保 chat，不保按钮 |
| session details panel **只在 chat 足够宽时出现**；可 Hide/Show session rail | 官方文档 | 侧栏是条件性的，不是硬占宽 |
| split view 下 session info panel 可能占掉约 1/3，把会话压成窄条；面板还不能折叠 | issue #102233（2.37337.1） | Claude 也有“侧栏挤压 chat”的真实痛点 |
| 窄 pane 的 session header 文本可能重叠/不裁剪 | issue #75073（closed/stale） | 窄宽下的裁切/溢出问题 |
| pane 可 Minimize 到 session details，或浮在 chat 角落 | 官方文档 | 小窗口的“降级形态”是浮层，不是继续并排 |

**关键观察**：Claude 没有公布 chat 面板的硬 min；它用 **窗口 min + 侧栏自动隐藏 + session rail 条件显示 + 标题栏溢出** 来避免 chat 被压死。代价是 split view 下仍会出现 chat 被 session info panel 挤压的抱怨。

### 2.3 Composer 行为

官方文档给出的结构：

- prompt box 是输入主体；`+` 按钮在 prompt box 旁边，打开附件 / skills / connectors / plugins。
- prompt box 下面一行：environment、project folder、permission mode、model、usage。
- 输入多行时没有公开的“compact 模式”；文档没有描述窄窗下这行选择器如何折叠。
- composer 不在侧栏展开时浮动；Browser pane 铺满时，用户需要发 feature request 让 composer 浮在 browser 上（issue #105889，open）。

已验证的两个小窗口痛点：

1. **纵向**：composer 会随输入无限变高，遮住 transcript；用户请求 “cap prompt input box height with internal scroll”（issue #104231，open，2026-10-22）。这说明 Claude 目前没有硬性 max-height + 内部滚动。
2. **横向**：split view / session info panel 会把 chat 压成窄条，composer 也一起变窄（#102233）。Claude 没有公开的 chat/composer 硬 min 来兜底。

**可借鉴**：Claude 的“侧栏让位、标题栏溢出、session rail 条件显示”是正确方向；但 composer 本身缺少 **max-height + 内部滚动**，也缺少 **硬 min**。MAFW 已经有 composer 200px 自动增长上限（`ChatPane` 的 autoGrow `Math.min(scrollHeight, 200)`），这一点比 Claude 现状好；需要补的是窄窗下的硬 min 和侧栏让位策略。

## 3. OpenAI Codex Desktop

### 3.1 布局模型

Codex Desktop 是三列：

- 左：侧栏（New Thread / Search / Plugins / Automations / Projects / Chats / Settings），可折叠。
- 中：对话区；对话**内容**有最大阅读宽度 `--thread-content-max-width`，约 **768px**，居中，窗口再宽只增两侧留白。
- 右：结果面板（Diff review、集成终端、Browser/Preview），可拖宽，宽度会持久化（跨项目共享被抱怨 #20236）。
- 底部：composer 输入框；输入框下面有 mode（Local / Worktree / Cloud）、model、permission 等选择器；`+` 附件，`/` 命令，`@` 提及；底部还有状态栏（Local/Cloud、权限、分支、改动统计）。

来源：官方 Codex App 介绍、第三方 UI 指南（coding.flowo.design / kenhuang.com）、GitHub issues。

### 3.2 小窗口行为

| 行为 | 证据 | 说明 |
|---|---|---|
| 对话内容固定最大 768px | issue #16669 / #10516 / #20236；第三方指南 | 保护阅读宽度；窗口再宽只增留白 |
| 窗口最小宽度偏大：Mac 16" 上不能缩到约 60% 以下，用户无法 50/50 分屏 | issue #14010 | 窗口级下限，不是 chat 面板下限 |
| 侧栏在响应式宽度下折叠/隐藏 | issue #21780、#27042 | 用户要求 compact/collapsible sidebar |
| 侧栏折叠/内容容器留白时出现渲染错乱、残影、裁切 | issue #21780 | Electron 响应式重排的真实 bug |
| 右侧栏在状态栏可见时被裁掉 | issue #26123 | 高度/状态栏与侧栏的约束 |
| 侧面板拉大后，chat / composer 可被压到“每行几个字符” | issue #59523（2026-11-05） | 用户明确要求 “enforce a usable minimum width for the chat and composer” |
| 调整侧面板时 composer 可能被推出视口；嵌套 flex 缺 `min-height: 0 / min-width: 0` | issue #19460 | 典型的 flex 溢出 bug |
| 宽主列下 starter prompts 被 composer/overlay 遮住，侧栏变窄后才出现 | issue #22000 | 宽/窄切换的响应式重排问题 |

**关键观察**：Codex 的 **max-width 768 只解决“太宽不好读”，不解决“太窄会被压死”**。它没有公开的 chat 面板硬 min，于是 #59523 出现“side pane 把 chat/composer 压成几厘米宽”的真实故障。这正是 MAFW 的 320 要防的事。

### 3.3 Composer 行为

- 结构：输入框 + 下方 mode/model/permission 选择器；`+` 附件；`/` 命令；`@` 提及；底部状态栏。
- **可折叠/隐藏 composer**：issue #20927 “allow hiding or collapsing the composer while reading” 已 closed；#25356 明确提到 “when composer is collapsed”，说明 Codex 已有 composer 折叠态，用于阅读时回收纵向空间。
- **控件换行**：PR #6589 “fix model picker wrapping” 已 merged，说明 model picker 在窄宽下需要换行而不是溢出。
- **popover 内部滚动**：issue #58353 的 composer project picker 在项目多时行高压缩/重叠；修复方向是 `*:shrink-0` + bounded scroll，不是让行继续缩。
- **没有公开 chat/composer 硬 min**：#59523 是这个缺口的直接后果；#19460 是 resize 时 flex 约束缺失的后果。
- 侧面板可拖宽、宽度持久化；但跨项目共享宽度被抱怨（#20236）。

**可借鉴**：
1. composer 折叠是短窗口（<600 高）非常有效的形态；MAFW 可以把它做成“阅读模式”而不是默认隐藏。
2. 控件必须允许换行/溢出到菜单，不能靠压缩到 0 来适配（#6589 / #58353）。
3. 只设 max-width 不设 min-width 会在侧面板展开时出事（#59523）；硬 min 是必须的。
4. resize 时所有 flex 中间层要有 `min-width: 0 / min-height: 0`，否则 composer 会被推出视口（#19460）。

## 4. 参照组：OpenCode / Kimi / DSH

| 产品 | 宽度策略 | 数值/证据 | 对 MAFW 的意义 |
|---|---|---|---|
| **OpenCode Desktop** | 绝对 px + 持久化；chat ↔ side 都可拖 | 默认 **600**；旧 chat min **450**；2026-10-20 PR #57343 把 chat 和 side 都降到 **320**；sidebar 120–640；hover pill | **320 是 OpenCode 当前的下限**，和 MAFW 完全一致 |
| **Kimi Code Desktop** | 比例默认 + px 持久化 + 钳制 | min **320**；侧栏 270 | 320 是行业常见的 chat 下限 |
| **DSH Desktop** | 外壳包 DeepSeek Harness Web UI；右侧 dock 可 split/float/collapse | 无公开宽度数值；阅读宽度是宿主设置 | 不是固定三列像素模型，不能直接比 min |
| **VS Code** | 侧栏绝对 px | min 170 / 默认 300 | 文件树可以很窄，chat 不行 |
| **Cursor** | chat 面板 | min 300 / 400（版本间变化） | 320 在合理区间 |
| **Zed** | Agent Panel 默认 640 | 640 | 正常宽度锚点 |

## 4.5 最大宽度对照：760 vs 640 vs 520

MAFW 当前三档：**520 / 640 / 760**，默认 **760**，上限 **760**，硬底线 **320**。760 来自“48rem 阅读列在本仓 14px 全局字号 / 16px 正文下的等价物”。

### 业界最大宽度

| 产品 | 最大/默认阅读宽度 | 证据 |
|---|---|---|
| **ChatGPT web/desktop** | **768px（48rem）** 上限 | 官方 CSS 的 `xl:max-w-[48rem]` |
| **Codex Desktop** | 对话内容 **≈768px**（`--thread-content-max-width`），居中 | issues #16669 / #10516 |
| **Claude Code Desktop** | **无上限**；用户请求 720–820 | issue #57991 |
| **Hermes Desktop** | 默认 **780px**（48.75rem）；narrow 704 | PR #95134 |
| **OpenClaw Control UI** | `min(900px, 68%)` 上限 | issue #67935 |
| **OpenChamber** | narrow **768px** / wide fluid | issue #4286 / PR #2118 |
| **OpenCode Desktop** | 默认 **600px**；面板上限 **45% 窗口宽**（issue #30618）：1440 窗约 **648**，1920 窗约 **864** | 源码 `DEFAULT_SESSION_WIDTH=600`；issue #30618 |
| **Zed Agent Panel** | 默认 **640px** | 2026-09-28 调研 |
| **Kimi Code Desktop** | 默认剩余宽一半；min **320**；max 未公布 | 社区逆向 spec |
| **MAFW** | 520 / **640** / **760**，默认 760，max 760 | `workbench-detents.ts` |

### 760 与 640 的实际阅读量

按本仓 16px 正文、拉丁字符约 8px、中文约 16px 估算：

| 宽度 | rem（16px 基准） | 拉丁字符/行 | 中文/行 | 适合 |
|---|---|---|---|---|
| 520 | 32.5rem | ~65 | ~32 | 紧凑侧栏；长代码/表格会频繁换行 |
| 640 | 40rem | ~80 | ~40 | 并排工作台时的折中；纯 prose 舒适 |
| 760 | 47.5rem | ~95 | ~47 | **48rem 阅读锚点**；代码/表格/diff 更少换行 |

结论：

1. **760 是业界 768 锚点的等价物**，作为默认/上限成立；用户感觉 760 比 640 舒适，与“代码/表格少换行”一致。
2. **640 不是错误值**，它是“并排工作台时”的折中：OpenCode 在 1440 窗的上限约 648，Zed 默认 640，正好对应。
3. **520 是紧凑档**，适合工作台必须并排、但窗口不宽的场合；320 只应是极端兜底。
4. 因此不需要新增第四档或把 max 改成 768：**760 默认 / 760 max / 640 并排 / 520 紧凑 / 320 兜底** 已经覆盖了业界区间。

### 对 A 方案的直接影响

760 要在窄窗口成立，**工作台就不能继续从 chat 里切走 720px**。所以在 `<1286px` 时，更稳的形态不是“工作台覆盖在 chat 上”（会盖住 composer 右侧），而是 **Chat / Workbench 全宽切换**：

- chat 视图：chat 保持 760（或按可用宽），composer 全宽；
- workbench 视图：工作台全宽（复用现有 Focus 布局的 `0px minmax(0,1fr)`），chat 让位；
- 标题栏提供切换；窗口变宽回 ≥1286 时恢复并排。

这样既保住 760 的阅读体验，又不让侧面板压坏 composer——正是 Claude “先收 chrome” 和 Codex “composer 可折叠” 两条路线的折中。

## 5. 横向对比：小窗口与 Composer

| 维度 | Claude Code Desktop | Codex Desktop | MAFW 当前 | MAFW 建议（A 方案） |
|---|---|---|---|---|
| 窗口最小 | ~600px 宽（用户报告） | 偏大（Mac 16" 约 60%，#14010） | **1088×720** | **900×600**（工作台 overlay 后） |
| chat 面板硬 min | 未公布；靠侧栏隐藏/条件 rail | **未公布**；#59523 被压坏 | **320** | 保留 320 硬底线；正常 ≥520 |
| chat 默认/舒适 | 无 max；用户请求 720–820 | 内容 max **768** | 默认 **760** | **760 不变** |
| 侧栏策略 | <700 自动隐藏；title bar → ⋮；session rail 条件显示 | 可折叠；响应式宽度下折叠 | 固定工作台并排，min 720 | **<1286 工作台 overlay**；rail/title bar 溢出 |
| composer 宽度 | 跟随 chat；split view 可被压窄 | 跟随 chat；无硬 min，可被压坏 | chat 320 → composer 256，零降级 | 硬 min 320；正常 ≥520；overlay 后 760 |
| composer 高度 | **无上限，会遮 transcript**（#104231） | **可折叠**（#20927/#25356） | autoGrow 上限 **200px** + 内部滚动 | 保留 200px；<600 高可选折叠 |
| composer 控件 | `+`；下方一行环境/权限/模型；窄窗规则未公开 | `+` / `/` / `@`；mode/model/permission；model picker 可换行 | 六控件；模型 pill 唯一可收缩 | 控件换行/溢出菜单；不隐藏 |
| 侧面板挤压 | split view 会被 session info 挤压（#102233） | #59523 压到不可用；#19460 推出视口 | 1088 下 chat 322 | overlay 后 chat 760；320 仅极端 |
| 浮层/浮动 composer | 无；#105889 是 feature request | 无公开；composer 可折叠 | 无 | 暂不做浮动；overlay 已足够 |

## 6. 对 MAFW 的可借鉴形态清单

### P0（建议直接落进 A 方案）

1. **保持 760 默认，320 只做硬底线。**
   - 760 ≈ 业界 768 阅读宽度（Codex `--thread-content-max-width`、ChatGPT 48rem）。
   - 320 只应在“窗口极小 + 用户强行拖到极限”时出现，不应是正常工作宽度。

2. **三区间布局，而不是一个全局 min：**
   - **≥1526px 窗口**：chat 760 + 工作台 ≥720，并排。
   - **1286–1525px**：并排，chat 在 520–760 之间按可用宽钳制；工作台保 720。
   - **<1286px**：工作台 **overlay / 可折叠**；chat 保持 760（或按可用宽），下限 520；320 只做极端兜底。
   - 这样在 1088（当前最小窗口）chat 仍是 760，工作台浮层，不再出现 322 的挤压。

3. **把窗口硬下限从 1088×720 降到约 900×600。**
   - 当前 1088 连 1366 屏的 50/50 分屏（683）都放不下；1920 的一半（960）也放不下。
   - 工作台 overlay 后，900 宽足够 chat 760 + rail；600 高足够 composer 200 + transcript 400。
   - 这是“小窗口 <900×600”能成立的前提；否则 320 的讨论没有实际场景。

4. **Composer 的横向契约：硬 min 320，正常 ≥520。**
   - 320 时 composer 256，六控件零降级（当前已有测试）。
   - overlay 后 chat 760，composer 696，控件非常宽松；不需要为了 320 牺牲默认体验。
   - 控件只允许换行/进入 `+`/溢出菜单，不允许 `display:none` 或压到 0（Codex #6589 / #58353 的教训）。

5. **Composer 的纵向契约：max-height 200 + 内部滚动（已有），短窗可选折叠。**
   - Claude #104231 的反例：无上限会遮 transcript。
   - Codex #20927/#25356 的正例：阅读时折叠 composer，回收纵向空间。
   - 建议在窗口高度 <600 或用户进入“阅读模式”时提供折叠，而不是默认隐藏。

### P1（A 方案落地时一起做）

6. **标题栏 / pane 按钮在窄窗溢出到 `⋮`。**（Claude 官方行为）
7. **session details / 右侧工作台是条件性的**：chat 不够宽时先隐藏/浮层，而不是压 chat。
8. **Resize 的 flex 约束**：所有中间层 `min-width: 0` / `min-height: 0`，两侧都 clamp；禁止出现 composer 被推出视口（Codex #19460）。
9. **断点回归测试**：900×600、1088×720、1286×720、1440×900、1526×900；覆盖 sidebar collapse、workbench overlay、composer 200px、控件不隐藏。
   - Codex #21780/#22000 说明 Electron 在响应式断点容易出现残影/裁切；断点测试不能只看逻辑，要真实渲染。

### P2（可选，不阻塞 A）

10. **浮动 composer**：当 Browser/工作台铺满时，把 composer 浮在内容上（Claude #105889 的诉求）。A 方案的 overlay 已经能保住 chat，不必先做浮动。
11. **composer 折叠态**做成显式“阅读模式”，并持久化用户偏好；默认展开。

## 7. 不确定 / 待验证

- Claude 的 chat 面板是否有硬 min、composer 下方选择器在窄窗如何换行：官方文档未写，需装 Claude Desktop 后实测。
- Codex 的 composer 折叠触发方式、折叠后的高度、侧栏折叠断点：issue 只证明“存在折叠态”，没有官方数值。
- 两家的窗口 min 来自用户报告，版本相关；Claude ~600、Codex ~60% 16" 不是官方承诺。
- 本次没有安装 Claude/Codex Desktop，无法做像素级 CSS 验证；结论以官方文档 + issue 为主。
- DSH 的宽度数值没有公开来源，只用于说明“dock 模型不同”，不参与 min 对比。

## 8. 参考

- Claude Code Desktop 官方文档：<https://code.claude.com/docs/en/desktop/>
- Claude Desktop 窗口 min ~600：<https://github.com/anthropics/claude-code/issues/49856>
- Claude 左侧栏 <700 自动隐藏：<https://github.com/anthropics/claude-code/issues/108198>
- Claude composer 无高度上限：<https://github.com/anthropics/claude-code/issues/104231>
- Claude split view 面板挤压：<https://github.com/anthropics/claude-code/issues/102233>
- Claude 浮动 composer feature request：<https://github.com/anthropics/claude-code/issues/105889>
- Claude 对话列 max-width 诉求（720–820）：<https://github.com/anthropics/claude-code/issues/57991>
- Codex 对话内容 max 768 / 宽度持久化：<https://github.com/openai/codex/issues/16669>、<https://github.com/openai/codex/issues/20236>
- Codex 侧面板把 chat/composer 压坏：<https://github.com/openai/codex/issues/59523>
- Codex composer resize 溢出：<https://github.com/openai/codex/issues/19460>
- Codex composer 折叠：<https://github.com/openai/codex/issues/20927>、<https://github.com/openai/codex/issues/25356>
- Codex 响应式渲染问题：<https://github.com/openai/codex/issues/21780>、<https://github.com/openai/codex/issues/22000>
- Codex 窗口 min：<https://github.com/openai/codex/issues/14010>
- Codex model picker wrapping 修复：<https://github.com/openai/codex/pull/6589>
- OpenCode chat/side 降到 320：<https://github.com/anomalyco/opencode/pull/57343>
- 仓库内既有调研：`docs/research/2026-10-26-detent-ratio-vs-absolute.md`、`docs/research/2026-11-04-chat-detent-default-760.md`
