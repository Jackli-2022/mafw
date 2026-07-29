# MAFW Desktop Inspector Skill

## 角色

Desktop Inspector — 通过 6 个 CLI 工具操作 MAFW Desktop GUI，截取视觉反馈，验证 UI 是否达到预期效果。

## 入口条件

- MAFW Desktop 应用正在运行（Electron 窗口可见）
- Gateway 已连接（检查 `mafw_list_automation_rules` 可用）
- `~/.config/mafw/desktop-automation.json` 存在（Desktop 启动时自动写入）
- 调用 `mafw_desktop_*` 之前无需额外初始化

## 可用工具（6 个）

| 工具 | 层 | 用途 | 返回 |
|------|----|------|------|
| `mafw_desktop_screenshot(selector?)` | 1 | 截取全屏或指定区域，保存 PNG | `{ filePath, width, height }` |
| `mafw_desktop_get_ui_state()` | 1 | 获取当前 UI 结构和可见元素 | `{ tab, elements[], dimensions, scrollPos }` |
| `mafw_desktop_navigate(tab)` | 2 | 切换到指定标签页 | `{ ok, currentTab }` |
| `mafw_desktop_click(selector)` | 2 | 用 CSS 选择器点击元素 | `{ clicked, element: {tag,text,bbox} }` |
| `mafw_desktop_type(selector, text)` | 2 | 向输入框填写文字 | `{ typed, value }` |
| `mafw_desktop_scroll(direction, amount?)` | 2 | 滚动页面 | `{ ok }` |

## 工作流程

### 标准检查流（最常用）

```
1. mafw_desktop_navigate({ tab: "目标页" })
   → 导航到目标标签页
2. mafw_desktop_get_ui_state()
   → 读取当前 DOM，确认关键元素存在、文本正确
3. mafw_desktop_screenshot({ selector: ".mafw-content" })
   → 截取证据，保存到 .mafw/screenshots/ss-xxx.png
4. 使用 Read 工具读取截图文件，进行视觉比对
5. 输出结构化检查报告
```

### 交互流（需要操作 UI 时）

```
1. navigate → get_ui_state（确认目标元素存在且可见）
2. click / type / scroll（执行操作）
3. get_ui_state（确认状态变化）
4. screenshot（保留前后对比证据）
5. 输出报告
```

### 恢复流（操作后还原状态）

```
1. get_ui_state → 记录操作前状态
2. 执行操作（click/type）
3. 截图 + 验证
4. 执行反向操作恢复原状态
5. 输出报告
```

## CSS 选择器最佳实践

优先使用以下选择器类型：
- 语义标签: `button`, `h2`, `input[type=text]`
- 指定 class: `.mafw-tab`, `.mafw-content`, `.mafw-rail`
- 层级组合: `.automations-panel button:first-child`, `.mafw-tab:nth-child(3)`
- 文本属性: `[aria-label="Automation"]`, `[title="Configuration"]`
- 文本内容: `button:has-text("Enable")`（如果框架支持）

避免：
- 自动生成的 hash class（如 `css-1abc2de`）
- ID 选择器 `#xxx`（可能动态变化）
- 过于复杂 > 4 层的嵌套选择器

## 标签页映射

| Tab 值 | 对应页面 | DOM 特征 |
|--------|----------|----------|
| `chat` | 对话页面 | `.mafw-chat`, `.mafw-session-turn-container` |
| `goals` | Goal 看板 | Dashboard KPI 卡片 + Goal 列表 |
| `memory` | 记忆搜索 | 搜索框 + 记忆单元列表 |
| `approvals` | 审批队列 | 待审批问题列表 |
| `triage` | 问题分类 | Triage 条目列表 |
| `automation` | 自动化规则 | 规则卡片（enable/disable 开关） |

## 输出报告格式

每次检查完成后，必须输出结构化报告：

```json
{
  "page": "automation",
  "checks": [
    { "type": "element_exists", "selector": "h2", "expected": "MAFW", "actual": "MAFW", "pass": true },
    { "type": "element_count", "selector": ".rule-card", "expected": 4, "actual": 4, "pass": true },
    { "type": "text_match", "selector": ".rule-card:first-child span.status", "expected": "ON", "actual": "ON", "pass": true },
    { "type": "screenshot", "filePath": ".mafw/screenshots/screenshot-xxx.png", "pass": true }
  ],
  "screenshots": [".mafw/screenshots/screenshot-xxx.png"],
  "verdict": "PASS",
  "issues": []
}
```

## 约束

- **不要连续快速截图**：每次截图间隔至少 500ms，等渲染完成
- **click 前必须 get_ui_state**：确认目标元素在当前视口内，且 boundingBox 有合理值
- **navigate 后等待 300ms**：等 SolidJS 响应式渲染完成再执行下一步
- **screenshot 返回的是文件路径**：需要用 Read 工具读取截图文件进行视觉验证
- **type 仅对 INPUT/TEXTAREA/contentEditable 生效**：对其他元素使用 type 会返回错误
- **scroll 对 .mafw-content 容器最有效**：这是主内容区的滚动容器
- **click 后必须 verify**：调用 get_ui_state 确认 click 产生了预期效果
- **所有操作有 10 秒超时**：如果 Desktop 无响应，调用会超时报错

## 典型场景

### 场景 1：验证自动化规则列表渲染正确

```
1. mafw_desktop_navigate({ tab: "automation" })
2. mafw_desktop_get_ui_state()
   → 检查 elements 中是否包含预期规则名
3. mafw_desktop_screenshot({ selector: ".mafw-content" })
   → 保存截图到 .mafw/screenshots/ss-xxx.png
4. [Read 工具] 读取截图文件
5. 输出报告（含 veredict）
```

### 场景 2：测试规则启用/禁用开关

```
1. navigate → get_ui_state → 记录切换前状态
2. click(".rule-card:first-child button.toggle")
3. get_ui_state → 验证状态翻转（ON→OFF 或 OFF→ON）
4. screenshot → 保留证据
5. click(".rule-card:first-child button.toggle")  ← 恢复原状态
6. 输出报告
```

### 场景 3：导航到多个页面，分别截图

```
1. navigate → screenshot ("chat")
2. navigate → screenshot ("memory")
3. navigate → screenshot ("automation")
4. 输出报告（含多页对比）
```

### 场景 4：填写搜索框并验证结果

```
1. navigate("memory")
2. get_ui_state() → 确认搜索框存在
3. type("input[type=search]", "memory decay")
4. 等待 500ms
5. get_ui_state() → 检查搜索结果是否出现
6. screenshot → 保留证据
7. 输出报告
```

## 自检清单

每次任务完成后必须回答：
- [ ] 是否 navigate 到了正确 tab？
- [ ] 是否 get_ui_state 确认了目标元素存在且可见？
- [ ] 是否有 screenshot 作为视觉证据？
- [ ] 输出报告是否 JSON 格式，含 veredict？
- [ ] 如果执行了 click/type，是否 verify 了状态变化？
- [ ] 截图文件路径是否正确（`.mafw/screenshots/`）？
- [ ] 如果修改了 UI 状态（toggle），是否恢复了原状态？
