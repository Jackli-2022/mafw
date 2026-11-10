# 2026-11-10 · Lead / Tech Lead P1：工作集与缺页

- **分支**：`feat/gateway-kernel-d1-batch2`
- **提交范围**：`af1d93ed..f051dedc`（P1 任务链 + review fix，plan
  `docs/superpowers/plans/2026-11-10-lead-techlead-p1-working-set.md`）
- **合入 main**：`6cddcbf1`
- **当前工作分支**：`feat/lead-techlead-p2`
- **Spec**：`docs/superpowers/specs/2026-11-10-lead-techlead-p1-working-set-design.md`
- **前置**：P0 / P0.5（`docs/releases/2026-11-10-lead-techlead-p0.md`）

## 交付内容

- **数据**：`lead_topic` 扩展 summary/state/token/resumed_from（旧库 ensureColumn 迁移）；
  `topic_message_index` 保存换出消息的可检索副本，`replaceTopic` 单事务重建。
- **工作集**：`selectWorkingSet` + `estimateTopicTokens`（resident/warm/cold/pinned，预算裁剪）。
- **摘要/压缩**：`summarizeTopic` / `compactTopic` 确定性保留 decisions / open loops / 用户原话，
  工具输出截断；`POST /api/lead/compact` 只写 summary/state/index，不删 transcript，广播
  `lead.compaction`。
- **召回**：`recallTopics` token 打分（title 0.6 / summary 0.3 / index 0.1，阈值 0.2，最多 2 个）；
  `buildRecalledBlock` 输出带 topic 标签的 `<recalled-topic>`。
- **上下文**：`GET /api/lead/context` 按 goal-status → topic-index → recalled 组装；宿主插件
  `leadWorkingSetHook` 100ms 预算注入，fail-open。
- **恢复**：`LeadTopicResumeService`（alive 原地切回；dead 新 session + `<resumed-topic>` +
  `resumed_from` 新行，旧 transcript 只读；同 topic 串行）。
- **API / UI**：topics list/get/resume、working-set、recall、context、compact；SDK/preload
  `lead.*`；桌面 Lead「话题」面板（状态/摘要/恢复，无 session id）。
- **开关**：`MAFW_LEAD_WORKING_SET=0` 回退 P0（context 空、compact 503；list/get/resume 仍可用）。

## 门禁

- gateway **5661/5661**（726 suites）
- desktop **3195/3195**（680 suites）
- SDK **203/203**
- root plugin tests **110/110**
- gateway `tsc` rc=0；desktop `tsgo` rc=0；`electron-vite build` rc=0
- 契约：`emit:openapi` 285 routes / 256 paths；`api-contract` / `legacy-route-inventory` 绿

## 暂缓

- 自动压缩触发（context ≥70% / 回合 ≥40）与旧 `lead_topic` 行的后台摘要回填：P1 只在 handoff 时
  生成摘要，并提供显式 `POST /api/lead/compact`；阈值触发留 P2 调度器。
- LongMemEval / 自建多话题评测未执行。
- 召回仍是 token 命中（不引入 embedding rerank）。
- P2（attention scheduler / COW fork）、P2.4（事件层）、P2.5（Standing Goals）未开工。
