# 2026-11-14 · 记忆管线运维修复（reflection / cron 补跑 / T1 回填）

- **分支**：`fix/memory-pipeline-ops`（基于 main `919f432e`）
- **状态**：已合并并部署；生产验证通过
- **部署**：`ed28ff84`（有界 reflection / cron 补跑 / T1 回填）→ `dfd2d292`（无工具 reflector）→ `3592b082`（opencode system prompt 透传）
- **范围**：只改 gateway 记忆管线；统一插件包、runtime 契约、adapters、插件中心零改动

## 观测到的三类故障

| 现象 | 证据 | 根因 |
|---|---|---|
| reflection 自 2026-11-02 后无成功 | `pipeline-heartbeat` `memory:reflect.lastSuccessAt=2026-11-02T03:51:25Z`；11-10 `failed=176` | 11-10 是 opencode serve 401 风暴（176 个 session 的 worker prompt 全部失败），catch 静默吞错，无法定位 |
| 每晚 03:00 触发但从不落心跳 | 11-12/13/14 均在 03:30:3x 报 watchdog timeout；`lastRunAt` 仍停在 11-10 | `runAll` 无墙钟预算：逐 session × 最多 100 episode × 每批 2 次 LLM，每次 prompt 上限 300s；超过 30min watchdog 后进程被后续重启打断，永远走不到 `heartbeat.record` |
| 每次 restore 都 `reviewed=N distilled=0 deduped=0` 且同一批反复出现 | 11-11～11-14 `[Reflection:restore]` 日志；11-14 部署后复现 `batch failed: unparseable reflection output` | ① **opencode adapter 丢弃 `system`**：2.1.0 `/session/{id}/prompt` 没有 `system` 字段，adapter 没有降级写入，`REFLECT_SYSTEM`（JSON schema 与规则）从未到达模型；② **worker 身份带写工具**：`memory-curator` 允许 `mafw_add_memory`，模型把 reflection 当策展任务直接写库并回复 markdown；③ worker 输出解析过严（只接受纯 JSON）；④ 空 insights 不推进游标 → 同一批 episode 每晚重跑；⑤ boot restore 对每个 pending session 并发启动，形成 prompt 惊群 |
| 周级任务 10-25 后未运行 | `memory:review` / `skillPromotion` / `axiomDistill` 心跳停在 10-25；11-01/11-08 周日 04:00–06:00 UTC gateway 不在线 | cron 无补跑机制，错过即永久错过 |
| T1 覆盖率持续下滑 | archive 70,151 / vectors 26,266（37.4%）；archive 约 +485/天，回填 200/天 | 每日回填上限低于增长速度 |

## 修复

1. **reflection 有界运行**（`gateway/src/recall/reflection.ts`、`config.ts`、`kernel.ts`）
   - `runAll` 新增 `maxRunMs`（默认 15min）与 `maxSessionsPerRun`（默认 50）；批间检查 deadline，未处理 session 计入 `deferredSessions`。
   - boot restore 通过 `selectRestoreSessions` 只取 `restoreReflectMaxSessions`（默认 3）个 session 并顺序执行，消除启动时并发 prompt 惊群。
   - heartbeat 记录 `deferredSessions`，日志带 `deferred`。

2. **失败可见 + 游标语义**
   - worker 失败与不可解析输出记录 `sessionID + error`（默认 warn 日志，可注入 `onError`）。
   - `extractJsonPayload` 从解释性文字中提取首个平衡 JSON；`parseInsightsDetailed` 返回 `{ ok, insights }`。
   - 可解析的空 insights 视为合法结果并推进游标；不可解析/抛错保留 pending。修复“同一批 episode 永远重跑”。

2b. **JSON 管线改用无工具身份**（`gateway/src/runtime/identity-registry.ts`）
   - 新增 `memory-reflector` agent：`nativeTools: { '*': false }`，系统提示明确“无工具、只返回 JSON”。
   - reflection（questions/distill/tentative）、reconsolidation、grace revisit、dream、axiom distill 全部从 `memory-curator` 切到 `memory-reflector`。
   - `memory-curator` 保留记忆写工具与只读工具，仅供需要 `read` 核验的 stale-verify（`memory:review`）使用。

2c. **opencode adapter 兑现 `system` 契约**（`adapters/opencode/src/adapter.ts`）
   - 2.1.0 原生 `/session/{id}/prompt` 没有 `system` 字段；adapter 之前直接忽略 `opts.system`，所有记忆管线的 system 指令（REFLECT_SYSTEM / QUESTIONS_SYSTEM / AXIOM_SYSTEM / DREAM_SYSTEM…）从未到达模型。
   - `prompt` 与 `promptAsync` 现在把 `system` 作为首个 text part 前置到 `text`，保留原有 `{text}` 顶层形状。
   - 这是 11-14 第二次部署后仍报 `unparseable` 的直接原因：无工具身份下模型能返回 JSON，但 schema 是它自己编的（`task`/`memories`/`operation`），不是 `{"insights":[...]}`。

3. **cron 补跑**（`gateway/src/recall/pipeline-rules.ts`、`automation-engine.ts`、`boot.ts`、`kernel.ts`）
   - `findMissedPipelineRuns` 用 `cron.CronTime.getNextDateFrom(lastRunAt, timezone)` 判断自上次尝试后是否错过计划时刻。
   - 启动 30s 后对每条错过规则补跑一次，按 60s 错开；只补有 `lastRunAt` 记录的管线；disabled 规则由 `hasRule` 过滤。
   - 补跑仍走 scheduler 的 mutex、30min watchdog 与 budget 门控。

4. **T1 回填吞吐**（`gateway/src/config.ts`）
   - `t1BackfillLimit` 默认 200 → 3000。按本地 embedding 约 20 行/秒估算，3000 条约 2–3 分钟，仍在 decay watchdog 内；相对 archive +485/天形成净追赶。

## 测试

新增/扩展：

- `gateway/tests/unit/recall/reflection-resilience.test.ts`（12 项）
  - 解释文字包裹 JSON、空 insights 推进游标、不可解析保留 pending、worker 失败上报、`maxSessionsPerRun`、批间 deadline、restore 选择上限、`memory-reflector` 身份禁用全部工具、reflection 使用该身份
- `gateway/tests/unit/recall/pipeline-catchup.test.ts`（7 项）
  - 日/周规则错过与未错过、从未运行不补、非法时间戳、非记忆管线动作过滤
- `gateway/tests/unit/memory/t1-backfill.test.ts`（+1 项）
  - 默认回填上限 ≥ 3000
- `gateway/tests/unit/opencode-adapter.test.ts`（+2 项）
  - `prompt` / `promptAsync` 把 `system` 前置进原生 prompt text

全量：**927/927 suites，7350/7352 tests passed，0 failed，2 skipped**（`human-token` 的 2 个 POSIX-only 用例）。

## 生产验证（2026-11-14 20:11 +08:00）

- `memory:reflect` catch-up 一次运行：`sessions=14 reviewed=133 distilled=184 deduped=0 failed=0 deferred=330`；heartbeat `lastRunAt/lastSuccessAt=2026-11-14T12:11:37Z`，`stale=false`。
- boot restore 额外完成 3 个 session：`reviewed=39/60/83 → distilled=42/71/82`。
- 精确 provenance `t1.provenance.withExact`：32 → 183（reflection insight 带回了 raw-T1 replay 的 `source_trace_ids`）。
- 周级补跑：`memory:review` / `memory:skillPromotion` / `memory:axiomDistill` 均在启动后运行并记录成功；axiom 产出 3 个候选。
- 部署配置实测：`t1BackfillLimit=3000`、`reflectionMaxRunMs=900000`、`reflectionMaxSessionsPerRun=50`、`restoreReflectMaxSessions=3`。
- T1 覆盖率 37.5%，archive 70,151；下一次 `memory:decay` 起按 3000/天追赶（净增约 +2500/天）。

## 已知限制

- `memory:review` 的 worker 失败本身未在本提交内修复；补跑会重新尝试并记录 `lastRunAt`，失败原因仍由现有 heartbeat error 暴露。
- 补跑只在 gateway 启动时触发；若进程长期在线但 cron 定时器本身失效，仍依赖后续 watchdog/告警。
- 历史 reflection 积压（541 pending episodes）需要多个 15min pass 才能消化；每个 pass 都会记录增量与 `deferredSessions`。
- 历史 15k 条 Knowledge 仍不做 provenance 推断回填（沿用 2026-11-14 provenance 修复的边界）。
