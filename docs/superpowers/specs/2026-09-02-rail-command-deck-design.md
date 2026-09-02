# Rail「指挥台」重设计 — Manager 入口+状态面板

日期：2026-09-02
状态：已批准（方案 A）
范围：桌面端 renderer（`opencode-dev/packages/desktop/src/renderer/mafw/`）；gateway 零改动

## 背景与目标

Rail 现状（ChatGPT 式重设计后）：顶部项目切换器 → 新会话按钮 → 搜索框 → 日期分组会话列表 → 底部固定区（Manager 小行 + Usage + Settings）。

用户反馈三点：

1. **操作效率**是重设计的主要动机
2. **Manager 重要性不足**：目前只是底部一行小字，而它是系统的调度中枢
3. **搜索区低效**：常驻占一整行但使用频率低，且 Ctrl+K 快捷键不可见

目标：Manager 升级为「入口 + 状态面板」（点击直达会话，卡面显示活跃 Goal 进度与待决问题数）；搜索折叠为图标释放空间。

## 非目标

- 会话列表本身（日期分组、右键菜单、重命名、无限滚动）不做任何改动
- 项目切换器交互不变
- 不改 gateway API（数据管道全部现成）

## 组件结构

### `ManagerCard.tsx`（新增，`components/`）

```
Props: {
  managerSessionId: string | null
  onSelectSession: (id: string, title: string, manager: boolean) => void
  onOpenQuestions: () => void
}
```

- 自包含：内部轮询数据，Rail 不参与其状态管理
- `managerSessionId` 为空时整卡不渲染（与现状一致）

### `Rail.tsx`（改造）

- 头部行增加搜索图标位；移除搜索常驻行与底部 Manager 行
- 挂载 `ManagerCard`（头部之下、New session 之上）
- 底部固定区只留 UsagePill + Settings
- 现有 `onSearchKeyDown` / Ctrl+K / 高亮导航逻辑保留

### `MafwShell.tsx`（接线）

- 传入 `onOpenQuestions`：切换右侧面板到 Questions 视图；若当前实现无独立 Questions 视图，降级为打开 manager 会话（实现时确认，二选一，不新建视图）

## ManagerCard 数据与形态

| 元素 | 数据源 | 行为 |
|---|---|---|
| 名字 + 状态点 | `gwStatus`（Rail 已有）+ manager session 在线态 | 绿=活跃，灰=Idle |
| 活跃 Goal 行 | `window.api.mafw.goals.list()`，15s 轮询 | goals 中过滤 status 为 cancelled/archived 的，取 `time.updated` 最新一条：标题 + 进度条；无 steps 数据则只显状态文字；无候选 Goal 显示 "Idle" |
| 待决问题徽标 | `window.api.mafw.questions.list()`，15s 轮询 | pending 数 > 0 时显示红底白字 pill；点击调 `onOpenQuestions` |
| 最近活跃 | manager session `time.updated` | 相对时间（"12 分钟前"，复用 Rail 现有时间格式化思路） |

- 轮询节奏 15s（与 Dashboard 一致）；gateway 离线（`offline()`）时停轮询、状态点转灰
- fail-open：goals/questions 任一接口失败 → 对应区域隐藏，卡片保留名字+状态点，不崩
- 点击主体 → `onSelectSession(managerSessionId, "Manager", true)`

## 搜索折叠交互

- 头部行布局：`▾ 项目切换器 | ⌕ 搜索图标 | ⇞ 折叠箭头`
- 点 ⌕ 或 Ctrl+K：图标原位展开为 `TextInputV2` 并 autofocus（展开行插在头部与 ManagerCard 之间）
- 收起条件：Esc（清空+收起）、失焦且查询为空；有查询词时保持展开
- Tooltip（openDelay 300）注明 "Search  Ctrl+K"

## 最终布局顺序

```
头部（切换器 + ⌕ + ⇞）
[搜索展开行 —— 仅展开时，紧贴头部保证空间连续]
ManagerCard
New session 按钮
会话列表（日期分组，不变）
Usage + Settings
```

## 样式约束

- 全部使用 `@opencode-ai/ui/v2` 组件（ButtonV2 / TooltipV2 / TextInputV2），禁止裸 `<button>` / `<input>`（项目约定 §5.10）
- ManagerCard：accent 左边条 + 微底色区分，视觉上第二位但不抢会话列表主视觉
- 徽标 pill 与 ToastV2 风格一致（红底白字、圆角）

## 错误处理

- goals/questions 轮询失败：对应元素隐藏（fail-open），不影响卡片主体
- gateway 离线：停轮询 + 状态点灰
- 渲染层全部 try/catch 包裹异步取数，异常静默降级

## 测试与验收

桌面包无单测框架 → `npm run typecheck`（tsgo -b）+ 手动验证清单：

1. Manager 卡片显示，点击主体打开 manager 会话
2. 有活跃 Goal 时显示标题+进度；无 Goal 时显示 Idle
3. 构造待决问题 → 徽标出现计数，点击切到 Questions 视图
4. ⌕ / Ctrl+K 展开、Esc 收起、失焦空查询收起
5. 会话列表右键菜单、重命名、搜索高亮导航回归正常
6. 断开 gateway → 卡片灰点、列表显示 Gateway offline
