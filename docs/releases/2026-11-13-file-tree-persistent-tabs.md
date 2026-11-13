# 2026-11-13 · 文件树打开持久 tab

- **版本**：`v5.1.0`
- **Commit**：`8185b454`
- **范围**：左栏文件树点击 → 持久 tab；不改变 lens，不影响取景器 / Chat 的预览语义

## 根因

阅读意图走 `openPreviewFile`：只保留一个干净预览，下一次普通打开替换它。因此阅读态下连续点文件树，
tab 数始终是 1。修改意图走 `openFile`，tab 正常累积。

## 交付

- `content-intent.ts` 新增 `openModeForTab({ intent, persist })`：唯一判定点。
  - `persist` 或 `intent === "editing"` → 持久 tab；
  - 其余 → 预览 tab。
- `FocusOpenRequest` 增加 `persist?: boolean`；`requestFocusOpen` / `openFileInScope` 透传。
- `LeftDock` 的文件树 `onOpenFile` 传 `{ persist: true }`，所以阅读态也直接进持久 tab，且不切换 lens。
- `EditorDock.openRel` 支持 `{ persist }`；已存在的预览 tab 被文件树再次打开时会 `promotePreview`。
- 取景器与 Chat 文件链接不传 persist，仍保持原有预览替换语义。

## 验证

- 实机复现（dev app + CDP 9222，阅读 lens）：
  - 文件树依次点 `AGENTS.md` / `CONTEXT.md` / `config.json` → **3 个持久 tab**，`preview: false`；
  - 取景器打开 `package.json` → 第 4 个 tab，`preview: true`（预览语义保留）。
- desktop 全量：**3579 / 3579**（697 suites）
- 本轮新增测试：**2**
  - `content-intent.test.ts`：`openModeForTab` 的 persist 分支
  - `file-tree-persistent-tabs.test.ts`：LeftDock / FocusOpenRequest / EditorDock 接线
- 同步更新 `content-intent-wiring.test.ts` 的旧 ternary 断言。
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 边界

- 阅读 lens 下 tab 现在可以累积；预览 tab 仍只用于取景器 / Chat 快速打开。
- 没有新增「固定 / pin」按钮；需要保留取景器预览时，仍通过修改 lens 或文件树再次打开来 promote。
