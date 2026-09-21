# Composer 工具条图标统一设计（2026-09-21）

## 背景

ChatPane composer 左侧工具条 8 个按钮混用三种视觉语言：文本字符（`/`、`+`、`@`、`⇄`）、彩色 emoji（`🗣`、`🎤`、`⏹`）、emoji/符号+中文标签（`🛡只读`、`◇ plan`）。emoji 跨平台渲染不一致、颜色不受主题控制、基线错位；动作按钮与模式开关无分组。

另发现潜在 bug：`ChatPane.tsx:2037` 用 v1 `Icon`（`@mafw/ui/icon`）渲染 `name="sparkles"`，但 v1 图标表没有该名字，渲染为空 `<use>`（v2 图标表才有 sparkles）。

## 方案（用户选定 A：全量 SVG 图标化）

### 图标映射

全部换为 `@mafw/ui` v1 单色 SVG 图标（stroke=currentColor，继承主题色）：

| 功能 | 现状 | 新图标 |
|---|---|---|
| 附件 | `+` | `paperclip`（新增） |
| 命令 | `/` | `console`（现有） |
| 引用 Agent | `@` | `subagent`（现有） |
| 审阅改动 | `⇄` | `review`（现有） |
| 语音播报 | `🗣` | `volume`（现有） |
| 录音/停止 | `🎤`/`⏹` | `microphone`（新增）/ `stop`（现有） |

### 新增图标（packages/ui/src/components/icon.tsx）

- `paperclip`：feather paperclip 等比缩放到 20×20 viewBox
- `microphone`：话筒（胶囊 rect + 弧线支架 + 底座线），round linecap
- 同时 `export` icons 表供回归测试断言

### 模式开关改为 pill（模式组）

与右侧 model/agent pill 同族样式（26px 高、圆角、11-12px 字、图标+文字）：

- 审批模式：`shield` 图标 + 文字（只读/auto/全开），非只读保留 `mafw-perm-mode-auto` 高亮
- plan/build：随状态换图标（default=`sliders`、plan=`bullet-list`、build=`terminal`）+ 文字（默认/plan/build），非默认高亮

### 分组与排列

左侧按「动作组 │ 模式组」排列，中间 1px 分隔线（`.mafw-composer-divider`）：

```
[📎 附件][⌨ 命令][@ 引用][⇄ 审阅][🔊 语音][🎙 录音] │ [🛡 只读][◇ plan]
```

行为、快捷键、tooltip 全部保持不变，仅视觉替换与重排。

### sparkles bug 修复

`ChatPane.tsx` 引用 chip 处改用 v2 `Icon`（`@mafw/ui/v2/icon`，WelcomeHome 已有先例）。

## 改动面

1. `packages/ui/src/components/icon.tsx`：新增 `paperclip`/`microphone` 两个 path；`export const icons`
2. `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`：工具条 JSX 替换 + 重排 + 分隔线 + mode pill + sparkles 改 v2
3. `packages/desktop/src/renderer/mafw/mafw.css`：新增 `.mafw-composer-divider`、`.mafw-mode-pill`，补 icon 在按钮内的 flex 居中

## 测试

- 新增 `composer-icons.test.ts`：断言工具条用到的全部图标名存在于 v1 icons 表且 body 非空（防"sparkles 空渲染"类回归）
- `bun test` 全量回归（desktop）；`electron-vite build` 验证编译
- 桌面截图目检输入条

## 非目标

- 不做溢出收纳菜单（方案 B）
- 不改右侧 pill 与发送按钮
- 不动 TUI
