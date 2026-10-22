# 后台任务 UI 放置方式：六方调研（2026-10-22）

> 背景：P0-3 后台任务体系的形态决策调研。结论服务于 `docs/superpowers/specs/` 后续 spec。
> 来源：各家官方文档/changelog + opencode v2.1.0 源码（tag `60c68d14`）+ Codex issue 区实证。

## 放置对照表

| 产品 | 存在感层（不点可见） | 详情层（点了展开） | 完成提醒 |
|---|---|---|---|
| **Kimi Code Desktop**（聊天形态，最近似 MAFW） | **work bar：Composer 正上方**，计数+状态；可展开列表（recent/running/completed/all 过滤、看输出、停止） | 右面板 Agent/Subagent tab（后台 agent 详情开右面板 tab） | 本地通知事件 + 平台通知（窗口隐藏时） |
| **opencode 官方 v2.1.0**（源码实证） | TUI：**composer 区 tab 条**（`composer/subagents-tab.tsx` / `shell-tab.tsx`）；app：时间线内联 `BackgroundMoveHint`（Ctrl+B 提示） | tab 展开看输出/跳子会话 | synthetic 消息注回父会话（模型自唤醒） |
| **Claude Code**（TUI） | 无常驻条；Ctrl+B 后台化、超时自动转后台 | `/tasks` 按需视图（running shells + subagents） | 终端铃铛/桌面通知（#11716 洪泛教训 → 节流必修） |
| **Cursor 2/3**（IDE 形态） | **Agents 专用侧边栏**（本地+云 agent 统一列表） | 侧栏选中进主面板 | 侧栏未读徽标 |
| **Codex desktop**（ChatGPT 桌面应用） | **左侧栏 Agents 区**（running/recent agent runs + live status dots）+ **底部 status bar** 背景活动指示 + Scheduled 收件箱（未完成徽标） | 线程内 review | 回合完成通知（可配置时机）+ Scheduled 未读 |

## 关键观察

1. **聊天形态产品收敛于「composer 上方 work bar + 右面板详情」双层**（Kimi/opencode）；IDE 形态用专用侧栏（Cursor）；Codex desktop 是「左侧栏活跃区 + status bar」路线。
2. **Codex 没有 composer work bar**：存在感靠侧栏 Agents 区的 live dots + status bar；且社区有 issue（openai/codex#33730）抱怨活跃任务混在项目层级里难找、要求常驻「Active tasks」区——说明侧栏路线在任务多时存在感仍不足。
3. **详情层共识是侧面板/dock**：Kimi 右面板 tab、opencode TUI tab、Cursor 侧栏→主面板、Codex 线程内。MAFW 的 RightDock（P0-1 子代理 tab 已在其中）天然对应。
4. **完成提醒共识**：toast/平台通知 + （可选）模型唤醒；节流是必修（Claude #11716）。
5. opencode v2.1.0 runtime 能力面：`shell`/`subagent` 工具均有 `background` 参数（后台默认无超时）；REST `GET /api/shell`、`/api/shell/:id/output`、`DELETE /api/shell/:id`；完成经 synthetic 消息注回父会话（`metadata.source: "shell"|"subagent"` + shellID/childID/jobID）；前台转后台 = `jobs.backgroundAll`（Ctrl+B）。

## 对 MAFW 的形态候选

- A. 只做 RightDock「后台」tab —— 存在感弱，业界无聊天产品这么做
- B. 只做 composer work bar —— 详情层要从零做浮层
- C. **work bar + RightDock 详情（Kimi 双层）** —— 存在感+详情各司其职，与 P0-1 子代理面板天然拼合
- D. Codex 式：Rail「活跃任务」区/徽标 + status bar —— 存在感居中，但 MAFW Rail 是按会话组织的，跨会话聚合要新抽象
