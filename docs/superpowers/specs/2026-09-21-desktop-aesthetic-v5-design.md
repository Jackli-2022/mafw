# MAFW Desktop 美学重设计 v5（精化 + 暖纸感差异化）— 设计文档

> 日期：2026-09-21
> 前置：2026-09-20-desktop-redesign-design.md（token v4「精致暗色+品牌绿」已全部落地）、2026-09-20-desktop-ux-refactor-design.md（结构绞杀者+四切片已落地，v4.12.0）
> 决策：用户选定方向 A（精化）+ B（差异化）合并执行；方向 C（对话退位、产出物上位的信息架构重构）已记便签板暂缓（mem_1789967950090_cf5j5s）
> 状态：设计已获用户整体批准（§1–§7）

## 1. 背景与调研依据

### 1.1 起点

9-20 的 v4 重设计（五阶背景/信号绿/动效 token/空状态/PageHeader）刚完整落地，功能与结构层（SSE dispatcher、session-workspace、审批三档、diff 审阅、plan/build、worktree 并行）也已完成。本轮不动骨架，解决 v4 落地时**未对标业界细节**的执行差距。

### 1.2 业界调研（2026-09-21，三路并行：AI 对话产品 / 开发者工具 / 趋势文献）

调研对象：ChatGPT/Claude/Gemini/Perplexity/v0/Codex、Linear/Raycast/Cursor/Zed/Warp/Geist/opencode、NN/g/IxDF/shadcn/Radix 文献。收敛的十条硬规律：

1. **深灰不纯黑**：深色底集中 `#131314`–`#212121`，2-4 级明度台阶分层（shadcn dark = `oklch(0.145)`；Geist 仅 Background 1/2 两级）
2. **边框优先于阴影**：交互反馈走边框色阶；暗色 hairline 用 `white 6-14%` alpha；阴影只给浮层（Geist 400/500/600 = default/hover/active）
3. **单 accent 纪律**：全应用一种 accent、面积 <5%，只在 primary action/active/focus ring；语义四色只进状态位
4. **双字体契约**：sans 管 UI、mono 管一切"数据"（路径/hash/token 数/快捷键）；数字一律 `tabular-nums`；mono 比配对 sans 小 1px
5. **14 是王者字号**：UI chrome 主力 13–14px label；层级靠字重+明度而非更多字号（Geist：label-14 是全系统最常用样式）
6. **消息排版收敛**：用户右对齐气泡 + assistant 无边框文档流（~700–770px 居中列、16px/1.7）
7. **空状态=品牌情绪橱窗**：居中大标题+输入框+建议 chips；排版驱动无插画
8. **动效毫秒级**：100ms 微反馈 / 200–300ms 面板 / 上限 400ms；ease-out 入场；只动画 transform/opacity；reduced-motion 替换非删除
9. **AI 状态三段式**：thinking=脉冲+文字标签；streaming=流式排版+尾光标（流式输出即最佳进度反馈，不叠 spinner）；tool call=状态条呼吸态
10. **玻璃退潮为浮层专用**：command palette/dropdown/toast 可用；内容卡片/表单/聊天区一律实底

两个战略信号：
- **暖色温是差异化捷径**：全场仅 Claude 用暖奶油底+衬线正文跳出"AI=冷灰蓝"同质化；**品牌绿 × 暖纸底组合无人占位**
- **对话退位、产出物上位**：Codex 收敛为任务收件箱+diff 审阅、Claude Artifacts 双栏——布局应预留演进位（本轮只留 hook，不实现）

### 1.3 v4 差距清单（本轮要修掉的）

1. accent 绿 `#46DC82` 偏亮偏饱和（业界 dark 下会降饱和提明度）
2. 双字体契约未制度化（mono 使用靠手感，无 tabular-nums 全局规定）
3. 消息正文 15px 小于业界 16px；行高/阅读宽度无明确规范
4. AI 状态语言缺 streaming 尾光标
5. WelcomeHome/Dashboard 未 bento 化
6. 中性偏冷底放弃了暖色温辨识度机会
7. 字号阶梯偏多，未收敛到 3 级

## 2. 目标 / 非目标

**目标**：
- token v5 暖调中性色阶 + accent 绿重校准（差异化签名）
- 双字体契约 + 字号三阶收敛（制度化）
- 消息排版对齐业界（16px/1.7/720px）+ streaming 尾光标
- WelcomeHome/Dashboard bento 化 + ChatPane 预留双栏 hook
- 动效数值全量审计

**非目标**：
- 不改功能语义、数据流、gateway API
- 不动 Rail/TabStrip/RightDock 骨架与 v4 已验收的布局决策
- 不引入新依赖、不做方向 C 的信息架构重构
- 不换 UI 组件库（继续 @mafw/ui v2 组件约定）
- 衬线正文不引入（Claude 式 serif 与开发者工具气质不符，明确放弃）

## 3. 设计

### §1 Token v5：暖调中性色阶

五阶背景从冷中性偏移到暖纸感（chroma ≤0.02，观感"温润"而非"发黄"）：

```
暗色（墨纸）：                    亮色（米纸）：
--bg-base:    #100F0E            --bg-base:    #FAF9F5
--bg-raised:  #161513            --bg-raised:  #F3F1EB
--bg-overlay: #1D1B18            --bg-overlay: #FFFFFF
--bg-float:   #252320            --bg-float:   #FFFFFF（+shadow）
--bg-inset:   #12110F            --bg-inset:   #EFEDE7
```

- 文字六阶同步微暖化（同 chroma 约束）
- 边框 alpha 值不变（已是 white/black alpha 制），底色变化自动透出暖感
- v4 变量名全部保留只改值——v2/v3 覆盖层继续工作
- 验收：双主题截图确认"温润不显脏"；不达标则 chroma 再降

### §2 accent 绿重校准

- 暗色 `#46DC82` → 降饱和约 10%（候选起点 `#4FD388`，Wave 0 截图门禁下调准）
- 亮色 `#1F9D5A` 在米白底上微调至对比度 ≥4.5:1
- `--accent-strong/soft/border` 衍生色按新值同比例重算
- 纪律不变：绿只出现在 primary action / active / focus ring / 成功态

### §3 双字体契约 + 字号收敛

- 新 token：`--font-ui`（sans stack）/ `--font-data`（mono stack），写入 mafw.css 变量层
- 规则：
  - mono 比配对 sans 小 1px（14 UI 文本旁的 mono 用 13px）
  - 所有数字（token 数/成本/耗时/百分比/计数徽标）强制 `font-variant-numeric: tabular-nums`
  - 路径/hash/快捷键 hint/命令片段一律 `--font-data`
- 字号三阶收敛（**UI chrome 轨**）：12–13px（label/辅助）/ 14px（UI 主力）/ 24±4px（页面标题）；层级靠字重 + muted 明度，不再新增字号
- 对话正文属独立**阅读排版轨**（16px/1.7，见 §4），不占 UI chrome 三阶名额

### §4 消息排版 + streaming 光标

- assistant 正文 15px → **16px / 行高 1.7**；阅读列宽规范 720px（现有 760px 微调）
- 流式输出尾部渲染 **▌ 块光标**：1s 呼吸闪烁（opacity 0↔1），part 完成即移除；`prefers-reduced-motion` 下静态不闪
- thinking 脉冲保留现状（已合规）
- 用户气泡、tool card、思考折叠结构不动

### §5 WelcomeHome / Dashboard bento 化 + 双栏 hook

- **4 列 bento 网格**：卡片跨列 ∈ {1,2,4}、一卡一问题、卡间距 = 卡内 padding 的一半
- WelcomeHome：大问候卡（2×2 锚点）+ 项目 chips + 「先规划」引导卡 + 待办概览
- Dashboard：KPI 行改为 bento 卡片拼版
- **双栏 hook**：ChatPane 主区容器加 `data-layout="chat"` 的 grid 结构（当前单列），未来工件栏插入第二列即扩展，不动现有布局
- 会话列表、日志流等扫描型数据**不** bento 化（bento 不适合列表扫描）

### §6 动效数值审计

- 保留现有 120/160/200/240ms token；全应用扫描违规项：
  - 入场必须 ease-out、离场 ease-in、禁 linear
  - 模态/popover ≤240ms；只动画 transform/opacity
  - 进入比退出长约 50ms
- reduced-motion 覆盖检查：位移/缩放 → opacity dissolve

### §7 测试与验收

- **token 对齐测试扩展**（`packages/desktop/tests/token-alignment.test.ts`）：
  - 暖调双主题变量一一对应
  - `--font-ui`/`--font-data` 存在且被引用
  - 硬编码 hex 白名单扫描沿用（白名单外禁 hex）
- **streaming 光标**：纯逻辑测试（part 完成移除、reduced-motion 静态）+ 截图
- **bento**：网格结构断言（跨列 ∈ {1,2,4}）+ 截图
- **截图门禁**：每波双主题各一张人工确认（`mafw_desktop_screenshot`）
- CSS 总量约束：v4 基础上 ≤ +8%

## 4. 实施波次

| Wave | 内容 | 验收物 |
|---|---|---|
| 0 | Token v5（§1 暖调色阶 + §2 accent 校准） | token 对齐测试绿 + 双主题截图 |
| 1 | 字体契约 + 消息排版（§3 + §4） | 结构/光标测试 + 对话区截图 |
| 2 | bento 化（§5，WelcomeHome + Dashboard + 双栏 hook） | 网格断言测试 + 双页截图 |
| 3 | 动效审计（§6）+ 全应用一致性 sweep | 违规清单清零 + reduced-motion 验证 |

每波独立 commit + 版本号 + 新增测试数与全量通过数汇报（用户惯例）。

## 5. 落地文件映射

| 区域 | 文件 |
|---|---|
| token v5 / 字体 token | `packages/desktop/src/renderer/mafw/mafw.css`（变量层） |
| token 对齐测试 | `packages/desktop/tests/token-alignment.test.ts`（扩展） |
| streaming 光标 | `components/ChatPane.tsx` 或 session-ui override（mafw.css scoped） |
| 消息排版 | mafw.css §对话区 + session-ui scoped overrides |
| bento | `components/WelcomeHome.tsx`、`pages/Dashboard*.tsx`、mafw.css 新 bento 段 |
| 双栏 hook | `components/ChatPane.tsx` 主区容器 |
| 动效审计 | mafw.css 全文件 + 组件内联 style 扫描 |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 暖调显脏/显旧 | chroma ≤0.02 硬约束 + Wave 0 截图门禁，不达标继续降 |
| accent 新值与既有 soft/border 衍生色不协调 | 衍生色同比例重算，整体截图验收 |
| 字号收敛碰到信息密度回退 | 只收敛"阶梯数量"，不动已有可读性决策；逐页截图对比 |
| bento 化破坏 WelcomeHome 刚落地的「先规划」引导 | 引导卡作为 bento 卡片保留，文案不动 |
| streaming 光标闪烁性能 | 仅 opacity 动画；part 完成即移除，无累积 |

## 7. 明确不纳入（YAGNI）

- 方向 C 信息架构重构（便签板已记，另立项调研）
- 衬线正文、玻璃拟态、插画式空状态
- Rail/TabStrip/RightDock 结构变更
- 虚拟滚动、动画库、新字体文件引入（用系统字体栈）
