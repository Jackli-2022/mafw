# S3：ASR provider with subprocess

- 日期：2026-11-12
- 关联：`docs/superpowers/plans/2026-11-12-kernel-v2-phase2-leaf-providers.md` Milestone 2A
- 代码：`gateway/src/kernel-v2/subprocess-ledger.ts`、`gateway/src/kernel-v2/probes/asr-subprocess.ts`
- 测试：`gateway/tests/unit/kernel-v2/subprocess-ledger.test.ts`、`gateway/tests/unit/kernel-v2/asr-subprocess-probe.test.ts`
- commit：`33ffde62`（ledger）、`1c289929`（probe）

## 要回答的问题

provider 拥有子进程时，生命周期、ledger、health、fallback 是否成立？

## 证据

- 定向测试：**11 / 11 pass**（ledger 5 + probe 6）。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- 覆盖的情况：

| 情况 | 断言 |
|---|---|
| 懒启动 | `load()` 不 spawn；并发 `activate()` 只 start 一次 |
| 启动失败 | `activate` reject；ledger 记 `failed`；`active()` 为空 |
| 启动超时 | `activate` reject `/timed out/`；ledger 记 `failed`；无 active child |
| 健康失败 | `isReady()` false → `health()` 返回 `failed` |
| 外部 adopted | ledger 记 `external`；`deactivate()` 不调用 stop/stopSync |
| 重复 stop / dispose | owned child 只 stop 一次；stopSync 只调用一次；幂等 |
| 逆序 dispose | ledger 按注册逆序 stop；单个 stop 抛错不阻断其他 child |

## 决策

1. **ASR 可以走 provider 路线**，不需要把 sidecar 留在 v1 组合根。sidecar 的 start/stop/health 可以被 `ProviderHandle` 完整包住。
2. **子进程所有权必须显式记录**：`SubprocessLedger` 区分 `provider`（本进程 spawn，可 kill）与 `external`（adopt，只观察）。禁止用“有 pid 就 kill”的推断。
3. **provider health 是同步可读状态**：`activate` 探测一次 `isReady` 并缓存；`health()` 重新探测并更新。registry 的同步 `health` 回调读取缓存，不做异步 I/O。
4. **fallback 由 registry tier + health 完成**，ASR capability 不自己实现 fallback。
5. **失败启动不重试**：一个 provider 实例一旦 start 失败就保持 failed，重建 provider 实例才能重试；避免 ledger 记录与子进程状态分叉。

## 未决

- 端口分配：当前仍由 `Qwen3AsrSidecar` 固定端口/配置决定；多实例需要 port allocator。
- GPU 争用：两个 sidecar 同时启动没有全局预算；Phase 6 或后续资源调度处理。
- Python 打包：sidecar 仍依赖用户环境；不在本 phase 范围。
- worker 隔离：untrusted provider 仍 fail-closed 拒绝，Phase 6 实现。

## 对 Phase 2 的影响

- ASR provider 放在 media 之后（Milestone 2C），复用本 probe 的 ledger 与 provider 形状。
- Media 不需要子进程，先完成 media 可以验证“无状态叶子 provider”的最短路径，再回到 ASR 的有状态部分。
