# 后台任务 wire 实证（Task 0）

> 日期：2026-10-22 · 环境：opencode v2.1.0（本机 `C:\home\ubuntu\.npm-global\node_modules\@opencode\cli`，serve 4096）+ MAFW gateway :3000
> 结论：**API 形状全部钉死；gateway 反代存在鉴权缺口 → 触发计划 Task 0 的 Go/No-Go 门禁**

## 1. 环境状态与探针方法

- MAFW gateway 的 sidecar（4096）初始未运行（`/health.serveRunning=false`，反代 502）；`POST /api/runtime/restart-agent` 返回 500 且无 spawn 日志（respawn 路径静默失败——**超本计划范围，未修**）。
- 手动拉起 `opencode serve --hostname=127.0.0.1 --port=4096` 后（pid 38344，日志 `server listening on http://127.0.0.1:4096` + `server password <pwd>`），完成全部探针。
- 鉴权：v2 serve 要求 `Basic base64(opencode:<password>)`；MAFW gateway 从 env `MAFW_RUNTIME_PASSWORD` / `MAFW_OPENCODE_PASSWORD` 取密码（`gateway/src/index.ts:543-546`），**当前环境两个 env 均未设置**（进程/User/Machine 皆无）。

## 2. `/api/shell` 系列（直连 4096，带 Basic auth）——已钉死

所有响应统一 **`{location:{directory}, data}` 信封**（与官方 app 的 `Shell.Info` 对齐）：

```jsonc
// GET /api/shell  → 200
{"location":{"directory":"C:\\work\\work-loop\\opencode-plugin-mafw"},"data":[]}

// POST /api/shell {"command":"ping 127.0.0.1 -n 3"} → 200
{"location":{...},"data":{
  "id":"sh_16193f82b001ryD0f6TU0pVTRw","status":"running","command":"ping 127.0.0.1 -n 3",
  "cwd":"...","shell":"...powershell.EXE","file":"C:\\Users\\...\\shell\\<hash>\\sh_...out",
  "pid":2544,"metadata":{},"time":{"started":1792638449707}
}}
// 注意：POST /api/shell 直建时 metadata 为空；shell 工具路径由工具写入 metadata:{sessionID}

// GET /api/shell/:id（exited 后）→ 200
{"location":{...},"data":{ ...同上, "status":"exited","exit":0,"time":{"started":...,"completed":1792638451895} }}

// GET /api/shell/:id/output → 200
{"location":{...},"data":{"output":"<组合 stdout+stderr 文本>"}}

// DELETE /api/shell/:id → 204；再 GET → 404（空 body）
```

**对账含义**：`status ∈ {"running","exited"}`；退出码键 `exit:number`；运行中列表只含 running（`GET /api/shell` 空数组 = 无运行中）；404 = 已被删除/不存在。

## 3. `POST /api/session/:id/background`——路由存在

- 直连 404（空 body）= session-not-found（路由可达）；经反代同样 404。**端点存在性确认**，无 auth 时 401（反代缺口同下）。

## 4. gateway 反代缺口（Task 0 门禁触发点）

- 反代实现（`gateway/src/index.ts:6511-6535`）**透传 client headers、不注入鉴权**。
- 实测：`GET /api/shell` 经 :3000 → **401**；**同一请求手工带 `Authorization: Basic ...` 经 :3000 → 200**（反代链路本身是通的，唯一缺的是服务端注入密码）。
- 因此「零 gateway 改动」假设在本环境**不成立**：desktop 不知道 serve 密码，REST 面（对账/终止/转后台）经反代不可达。
- 修复需在 gateway 侧注入 Basic 头，但**密码来源缺失**（env 未设）；正确修法是 v2 集成工作（spawn 时解析 v2 输出行 `server password <pwd>` + `server listening on <url>`——现有 sidecar 只认 v1 的 `opencode server listening on`，ready 检测在 v2.1.0 上也不会触发）。此项与用户并行中的 v2 兼容/adapters 工作重叠，**本计划不实施**。

## 5. synthetic 完成消息 / part 元数据（未 live 探测，源码钉扎）

- 守 P0-1 边界（不向在线 gateway 注入测试会话/LLM 回合），`part.updated` 后台元数据与 synthetic 消息形状以 v2.1.0 源码为据（`tool/plugin/shell.ts`、`schema/src/session-message.ts`），检测器写宽容判定兜底（spec §4.2）。
- Task 2 测试以源码形状 + 宽容变体双向钉扎。

## 6. 决策含义（交用户）

- **A（推荐）**：核心（work bar / 列表 / 通知 / 跳转 / blocking 检测）纯 SSE+messages，今天即可用；REST 三件（对账/终止/转后台）做成**可选能力**：经反代调用，401/不可达 → 静默降级（隐藏终止与转后台按钮、跳过轮询）。v2 鉴权桥在用户并行工作落地后自动点亮，无需二次改动。
- **B**：本计划内补 gateway 鉴权桥（反代注入 + sidecar 解析 v2 密码行）——越界到 v2 集成工作，不推荐。
- **C**：暂停 P0-3 等 v2 集成就绪。
