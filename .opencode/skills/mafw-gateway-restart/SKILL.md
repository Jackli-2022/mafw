---
name: mafw-gateway-restart
description: 当需要重启或自更新 MAFW Gateway 时使用。覆盖完整流程：判断是否需要重启、修改代码、构建门禁、写重启令牌、goal state 续跑标记、等待更新完成通知。触发词：重启 gateway / 更新 gateway / 让改动生效 / self-update。
---

# MAFW Gateway 重启 / 自更新 Skill

## 第一步：判断是否需要重启

| 改动对象 | 是否需要重启 |
|---|---|
| `.mafw/config.yaml`（搜索/记忆/成本参数等） | ❌ 热生效（gateway watch config 文件，~300ms 内自动 reload；server/paths 段会提示"需重启"） |
| `.mafw/automations/*.json` | ❌ 热生效（规则自动 reload） |
| `gateway/src/**`、`gateway/package.json` | ✅ **必须走本 Skill 的重启流程** |
| `.mafw/constraints.json` 等运行期读取文件 | ❌ 每次请求读取 |

只有"gateway 代码/依赖"改动才需要重启。改配置类文件直接写即可，**不要**为此重启。

## 流程（七步）

### ① 修改代码
改动面限定：`gateway/src/**`、`gateway/package.json`。所有文件写入/命令执行都会走 MAFW 审批（PermissionCard），无需额外申请。

> **注意**：manager agent 的 `edit`/`write`/`apply_patch` 工具已被权限配置禁用（与 plan 对齐）。**本流程的全部文件操作（改码、写令牌）必须用 bash 命令执行**（bash 默认允许）。gateway 的 MCP 工具（`mafw_*`）不受影响，可正常使用。

### ② 构建（必须通过）
```powershell
cd gateway; npm run build
```
- 构建失败 → 修复后重试，**禁止**继续后续步骤（旧 gateway 继续运行不受影响）
- 建议先 `git add -A; git commit -m "..."` 留下回滚点（回滚：`git reset --hard <commit>`）

### ③ 写重启令牌（原子写，先 .tmp 再 rename）
```powershell
$token = @{
  target = "gateway"
  action = "update"
  reason = "<简要说明>"
  requestedAt = (Get-Date).ToString("o")
  delayMs = 5000
  commit = (git rev-parse --short HEAD 2>$null)
} | ConvertTo-Json
$dst = "$env:USERPROFILE\.mafw\pending-restart.json"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.mafw" | Out-Null
Set-Content -Path "$dst.tmp" -Value $token -Encoding UTF8
Rename-Item "$dst.tmp" $dst -Force
```
- `action` 必须是 `update`（gateway 自行 build）或 `restart`（已手动 build，仅重启）
- `delayMs` 默认 5000：给 agent 时间把回复发给用户，重启发生在回复送达后
- gateway 每 2s 轮询该文件；发现后先删除（防循环），按 delayMs 延迟后自举重启

### ④ goal state 写续跑标记
```powershell
# 用 mafw_update_state 工具或直接更新 state/{goalId}.json 的 nextAction，
# 让重启后恢复的 agent 知道下一步做什么
```

### ⑤ 回复用户
"已修改 X 并请求重启 gateway，约 5 秒后生效，完成后我会在本会话继续。"

### ⑥ 等待更新完成通知
重启完成后，新 gateway 会向**本会话**注入一条 `[MAFW SYSTEM] Gateway 自更新已完成...` 消息（触发新一轮 turn）：
- 收到通知 → 读 goal state → 继续执行 `nextAction`
- **兜底**：若 60 秒内未收到通知，检查 `$env:USERPROFILE\.mafw\last-restart.json`：
  - `notified: true` → 更新已完成，正常继续
  - `notifyFailed: true` / 文件不存在 → 手动确认 gateway 健康（`Invoke-WebRequest http://127.0.0.1:3000/health`）后继续

### ⑦ 继续执行
读 goal state，执行 `nextAction`，向用户汇报结果。

## 等价路径
- 用户/其他会话也可执行 `mafw update`（CLI 写同一令牌；无会话上下文，通知走 manager 会话兜底）

## 错误排查

| 现象 | 处理 |
|---|---|
| build 失败 | 修复代码重新 build；gateway 不受影响继续运行 |
| 写令牌后无反应（>10s） | 检查 `$env:USERPROFILE\.mafw\pending-restart.json` 是否还在（gateway 未删=未处理）；`mafw status` 确认 gateway 在跑；令牌内容是否正确（target/action） |
| 重启后起不来 | gateway 会先 spawn 新进程并确认存活才退出旧进程；新进程 2s 内崩溃则旧进程取消重启继续服务。检查 `~/.mafw/logs/mafw.log` 的 `[SelfUpdate]`/`[Scheduler]` 日志 |
| 令牌是坏 JSON | gateway 连续 5 次解析失败后删除并记录错误（不重启） |
| 通知没收到 | 按第⑥步兜底检查 last-restart.json；gateway 健康检查 |

## 非目标
- 不修改 `package.json` version（版本记录用 commit+时间戳，见 last-restart.json）
- dev 模式（ts-node）下自举以 dist 产物为准；开发调试请手动重启
- 不支持 git 远端拉取（当前无 remote）
