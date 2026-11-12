# S5：canonical event observer probe

- 日期：2026-11-12
- 关联：`docs/superpowers/plans/2026-11-12-kernel-v2-phase3-agent-tools-observer.md` Milestone 3A
- 代码：`gateway/src/kernel-v2/observer.ts`
- 测试：`gateway/tests/unit/kernel-v2/observer.test.ts`、`observer-conformance.test.ts`
- commit：`8c6b5f60`（registry）

## 要回答的问题

只读事件订阅能否 fail-open、可过滤、不阻塞主链？

## 证据

- 定向测试：**13 / 13 pass**（registry 7 + conformance 6）。
- 非阻塞测量：1000 次 `dispatch()` 同步返回 <100ms；handler 在 `setImmediate` 后执行。
- 覆盖的情况：

| 情况 | 断言 |
|---|---|
| fan-out | 多个 observer 都收到匹配事件 |
| 过滤 | sessionID / projectId / 精确 type / `tool.*` 前缀 |
| 同步 throw | 只记录该 observer 的 failed，其他 observer 继续 |
| async reject | 同上，`lastError` 可读 |
| 超时 | `Promise.race` 记录 timedOut，drain 不挂死 |
| 队列溢出 | 丢最新，`dropped()` 计数 |
| dispose | 停止投递，逆序调用 observer dispose，幂等 |

## 决策

1. **Observer 是只读 post-hoc，不是 interceptor**：不提供 veto/rewrite 接口；审批、权限、审计、人类验收永远不能走 observer。
2. **`dispatch()` 同步入队 + `setImmediate` 调度**：主链只付出过滤和 push 的成本，不等待 handler。
3. **超时不取消已运行的 handler**：Phase 3 只保证调用方不被拖住；真正取消需要 worker/AbortSignal 隔离（Phase 6）。
4. **同步阻塞是已知边界**：如果 observer handler 同步死循环，Node 事件循环仍会被占住；Phase 6 把 untrusted observer 放进 worker。trusted observer 必须遵守“短小、非阻塞”。
5. **过滤器是白名单语义**：没有 filter = 全收；有 filter 时所有字段都必须匹配。
6. **Live hook 位置未定**：候选是 `runtime/event-dispatch.ts` 的 `conformanceTap` 之后、internal 过滤之前；Phase 3 不接线，G3 用 harness 证明。

## 未决

- live hook 的具体 stage 位置和开关（建议 `MAFW_KERNEL_V2_OBSERVERS=1`）。
- properties 脱敏范围：S5 registry 不复制 payload，只接收调用方构造的 `CanonicalEvent`；Task 3.6 的 snapshot helper 负责剔除 token/secret/prompt。
- 背压策略：当前 drop-newest；如果需要审计完整性，后续可改为 per-observer bounded mailbox。
- 多个 observer 共享同一个事件对象；handler 不应修改它（Phase 3 文档约束，不做 deep freeze）。

## 对 Phase 3 的影响

- tools contribution 和 G3 harness 可以直接复用 `CanonicalObserverRegistry`。
- G3 只需要证明“observer 收到 tool 事件且坏 observer 不阻塞”，不需要接 live gateway。
