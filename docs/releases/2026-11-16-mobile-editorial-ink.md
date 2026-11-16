# 2026-11-16 · Mobile Editorial Ink 视觉重做

- **分支**：`main`
- **提交**：`5852b7e5`
- **设计稿**：`docs/design/mobile-redesign-2026-11-16/`（A/B/C 方向 + 最终四屏截图）
- **前置**：`afb23695` / `3df99308`（U 批卡片式精修）

## 为什么重做

U 批只是“卡片精修”：每一条仍是带边框卡片、mint 仍在做装饰、字号层级仍然扁平，
所以看起来还是设置页。对照 Grok / Claude / Linear 的公开设计资料后，把根因归结为：

- 卡片数量过多，所有条目视觉权重相等；
- 10–13px 字号挤在一起，没有“大标题 → 正文 → 元信息”的跳变；
- mint 被用于卡片描边、圆底图标等装饰，失去“需要你 / 激活 / CTA”的稀缺性；
- Material `NavigationBar`、AppBar、FAB、ListTile 都在提醒“默认组件”。

## 设计系统

- **画布**：暖近黑 `#0A0A0B`；ink `#141416`；hairline `#232326`；
  cream `#F4EFE6`；dim `#8B8B90`；faint `#58585E`；唯一 mint `#63E6A4`。
- **字阶**：40 / 28 / 17 / 15 / 12 / 10（`MafwType`）；
  Latin 字标与大数字用随包 **Instrument Serif**（OFL，70KB），中文与正文继续系统 sans。
- **间距**：24px 页面边距、32px 段距、13–15px 行内 padding；1px hairline 取代卡片边框。
- **导航**：`MafwBottomNav`，64px、19px 细线图标 + 9px 标签 + 激活项 3px mint 点；
  三个 tab 全部移除 AppBar / FAB。
- **系统 chrome**：`debugShowCheckedModeBanner=false`；状态栏/导航栏黑底浅色图标。

## 页面

### 工作

- masthead：Lore 18 + `ORCALORE` overline + 日期 + 新建＋；40px serif 字标；
  项目名是文字选择器。
- 需要你：10px mint overline + 2px mint 竖线 + hairline 行，不再是一叠绿色卡片。
- 五桶只渲染非空桶；Goal 行 = title 15 + 一行 meta + 右侧 verdict，无卡片/无 chip；
  历史折叠为 `work-history-row` sheet；首屏 hairline 骨架屏。
- 结果待查看行仍是可点入口，打开 sheet 后进入 Goal。

### 聊天

- `CHATS` overline + 28px「会话」+ 页头扫码/设置/新话题；会话列表是无头像的 hairline 索引，
  LEAD/SUB 用 8px mono 标签。
- 聊天页 composer 顶部 hairline，发送按钮 cream（不再 mint）；用户气泡 20dp + 6dp 尾角、
  无边框；assistant 保持全宽文档排版。

### 我的

- `ORCALORE / PROFILE` + 32px serif 字标；记忆/连接/关于全部 hairline 行，
  18px dim 图标，无卡片、无 mint 圆底。

### Goal 详情

- `GOAL` overline + 26px 标题 + 单行 meta；时间线/版本/结果去掉 Card；
  done 节点改为灰描边勾，结果 verdict 28px serif；需要你槽位改为 mint 竖线。

## 测试

- `flutter analyze` 0。
- 全量逐文件 **596/596（41 文件）**：其中包括既有契约按新结构更新；本轮新增 2 例
  （`work_tab` 历史 sheet、`theme_tokens` 字体资产）。全量脚本单次运行 460 例通过，
  4 个被 flutter_tester 随机中断的文件单独复跑 136 例全过（26+29+45+36）。
- 更新契约：work_tab 非空桶 / history sheet / 页头新建；tab_shell 自定义底栏 + 无 FAB；
  sessions 无头像索引；goal detail 灰描边 done / 单行 meta。
- 本机聚合 `flutter test` 仍有既有 flutter_tester 随机崩溃，逐文件 + `--concurrency=1` 为门禁。

## 模拟器冒烟

- AVD `Pixel_9a` + `adb reverse tcp:3000`，核对工作 / 聊天 / 我的 / Goal 详情四屏
  （截图见 `docs/design/mobile-redesign-2026-11-16/final-*.png`）。
- 过程中发现并修复：工作页头新建按钮触控目标过小、离线横幅整条大红与编辑式界面冲突、
  Goal 详情卡片/白实心节点与主界面语言不一致。

## 未做

- 真机 Tailscale 冒烟（P1-P4）仍需真实手机 + gateway + 桌面。
- OS `orcalore://pair` intent 路由（无 app_links，QR 仍是主路径）。
