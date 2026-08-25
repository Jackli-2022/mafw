# 记忆系统 Token 统计 — 收尾计划

> 日期：2026-08-25 | 状态：主体实现已在工作区（未提交），本计划覆盖缺口收尾

## 背景

UsageDock 底部「系统总计」替换为「记忆系统」token 用量。调查确认主体已实现（8 文件未提交改动）：

| 组件 | 状态 |
|---|---|
| `worker_role` 列 + migration | ✅ gateway-db.ts |
| collector 打标（setRoleFor） | ✅ collector.ts |
| getMemoryTokenSummary() 聚合 | ✅ trajectory-store.ts |
| registerInternalSession + kv 持久化 | ✅ index.ts |
| /api/usage 返回 memory 字段 | ✅ index.ts |
| UsageDock 记忆系统 section + CSS | ✅ UsageDock.tsx / mafw.css |
| **启动时角色恢复** | ❌ 缺失 |
| **测试** | ❌ 缺失 |
| **构建/部署/提交** | ❌ 未做 |

## 角色定义

- `memory-worker`：SessionWorkerPool（turn-compress / reflection 共用池）
- `index-scan`：IndexScanService 的 MemoryWorker
- `manager`：Manager Agent 会话

## 任务

### Task 1: 启动时恢复 internalSessionRoles
- 问题：kvSet('internal-session', sid, {role}) 只写不读；gateway 重启后 Map 为空，已存活 worker 会话（pool TTL 内复用）token 落库无角色 → memory 统计漏数
- 方案：GatewayDatabase 加 `kvList(scope): Array<{key, value}>`；index.ts 在 trajectoryCollector 创建后、事件订阅前恢复：`kvList('internal-session')` → 灌回 `internalSessionRoles`
- 位置：initServices 尾部或 recoverRegistry 附近

### Task 2: 测试
- `tests/unit/gateway/trajectory-store-memory.test.ts`：
  - getMemoryTokenSummary 空表 → turnCount 0
  - 有角色 turn 聚合总量 + byRole 分组正确
  - 无角色 turn（用户会话）不计入
  - 同角色多会话 sessionCount 去重
- 用真实 GatewayDatabase（tmp 文件）+ TrajectoryStore，不 mock

### Task 3: 构建 + 部署 + 验证
- gateway build → 部署 → 重启
- 触发一次 turn-compress（或手动调 worker）→ `curl /api/usage` 验证 memory.turnCount > 0 且 byRole 有值
- 重启 gateway → 再触发 → 验证角色恢复后统计连续（Task 1 的回归验证）
- desktop build（UsageDock 改动需验证编译）

### Task 4: 提交
- commit message: `feat(usage): memory-system token tracking replaces global total in UsageDock`

## 注意

- 历史数据无 worker_role，只统计部署后新数据（ acceptable，不写回填脚本）
- UsageDock 轮询 15s 已存在，无需改
- CSS 类 `mafw-usage-memory-*` 已在 mafw.css，desktop build 时顺带验证
