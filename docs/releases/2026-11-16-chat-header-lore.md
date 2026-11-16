# 2026-11-16 · Chat 头部使用 Lore 头像与名字

- **版本**：`v5.1.0`（视觉修订，不升版本号）
- **提交**：`e6c7f877`
- **范围**：desktop ChatPane 标题栏；gateway / SDK / runtime 零改动
- **前置**：`docs/releases/2026-11-16-lead-tab-restore.md`

## 现状

- Chat 标题栏左侧原本是「会话首字母」圆标 + 会话标题。
- 现在改为：
  - 头像使用 Lore 图标（`assets/lore/lead-avatar-20.png`，28px 容器内 cover）；
  - 头像右侧固定显示 **Lore**；
  - 宽容器显示 `Lore · 会话标题`（Lead 会话即 `Lore · Lead`）；
  - 容器 ≤700px 时隐藏冗余的会话标题与分隔点，只保留 Lore、token 徽标与操作按钮。
- 头像、名字、标题都走主题 token；没有新增裸颜色。
- 名字是固定宽，标题仍是唯一可收缩项（`mafw-session-titlebar-text` 保留 ellipsis + min-width: 0），
  不改变现有「标题过长只压缩 text，按钮不变形」契约。

## 真机验证

- 宽窗口：Lore 头像 + `Lore · Lead` / `Lore · 会话主题`。
- 696px 容器：`Lore` 可见，标题隐藏；`scrollWidth == clientWidth`（696），操作按钮不溢出。
- Lore 图标使用现有 20px 资源；28px 容器内 `object-fit: cover`。

## 测试与门禁

- desktop 全量：**3886 / 3886** pass（737 suites）
- 新增 `chat-header-lore.test` 2 个用例（Lore 头像/名字、窄容器保留 Lore 隐藏标题）
- `npx electron-vite build`：rc=0
- `npx tsgo --noEmit -p tsconfig.json`：仍被并行 plugin 改动阻断
  （`PluginPackagesSection.tsx` 重复 key）；本次涉及文件无类型错误。
- 未 push、未合并远端。

## 边界

- 头像仍使用 20px 资源，在 28px 容器内会轻微放大；如需要更锐利的 2x/3x 版本，要补更大的 Lore 资源。
- 窄容器隐藏会话标题后，当前会话主题仍可在顶部 session tab / 工具提示中看到。
