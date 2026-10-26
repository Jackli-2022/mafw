# Batch 7 — Session Config Options + config event（Design）

> 日期：2026-10-26 · 状态：已实施（v4.35.0）
> 上游：Tier 1 #9（会话配置选项 sticky 切换 + config 事件族；ACP config_option 四分类语义）。

## 1. 意图

MAFW 已有离散动词：`/api/sessions/:id/agent`、`/model`、`/permission-mode`，以及 Batch 6 的 prompt `thinkingLevel`/`variant`。但缺少统一的会话配置读取/设置面与主动变更事件，客户端无法一次拿到完整联动状态，也无法订阅“配置已变”。

本批新增 `GET/POST /api/session/:id/config` + canonical `session.config` 事件：
- 一次返回 mode/agent/model/variant/thinkingLevel；
- 设置后返回完整状态并广播；
- 复用现有 runtime switch/policy 动作，不复制持久化；配置副作用由 gateway kv 记录（agent/model/variant/thinkingLevel），mode 仍由 permission policy 持久化。

## 2. 分类

| category | value | 行为 |
|---|---|---|
| `mode` | `read-only`/`auto`/`full-access`（`manual` 兼容） | `ApprovalPolicyService.setMode`；同时有既有 `permission_mode` 事件 |
| `agent` | string | runtime `session.switchAgent`；无实现 503 |
| `model` | `{providerID, modelID, variant?}` | runtime `session.switchModel`；无实现 503 |
| `model_config` | `{variant}` | 用当前 model 调 `switchModel`；无当前 model 400 |
| `thought_level` | ThinkingLevel | runtime `session.setThinkingLevel`（Pi）；opencode 返回 400，提示用 `model_config.variant` |

`session.config` 载荷：
```ts
{ type:'session.config', sessionID, properties:{ sessionID, config:{mode,agent?,model?,variant?,thinkingLevel?}, category } }
```
经 `mafwBroadcast` 顶层广播；SDK union、矩阵、desktop/TUI 词汇守卫同步。

## 3. 非目标

- 不做 desktop/TUI 配置 UI（API/事件先行）。
- 不把 opencode thinkingLevel 映射为 variant；由调用方选 `model_config.variant`。
- 不实现 ACP 的 model_config 任意键；只支持 variant。
- 不改现有 `/agent` `/model` `/permission-mode` 路由；新 config 是统一 façade。

## 4. 验收

1. 服务单测：get 合并 runtime + stored；set 五类、校验、事件。
2. 路由单测；SDK config get/set；api-contract/wave1。
3. 全量 gateway/desktop/SDK/session-ui/TUI + 根 build。
4. 真机：GET config 返回 200；mode/agent/model/model_config 写入；opencode thought_level 400；`session.config` SSE 到达；部署 v4.35.0。
