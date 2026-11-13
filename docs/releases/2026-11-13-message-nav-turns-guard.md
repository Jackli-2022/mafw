# 2026-11-13 · MessageNav `turns` 边界归一化

- **版本**：`v5.1.0`
- **Commit**：`93cd6484`
- **范围**：Chat 右侧用户回合导航

## 根因

`MessageNav` 直接读 `props.turns().length`。会话 tab 增多、快速切换时，`ChatPane` 的 keyed
remount 可能让 `turns()` 短暂为 `undefined`，于是整页触发：

```text
TypeError: Cannot read properties of undefined (reading 'length')
    at get when (MessageNav.tsx:48:27)
```

## 交付

- 新增 `message-nav-model.ts` 的 `normalizeMessageNavTurns`：非数组 / `null` / 畸形条目统一归一化，
  合法条目保留 `id` 与文本（缺失文本 → 空串）。
- `MessageNav` 用 `createMemo` 包装归一化结果，`recompute` / `Show` / `For` 全部读归一化后的数组，
  不再直接读 `props.turns().length`。
- 上游 `navTurns` 的瞬时 `undefined` 不再导致整页渲染错误；有消息的会话仍正常显示导航节点。

## 验证

- 实机（dev app + CDP 9222）：28 个 session tab 下切换 `LeadL` / `当前记忆系统架构` /
  `Pod 与右侧工作台割裂`，导航节点分别为 16 / 6 / 5，无异常；关闭 12 个测试 session tab
  也无异常。
- desktop 全量：**3591 / 3591**（699 suites）
- 本轮新增测试：**3**
  - `message-nav-model.test.ts`：2（空值 / 畸形条目）
  - `message-nav-wiring.test.ts`：1（不再直接读 `props.turns().length`）
- `tsgo --noEmit` / `electron-vite build`：rc=0

## 后续发现：ChatPane `allTurns` TDZ

刷新 dev app 后出现第二个错误：

```text
ReferenceError: Cannot access 'allTurns' before initialization
    at episodeGroups → episodeForMessage → isTurnHidden → navTurns
```

原因：`navTurns` 是 `createMemo`，创建时立即求值；它调用 `isTurnHidden` →
`episodeGroups` → `allTurns`，而 `allTurns` 的 `const` 定义在更后面，触发 TDZ。

工作区已修（**未提交**，与另一路 ChatPane 改动混在一起）：

- `episodeGroups` 直接读 `userMessages()`，不再依赖后置的 `allTurns`；
- `navTurns` 下移到 `allTurns` 之后定义，并注明原因。

刷新后 28 个 session tab 下切换 `LeadL` / `当前记忆系统架构` 等无异常；导航节点正常显示。

## 边界

- `MessageNav` 的归一化是本提交的防御层：上游瞬时 `undefined` 不再炸整页。
- ChatPane TDZ 属于同一错误链的第二个原因，修复目前只在工作区，未纳入 `93cd6484`；等那路
  ChatPane 改动收口时一起提交。
- 导航节点的排序、scroll 高亮和点击跳转语义未变。
