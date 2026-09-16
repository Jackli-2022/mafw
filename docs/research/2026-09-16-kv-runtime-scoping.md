# kv_store runtime 归属调研（backend-scoped 状态的治理模式）

日期：2026-09-16
背景：pi runtime 下 manager 会话 500 事故（commit b0b0c043 修复单点）后，对 gateway.db kv_store 全量盘点与规范化调研。结论落地见 spec `docs/superpowers/specs/2026-09-16-kv-store-runtime-scoping-design.md`。

## 1. 内部证据（live DB 实测，2026-09-16）

| scope | 条数 | key → value | runtime 归属 | 问题 |
|---|---|---|---|---|
| internal-session | 5991 | sessionId → `{role, at}` | runtime-scoped（ses_* 4936 + pi_* 1055 混装） | 无限膨胀（95% 条目 14-30 天前）；唯一删除点 = btw 一次性问答 finally；缺 TTL |
| reflect-cursor | 74 | sessionId → mem_ids[] | runtime-scoped | 会话消失后成死数据，无生命周期清理 |
| manager-session | 6 | projectDir → `{sessionId, createdAt}` | runtime-scoped | 切换失效已修（b0b0c043） |
| registry | 1 | snapshot | durable | **孤儿**：仅 migrate 写入（gateway-db-migrate.ts:97），live 读写用 `registry/snapshot`/`default`（index.ts:5201/:5239），零读者 |
| registry/snapshot | 1 | default | durable | live 权威（权威真源仍是 scheduler/registered-projects.json） |
| milestone-notified | — | goalId:phase:stateVersion | durable | 无问题 |

补充事实：
- internal-session 是 `isHiddenSession` / SSE tiered policy 的权威数据源（internalSessionRoles 启动全量恢复进内存 Map）
- roles 分布：index-scan 5038 / reflect 602 / extract 343 / manager 8
- 既定规律（2026-09-08 事件复盘）：无人看管的后台计算必须有**明确属主、TTL 与 kill-switch**——internal-session 是缺 TTL 的系统性反例

## 2. 业界模式

### backend-scoped 生命周期派 —— LangGraph checkpointer
- 来源：docs.langchain.com/oss/python/langgraph/persistence
- thread 概念上属于具体 checkpointer backend（PostgresSaver/SqliteSaver 的 thread 互不可见）——**承认标识符 backend-scoped**，与 MAFW sessionID 跨 runtime 失效（"Pi session not found"）同构
- 官方 Troubleshooting 明列 "Checkpoints growing unboundedly"，官方建议 = **定期 prune / retention policy（cron 删 N 天前）**
- 启示：backend-scoped 标识符的治理答案是"失效 + TTL"，不是跨 backend 复用

### 并存隔离派 —— Temporal Namespace / Docker/kubectl context / Chrome profile
- Temporal（docs.temporal.io/namespaces）：Namespace 是隔离单元，Workflow ID 唯一性以 namespace 为界；**Retention Period 是 per-namespace 配置**
- kubectl/Docker context：per-context 完整配置 + current 指针，切回即恢复
- 适用前提：**切回是常见操作且数据有持续访问价值**（多租户并活、profile 数据长期可用）

## 3. 对 MAFW 的适用性判断

- MAFW runtime 切换的 runtime-scoped kv（manager 会话 = 当前话题、worker role = 只对可达会话有意义）**不满足"切回恢复有价值"前提**：重开成本≈0，旧会话仍在旧 runtime 存储里可从历史打开
- per-runtime 命名空间（scope 前缀 `pi:xxx`）收益场景不存在，成本真实（32 个 kv 调用点拼前缀 + 双份数据 + registry/milestone 等 durable scope 例外处理）→ **排除**
- 结论：runtime-scoped kv 走 **失效（切换时）+ TTL 卫生（启动时）**，与 b0b0c043 的 manager 修复同构；durable scope（registry/snapshot、milestone-notified）不动，仅对齐 registry 孤儿
