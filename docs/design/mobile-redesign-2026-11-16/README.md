# Orcalore Mobile 视觉重做 · 方向稿（2026-11-16）

> **2026-11-16 选定 A · Editorial Ink**，最终四屏截图见 `final-work.png` / `final-chat.png` /
> `final-me.png` / `final-goal.png`。B/C 保留为后续备选。

## 为什么现在显丑

对照 Grok / Claude / Linear 的公开设计资料，当前界面的问题不是“颜色不对”，而是：

1. **每条都是卡片**：需要你 3 张卡 + Lead 1 张卡 + 5 个桶 5 张卡 + 结果行，边框和圆角重复，视觉权重全部相等。
2. **mint 被当装饰**：需要你卡片整块 mint 描边/底色、我的页四个 mint 圆底图标，强调色失去稀缺性。
3. **字号层级太扁**：12 / 13 / 14 / 15 挤在一起，没有“大标题 → 正文 → 元信息”的明显跳变。
4. **信息密度高但留白少**：8–12px 间距 + 10px 小 chip，读起来像设置页/仪表盘。
5. **Material 默认件太多**：底部导航的 pill 指示器、FAB、Card、Chip 都在提醒“这是 Flutter 默认组件”。
6. **没有品牌排版**：Orcalore 字标和正文同一套系统字体，缺少记忆点。

## 业界参照（要点）

- **Grok**：true black、无卡片、assistant 全宽正文、用户消息单侧气泡、16pt 边距、24–32pt 轮次间距、1.55 行高、28pt 屏标题、单一强调色、没有底部 tab。
- **Claude**：暖纸底 `#F8F4ED`、serif 正文、20pt 边距、32pt 轮次间距、单一 terracotta、无渐变/无发光。
- **Linear**：导航比内容暗一档、减少图标数量、缩小图标与 tab、软化分隔线、一个屏幕只允许一个“响”的元素。
- **共性**：高级感来自大留白、强字阶、单一强调色、克制的容器、定制的微交互；不是渐变、阴影或更多装饰。

## 三个方向

### A · Editorial Ink（推荐）

暗色编辑式排版：

- 24px 边距；`Orcalore` 用 serif 大字标（40px），项目名是文字链接而不是 pill。
- 需要你 = 一条 2px mint 竖线 + 3 条 hairline 行；不再是一叠绿色卡片。
- 五桶只显示非空桶；标题是 10px letterspaced overline + 等宽计数，Goal 行无卡片、无边框。
- 底部导航改成 64px 文字导航：细线图标 + 9px 标签 + 激活项 3px mint 点；去掉 Material pill。
- 去掉 FAB，把「新建」变成「进行中」标题右侧的文字动作。
- 字体：Latin 字标用 serif（建议随包 Instrument Serif，OFL）；中文正文继续系统 sans，避免 CJK serif 体积与低字号可读性问题。

### B · Quiet Graphite（保守）

保留卡片，但做成 Linear 式石墨层：

- 20px 边距、18–20px 圆角、无硬边框、仅靠 tonal surface + 1px 内高光分层。
- 需要你合并成一张卡，左侧 2px mint 状态条；不再每行一张绿卡。
- Goal 卡左侧状态条（进行中 mint / 其他中性），去掉 chip，元信息压成一行。
- 底部改为悬浮 dock（blur + 描边），激活项用白色 pill。
- 改动量最小，但结构上仍是“卡片仪表盘”。

### C · Warm Paper（最大胆）

Claude 式暖纸浅色：

- 纸底 `#F5F0E7`、墨色 `#1C1917`、深 mint `#1F7A55`、20/24px 边距。
- 与 A 同一套编辑式结构（大字标、hairline、单一强调竖线），但整体换成浅色。
- 最不像“AI 工具默认深色皮”，也最容易做出“贵”的感觉；代价是品牌从暗色 OLED 转向纸感，夜间使用与现有截图差异最大。

## 建议

先做 **A**。它保留现有暗色品牌与 mint 语义，但把“卡片堆叠”换成“编辑式层级”，是这次“显丑”的根因修复；B 只是精修，C 可以作为后续可选主题。

## A 的落地范围（确认后）

- `theme.dart`：纸感暗色 token（`#0A0A0B` / cream `#F4EFE6` / 三档灰 / 单一 mint）、字阶（40/28/17/15/12/10）、间距（24 边距、32 段距）、hairline token。
- `work_tab.dart`：masthead、需要你分组、Lead 行、非空桶、空态、骨架屏、结果 sheet 全部重排；自定义底部导航；移除 FAB。
- `chat_page` / `chat_messages`：沿用 Grok 式全宽正文 + 单侧气泡，composer 改为无边框 hairline 输入区。
- `sessions_page` / `me`：去掉装饰性 mint 圆底，改成文字/细线体系；关于区保留。
- 字体：bundled Latin serif（OFL）用于字标与数字；中文系统 sans。
- 动效：150–220ms ease-out；仅用于页面进入、sheet、按压，不做弹跳。
