# 2026-11-13 · DocumentTabs 滚轮横向滚动

- **版本**：`v5.1.0`
- **Commit**：`ebdac995`
- **范围**：右 dock 文件 / 浏览器 tab 条

## 交付

- `DocumentTabs` 增加 `wheel` 处理：鼠标纵向滚轮映射为 tab 条左右滚动；触控板横向手势优先用
  `deltaX`。
- `deltaMode` 兼容：像素 / 行（×16）/ 页（×clientWidth）。
- 只有 tab 条实际溢出（`scrollWidth > clientWidth`）时才 `preventDefault`，不阻断外层滚动。
- 纯函数 `tabStripWheelDelta` 收口换算，组件只负责 `scrollLeft += delta`。

## 验证

- 实机（dev app + CDP 9222）：tab 条 `clientWidth 961 / scrollWidth 1304`；派发 `deltaY: 220` 后
  `scrollLeft 0 → 220`，`defaultPrevented: true`。
- desktop 全量：**3591 / 3591**（699 suites）
- 本轮新增测试：**2**（`tabStripWheelDelta` 换算 + DocumentTabs 接线）
- `tsgo --noEmit` / `electron-vite build`：rc=0

## 边界

- 滚轮只滚动 tab 条，不改变活动 tab；点击 / 中键关闭 / 键盘上下文菜单保持原行为。
- 没有新增可见滚动条；溢出时仍可用滚轮或拖拽触控板横向浏览。
