# Desktop 视觉语言重校准交付记录

- 日期：2026-11-12
- 版本：5.1.0（未 bump/发布）
- 最终视觉 commit：`a76fe496`（文档收口 `e9564ab1`）
- 规格：`docs/superpowers/specs/2026-11-12-desktop-visual-language-design.md`
- 计划：`docs/superpowers/plans/2026-11-12-desktop-visual-language.md`

## 交付

- 三主题 token 收敛：中性表面、4.5:1 文字矩阵、主操作/交互/成功语义分离。
- `--border` 断链修复；0.5px 边框与 ring 迁移到 1px；内容卡片去装饰渐变/内高光。
- v1/v2 Desktop scoped 映射；composer 与输入控件使用强边界和可见 2px accent 焦点环。
- 核心元信息 12px；会话关闭/新建改用注册 SVG 图标。
- 动效 token 收敛：80 / 120 / 180 / 220 / 240 / 320ms；运行循环单一化；reduced-motion 保留信息。
- Goal 完成标签与 100% 进度恢复 success 语义；必需要素不再换行；状态软底文字提高对比。
- 真实 Desktop 亮/暗、2560 与 1366、popover 证据：`.mafw/qa/visual-language-2026-11-12/`。

## 验收

- `npm run test:desktop`：3478 pass / 0 fail（最终视觉提交时）
- `npx tsgo --noEmit -p tsconfig.json`：通过
- `npx electron-vite build`：通过
- 新增视觉契约测试 20 项
- 用户人工视觉 gate：通过

## 范围

布局冻结：未修改栏宽、网格、路由、默认视图或组件 API；未修改 `@mafw/ui` 公共默认主题；未 push/deploy/release。

## 遗留

Reviewer 的 Minor 项记录在交付会话与计划执行记录中：其余文本字形关闭按钮、flow 选中勾对比、少量 dead CSS、body portal reduced-motion、运行循环时长统一、`--hairline` 消费、公共 v2 库内部 0.5px、data-part badge 密度、图标描边默认值。后续按独立视觉收口任务处理。
