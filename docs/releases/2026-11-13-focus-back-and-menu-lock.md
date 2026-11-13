# 2026-11-13 · 焦点返回 / 右键菜单点击锁修复

- **版本**：`v5.1.0`
- **Commit**：`4c74d2e1`（返回文案）、`9302a0c8`（交互镜）、`c6d35ce6`（非 modal 菜单）、
  `b95aad05`（焦点栈去重）
- **范围**：工作台焦点返回与文档 tab 右键菜单；不改文档状态模型

## 问题

1. **返回上一焦点看起来没反应**：文档 tab 点击走 `openSubject`，每次都 push 一条新 focus。
   点 `file → web → file` 后栈里是 `[world, file, web, file]`；返回会先经过重复的 file，
   用户感觉“再点一次还在 file”，而不是回到 world。
2. **所有按钮都点不动**：文档 tab 右键菜单走 Kobalte 默认 modal 菜单，打开时给 `body`
   加 `pointer-events: none`；关闭不干净时整个应用无法点击。
3. **文案混淆**：左上角「返回」与浏览器 toolbar「后退」图标相同；web 的 `interact` 镜叫「操作」，
   容易被当成动作按钮。

## 修复

- 新增 `selectFocus(state, scope, subject, lens)`：选择已存在的 subject 时，把它从栈中移除后
  追加到栈顶，不产生重复；`focusDocumentTab` 改用它。
  - `file → web → file` 的栈变为 `[world, web, file]`；返回依次是 web、world。
  - 新 subject 仍追加；当前栈顶相同则 no-op。
- `MenuHost` 的 `DropdownMenu` 设置 `modal={false}`：右键菜单不再锁 `body`、不 trap focus；
  菜单项、Escape、外部点击关闭都保持可用。
- 文案：
  - frame bar：`返回` → `返回上一焦点`
  - browser toolbar：`后退` → tooltip `后退（页面历史）`，前进同理
  - LensBar：`操作` → `交互`

## 测试

- desktop 全量：**3765 / 3765**（727 suites）
- 本轮新增测试：**4**
  - `focus-model.test.ts`：2（已有 subject 移到栈顶 / 新 subject 追加 + 栈顶 no-op）
  - `context-menu-modal.test.ts`：1（`modal={false}`）
  - `document-stage-wiring.test.ts`：1（返回/页面后退文案区分）
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 实机确认

fresh built app（CDP 9224）：

- `file → web → file` 后连续点「返回上一焦点」：
  - 第 1 次：web（浏览器 toolbar / 镜 `交互`）
  - 第 2 次：world（frame `世界总览`，镜 `总览`，document wrapper `display: none`，
    `.mafw-project-work` 渲染）
  - 第 3 次：landing / 取景器
- 文档 tab 右键菜单打开时 `body` 仍为 `pointer-events: auto`；Escape / 外部点击关闭后
  返回、镜按钮均可点击。
- 无 error overlay。

## 边界

- `返回上一焦点` 只走焦点栈，不关闭 tab、不改浏览器页面历史。
- `交互` 镜是 web / terminal / plugin 的视图模式；点击当前已选中的镜是 no-op，不是动作按钮。
- E6 未触碰。
