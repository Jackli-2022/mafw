# 2026-11-19 · 记忆回执收成 turn 的安静收尾线

- **版本**：`v5.1.0`（桌面交互变更，不升版本号）
- **提交**：`937f929dc` + `021ec6f92` + `ea486ee3c`
- **范围**：desktop renderer 回合 footer 的记忆回执 + session-ui 文本 part 的 turn footer 槽 +
  picker 弹层的 `below-start` 锚点；gateway / runtime 契约零改动
- **依据**：真实 `memory_receipts` 数据 + dev app live 验证

## 问题

- 28px 药丸 + 边框 + 独立圆底图标，和 turn 的正文/元信息脱节。
- 答案正文到药丸实测约 **60px**：回执挂在 `SessionTurn` 的 children 槽，排在
  process timeline 和 `Lead · deepseek-flash · 2s` 之后，读起来像贴在 turn 外面的通知。
- 药丸写「想起了 3 件事」，卡片头却写「7 条」——把 4 条邻居也算进了卡片。
- 卡片里是类型标签（事实/做法/往事）、`pinned / 相关` 元数据、440px 宽 7 行长文，
  像调试面板，不像人能读的回忆。

## 现状

- **收尾线**：最后一个 assistant 文本 part 内、copy/meta 动作行之前渲染
  `小脑 + 想起 N 件旧事 ›`，11.5px `text-3`，无边框、无底色、无竖线；
  容器 `margin: 10px 0 0`，答案正文到触发线实测约 **16px**，meta 行在触发线下方 6px。
  `SessionTurn.renderTurnFooter` → `TextPartDisplay.turnFooter`，由 `turnFooterPartID`
  保证一轮只出现一次。
- **hover 卡片** → **click 浮层**：点击收尾线打开 320px 浮层（`PopoverShell`，`below-start`），
  左边缘与答案对齐、浮在下方，不压住答案本身；点外部 / Esc 关闭，再点收尾线收起。
  浮层只列 3 条主记忆；每条在首个自然标点（`：。；，` / `: . ; ,`）处切成
  「标题 + 一行上下文」，长句用省略号收尾，不凭空生成摘要。浮层不改变 turn 布局。
- **邻居**：4 条邻居不再进主列表，折进「还有 4 条顺带想起」，点开才展开。
- **计数一致**：pill / 卡片头 / 行数都只算 primary（主记忆），不再出现 3 对 7。
- **轻量元数据**：移除事实/做法类型标签与 `pinned / 相关`；只保留相对时间，置信度文案
  并入卡片头右侧。T1 原话作为次级区块保留。
- 历史回填未改：`session.memoryReceipts` 仍按 `turnKey` 挂回同一轮；重启后回填已验证。

## 验证

- 新增 **6** 条单测：`splitMemoryText` 3 条（中文标点、短文本、长无标点裁切）+
  primary/neighbor 计数一致性 1 条 + turn footer 槽（`renderTurnFooter` /
  `turnFooterPartID`）1 条 + popover `below-start` 对齐 1 条；`typeLabel` 随类型标签一起退役。
- desktop 全量：**4190 pass / 0 fail**（基线 4184）。
- `tsgo --noEmit -p tsconfig.json`：通过；session-ui `tsgo --noEmit`：通过。
- `electron-vite build`：通过（48.3s）。
- live：Lead 会话 3 条回执全部渲染为「想起 3 件旧事」；触发行高 20px、答案正文到触发线
  16px、meta 行在触发线下方 6px；点击浮层 320px、左边缘 x=276 与答案对齐，
  3 条主记忆 +「还有 4 条顺带想起」；点外部 / Esc 关闭。
