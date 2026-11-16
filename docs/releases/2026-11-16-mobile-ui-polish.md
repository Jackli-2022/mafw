# 2026-11-16 · Mobile F/U 批：功能打磨 + UI 高级化

- **分支**：`main`
- **提交**：`61cbbaf2`（F 批功能）、`afb23695`（U 批 UI）
- **范围**：`mobile/` 客户端；不改 gateway 契约
- **Spec**：`docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`

## 目标

功能优先：先补弱网、结果入口、会话错误与计划 stale 四类真实痛点；再把工作 tab、我的、
聊天/讨论输入区与空态统一到 Orcalore 令牌体系，去掉最后一轮字面色与对比度问题。

## F 批：功能打磨（`61cbbaf2`）

- **统一请求超时**：`GatewayClient` 默认 20s（`requestTimeout` 可注入），GET/POST 超时抛
  `GatewayTimeoutException`；它同时实现标准 `TimeoutException`，E5b replay 等既有 catch 无需改写。
  health 等探测仍可传更短值。弱网不再无限转圈。
- **结果待查看可操作**：工作 tab 的未读行改为可点 surface 条，打开 `result_ready` 桶 sheet；
  点 Goal 进入详情并沿用 `markPodEventsSeenAll` 已读链路。
- **Tech Lead 启动错误不再误报归档**：200 + `sessionID:null` + `sessionError` 显示可重试错误，
  只有真正的归档才走只读 transcript。
- **Plan stale 预判**：服务端 `stale=true` 时提前提示、禁批并提供「重新加载计划」，
  避免按钮永远 409。
- 新增测试 7 例：timeout 4（含 `TimeoutException` 兼容）、unread sheet 1、sessionError 1、server stale 1。

## U 批：UI 高级化（`afb23695`）

- **令牌化**：`MafwType`（6 级字阶）/ `MafwSpace`（4pt 网格）/ `MafwRadius`（8/14/18/999）；
  `onError` 改为黑色（error 红上 5.4:1）。
- **工作 tab**：静态骨架屏替代 spinner；品牌行 24px Lore + 字标 + 语义化项目 pill；
  五桶标题「小标题 + 计数 + hairline」；Goal 卡片 ink + hairline + chevron；需要你图标加 mint 弱底；
  结果行、空态圆形徽标与描边 CTA。
- **我的 tab**：顶部 Lore 40px + `Orcalore` 字标 + 定位语；底部「关于」区，
  `kAppVersion` 由测试读取 `pubspec.yaml` 校验。
- **聊天 / 讨论**：composer 顶部 hairline、输入框继承 14dp 圆角、附件/语音降为 dim；
  用户气泡 hairline + 6dp 尾角，assistant 保持全宽文档排版。
- **色彩纪律**：连接设置 URL 提示、Triage / 会话空态、配对页 AppBar（inversePrimary → 真黑）
  全部回到 token；`lib` 不再有 `Colors.*` 语义色残留（相机 overlay 除外）。
- 新增测试 7 例：主题令牌 5、骨架屏 1、我的品牌/关于 1。

## 门禁

- `flutter analyze` **0**。
- 全量逐文件 **593/593（41 文件）**：theme_tokens 23、work_tab 34、tab_shell 8、sessions 11、
  pairing 45、chat render 6、tech lead 12、plan 18、lead entry 13、lead handoff 20、goal detail 29、
  event replay 23、gateway timeout 4、widget 2；其余文件同样逐文件通过。
- 本机聚合 `flutter test` 仍会随机触发 `flutter_tester` 原生崩溃（"did not complete" /
  "Connection closed before test suite loaded"）；逐文件 + `--concurrency=1` 为门禁，
  崩溃文件单独复跑均通过。

## 未做 / 后续

- 真机 Tailscale 冒烟（P1-P4）仍需真实手机 + gateway + 桌面。
- OS `orcalore://pair` intent 路由（无 app_links，QR 仍是主路径）。
