# Kernel v2 Cutover Runbook

- 日期：2026-11-12
- 状态：Phase 0/1 规划；**不适用于当前生产**
- 关联：
  - `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md` §6
  - `docs/superpowers/plans/2026-11-12-kernel-v2-phase0-1.md`
  - `docs/research/2026-11-12-kernel-v2-invariant-map.md`

## 0. 原则

- **不 flag-day**：v2 与 v1 并行，按子系统 cutover。
- **不碰 live 数据**：Phase 1 只在数据副本上跑；writes 不接 live。
- **shadow 先于 cutover**：没有 golden fixture 和对比记录，不切。
- **rollback 是 gate deliverable**：每个 cutover 前必须演练。
- **有状态核心不热插拔**：session log / memory schema / Goal-Pod / authz / scheduler 只 restart。

## 1. 拓扑

| 阶段 | v1 | v2 | 数据 |
|---|---|---|---|
| Phase 0/1 | 正常服务，默认入口 | `gateway/src/kernel-v2/` 进程内模块，仅测试 | 不接触 |
| Phase 1.5 | 正常服务 | 独立 `main.ts`，`MAFW_KERNEL_V2_PORT` | 独立数据副本，只读 |
| Phase 2+ | fallback | 按子系统接 live 只读 | 副本 → 只读 live → 受控写 |
| cutover | read-only fallback | 目标子系统主路径 | 切换 ingress |

环境变量：

```bash
MAFW_KERNEL_V2_PORT=3100
MAFW_KERNEL_V2_DATA_DIR=/path/to/kernel-v2-data
```

两个变量任一缺失，v2 入口 **exit 2**，不启动；不得回落到 `~/.mafw`。

## 2. 数据副本

```bash
# 示例：从 live 数据做只读副本（不要在 v2 启动后复制）
rsync -a --delete ~/.mafw/ "$MAFW_KERNEL_V2_DATA_DIR"/
```

要求：

- 副本路径必须是显式 temp/独立目录；不得指向 `~/.mafw`。
- Phase 1 不开启 v2 writes；所有 provider 只读。
- 副本上的 schema migration 必须记录版本；cutover 前验证 v1 能读回。

## 3. Shadow compare 对象

| 面 | 比较 | 规则 |
|---|---|---|
| HTTP | status + selected headers + normalized JSON | 忽略 timestamp/ID/随机数；每 route 一份 golden |
| TTS | PCM/WAV byte compare | 固定 text/voice/style；sample rate/header 一致；流式拼接后 byte 一致 |
| Events | canonical event golden sequence | type/order/关键字段；不比较时间戳 |
| Usage | record/replay fixture | CI 不 live fetch；provider 输出归一化 |

Shadow 工具：

```bash
node scripts/kernel-v2-shadow.mjs \
  --v1 http://127.0.0.1:3000 \
  --v2 http://127.0.0.1:3100 \
  --fixtures gateway/tests/fixtures/kernel-v2
```

退出码非 0 = 有差异，禁止 cutover。差异必须逐条解释并归档。

## 4. Cutover 步骤

1. **Freeze v1 功能**：迁移期 v1 fixes-only；新功能只进 v2，或明确双维护预算。
2. **Drain**：在 turn 边界停止新 turn；等待 in-flight 完成或取消。
3. **Snapshot**：DB + event cursor + session registry 快照；记录 hash。
4. **Data handover**：把副本迁移到目标 schema；验证 **向前/向后**兼容。
5. **Shadow**：v2 对副本跑只读 shadow；通过后对 live 只读镜像跑。
6. **Switch ingress**：按项目/功能切流；监控错误率、p95、SSE 连续性。
7. **Observe**：v1 保持 read-only fallback；至少 N 天（建议 7 天）无回滚。
8. **Decommission**：满足退役标准后停 v1 写入；再观察后移除。

## 5. Rollback

- 停 v2；恢复 v1 ingress。
- v1 在 cutover 后的数据上必须可读；schema 必须向前/向后兼容。
- 如果 schema 不兼容：恢复 snapshot；记录事故；不得继续 cutover。
- 回滚演练必须包含：in-flight session、SSE cursor、pending question、Goal/Pod 状态。

## 6. v1 `MafwScheduler` 退役标准

全部满足才可退役：

- 所有 HTTP/WS/SSE/MCP routes 由 v2 服务。
- 所有 runtime adapters / provider seams 由 v2 registry 解析。
- memory/goal/pod 的 write path 已迁移并通过 conformance kit。
- rollback drill 连续 2 次通过。
- v1 只读观察 ≥7 天，无 P1/P2 事故。
- 文档、诊断、runbook、on-call 已更新。

## 7. 禁止事项

- 在现役 `main` 上 flag-day 替换内核。
- v2 直接读写 live `~/.mafw`。
- shadow compare 未落地就 cutover。
- 未做 schema 回滚验证就写 live。
- 把 session log / memory schema / Goal 状态机热插拔。
- 把 webview 或第三方 provider 引入 kernel ring 0。

## 8. 检查清单

- [ ] `MAFW_KERNEL_V2_PORT` / `MAFW_KERNEL_V2_DATA_DIR` 显式设置。
- [ ] 数据副本路径不是 `~/.mafw`。
- [ ] shadow fixtures 已提交；差异为 0 或有解释。
- [ ] rollback drill 记录已归档。
- [ ] v1 full suite 连续 2 次 clean。
- [ ] v2 diagnostics 可查 provider/plane/state/reason。
- [ ] on-call 知道如何停 v2、如何恢复 v1。
