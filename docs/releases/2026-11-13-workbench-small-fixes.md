# 2026-11-13 · Workbench 小修（browser tab menu / left dock refresh / ChatPane TDZ）

- **版本**：`v5.1.0`
- **Commit**：`5d8fe189`
- **范围**：Plan 5 尾巴、DocumentFrame 实机冒烟暴露的小缺口；E6 / 统一 document model 不在本轮

## 交付

- **ChatPane `allTurns` TDZ**：`episodeGroups` 改用 `userMessages()`，`navTurns`
  下移到 `allTurns` 之后。修复 `navTurns → isTurnHidden → episodeGroups → allTurns`
  的 const TDZ；dev app 刷新后不再整页渲染出错。
- **删除死通道 `editor-open`**：`FilesDock → MafwShell → EditorDock` 的旧跨组件
  signal 已无调用方；文件打开统一走焦点栈 `openRequest`。`EditorDock` 的旧消费
  effect 与 `MafwShell` 的未使用 import 一并删除。
- **浏览器 tab 右键菜单**：`DocumentTabs` 的 `onContextMenu` 现在按被点击的 tab
  构建菜单，支持关闭 / 关闭其他 / 关闭右侧 / 复制链接 / 系统浏览器打开；空 URL
  与单 tab 的不可用项显式禁用。
- **左 dock 文件面手动刷新**：`FilesDock` 增加 `refreshNonce`；左 dock 头部在
  `files` face 显示刷新按钮，保留树展开态，只重列根与已展开目录。
- **文档**：`docs/architecture/desktop.md` 的 DocumentFrame 段补充 per-tab menu 与
  左 dock 刷新。

## 验证

| 门 | 结果 |
|---|---|
| desktop full `npm run test:desktop` | **3592 / 3592**（699 suites） |
| desktop `tsgo --noEmit -p tsconfig.json` | rc=0 |
| `electron-vite build` | rc=0 |
| 本轮新增/更新测试 | `workbench-review-fixes`（editor-open + TDZ 守卫）、`browser-tabs` +2、`browser` builder +2、`browser-tabs-wiring` +1、`left-dock-files-wiring` +1 |

### 实机 smoke（dev app + CDP 9222）

- 左 dock：`files` face 显示文件树与刷新按钮；文件行可读。
- 右 dock：`DocumentFrame` tabs / toolbar 正常；打开 `docs/architecture/gateway.md`
  显示 tab 与「源码」toolbar。
- 浏览器：地址栏打开 `https://example.com` 后 tab 出现；单 tab 右键菜单正确禁用
  「关闭其他 / 关闭右侧」；新建第二个 tab 后两项启用。
- 无 Vite error overlay；ChatPane TDZ 修复后整页正常渲染。

## 边界

- 编辑器与浏览器仍是两个独立 stage；跨类型混合 document model 未做。
- 浏览器 tab 菜单只做 close / close-others / close-right / copy / external，未做
  duplicate / pin。
- E6 desktop replay 由另一路负责，本轮未触碰。
