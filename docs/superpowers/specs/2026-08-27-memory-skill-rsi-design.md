# Memory-Skill RSI — 记忆结晶为技能的演化设计

日期：2026-08-27（v2，按子代理评审修正：2 BLOCKER + 7 MAJOR + 6 minor 全部处理）
状态：待复审
依赖：Phase 1（goal_outcomes 已落地）。复用 Phase 2 闭环机制（evolver / evolution 类 triage / declared_prediction / 验证 / 回滚），不新建闭环。

**实施切分（评审结论驱动）**：§2 观测层可独立先行（缩窄重做后）；§3-4 结晶管线硬依赖 Phase 2 evolver 落地 + §2 归因数据积累（≥30 天），不得提前实施。

## 1. 目标

谐波记忆的 `procedural` 类型是"未结晶的 skill"：经验不断沉淀为备忘录，但没有升格为可复用技能的通道，也没有"这条经验到底有没有用"的追踪。本 spec 建立 **memory → skill 的结晶管线 + skill 库治理**，让记忆层从"我记得什么"演化出"我会做什么"。

业界依据：
- **Voyager**：成功操作固化为可检索 skill，能力滚雪球
- **Library Drift**（2605.19576，关键反面教材）：LLM 自动产 skill 无治理 = +0.0pp；加 outcome 驱动退役 + 活跃上限 = +0.33。**成败点在治理不在生成**
- **RSEA**：skills 层与 procedural memory 定位同构，held-out 门保证单调安全
- **CoEvoSkills**：skill 需要验证，不是写出来就算数

## 2. 前置：检索归因观测（Phase 0，独立小 PR，先行）

### 2.0 前置缺陷修复（评审 M4，阻塞性）

能量衰减 pass 有 pre-existing bug：`automation-engine.ts` 的 decay 用 `created_at` 算全龄天数，对**已衰减过**的当前 energy 每天重复扣全龄衰减，累计扣除 = r·n(n+1)/2（平方衰减，salience=1 时 0.9 能量约 19 天归零）。**必须先修**（index entry 增加 `last_decay_at`，按增量天数衰减），否则 §3.2 的 energy 阈值语义整体退化、结晶候选池系统性枯竭。修复作为本 Phase 0 的一部分，独立测试覆盖。

### 2.1 Session 上下文穿透（评审 B2，阻塞性）

MCP handler 上下文无 session 概念（`Services` 无 session 字段，MCP transport sessionId ≠ opencode sessionID 且不传给 handler）。不修这个，最大检索出口上 `session_id`/`goal_id` 恒 NULL，归因系统性无数据，且 worker 排除无法实现（turn-compress worker 也调 `mafw_search_hybrid`，MCP 层不可区分）。

设计（插件侧注入，gateway 侧接收）：
- `mafw_search_hybrid` MCP 工具 schema 增加**可选** `sessionID` 参数；插件侧包装（`src/tools/`）从 ToolContext 注入当前 sessionID。直连 MCP（无插件包装）的调用 sessionID 缺失 → 埋点照落但 session_id=NULL（走 §2.4 fallback 归因）
- worker 排除：`internalSessionRoles`（现 Scheduler 私有，`index.ts` 注册/过滤）的查询能力**导出为模块级函数**（如 `isInternalSession(sessionID)`），埋点层调用；sessionID 命中白名单 → 不埋点
- `/api/recall/context`：sessionID 从 query param 现成可得，无需穿透改造

### 2.2 新表（gateway.db）

```sql
CREATE TABLE IF NOT EXISTS memory_retrievals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  session_id TEXT,                 -- 可空：session 穿透缺失时为 NULL
  goal_id TEXT,                    -- 可空：由归因阶段回填，埋点时不写
  query TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score REAL NOT NULL,             -- 出口排序分（跨 source 不可比，评审 M7）
  source TEXT NOT NULL,            -- 'search_hybrid' | 'recall_context' | 'step_inject' | 'reflection'
  surfaced INTEGER NOT NULL,       -- 1=实际进入 LLM 上下文，0=仅检索返回（评审 m6）
  created_at TEXT NOT NULL
);
CREATE INDEX idx_retrievals_memory ON memory_retrievals(memory_id, created_at);
CREATE INDEX idx_retrievals_session ON memory_retrievals(session_id);
```

口径定义（评审 M1/m6）：**"命中"= 检索返回即埋点，`surfaced` 区分是否真正进入上下文**。各出口的 surfaced 判定：
- `search_hybrid`：全部 1（返回即进上下文）
- `recall_context`：`formatRecallContext` 只渲染前 3 条（inject-format.ts），rank ≤ 3 → 1，否则 0
- `step_inject`：经 fingerprint 去重与频率门后实际 enqueue → 1，被门拦截 → 0

### 2.3 埋点位置（四个出口，评审 M1 补全）

| 出口 | 文件 | session 可得性 | 备注 |
|---|---|---|---|
| `mafw_search_hybrid` | `mcp/handlers/search-hybrid.ts` | §2.1 穿透后可得 | handler 改调 `searchScored`（评审 M7：现 `search()` 丢弃原始分；score 字段存出口排序分即可） |
| `/api/recall/context` | `index.ts` 路由 | query param 现成 | 路由在 formatRecallContext 前持有结构化 `RecallMemory[]`（含 id/score），不需要下层埋 |
| step-inject | `index.ts` step-finish 处（`harmonicIndex.search(query, 8)`） | 现成 | 评审 M1：信号质量最高（记忆真正被注入的路径）；入/被门拦各埋一条 |
| reflection | `recall/reflection.ts` | 作用域内现成 | source='reflection'，**只用于分析，不计入结晶触发计数**（评审 M5：反思管线 topK=5 天然满足 rank≤5，且属系统内部使用，计入会让"被反思反复命中"伪装成"真被用到"） |

fail-open：落库失败只 warn。worker session（`isInternalSession` 命中）不埋点。

### 2.4 贡献归因（评审 M2 修正）

归因优先级（查询时计算，不改检索路径）：
1. **精确 join**：`session_id` → `goal_sessions`（Phase 1 表，PK (goal_id, session_id)，带 session 索引）→ `goal_outcomes`。**不用 24h 时间窗当主路径**——goal_sessions 是精确映射；时间窗只作 goal_sessions 查不到时的 fallback（24h 同 session 最近 outcome）
2. session_id 为 NULL（穿透缺失）→ 仅时间窗 fallback；仍无归属记 0

verdict 全值映射（评审 M2b，实际取值五种）：PASS=+1 / FAIL=-1 / MAX_RETRIES=-1 / ERROR=-0.5 / CANCELLED=0

thumbs 反馈（评审 M2c/M3）：
- 现状核实：feedback 写 `<projectDir>/.mafw/feedback/{targetId}-{ts}.json` 散文件，targetId 是 goal/loop 级，跨项目分散；`useful_feedback +0.1` energy 是**休眠常量**（现役 handleRecordFeedback 不触碰记忆 energy）
- **首版不接入 thumbs**（跨项目文件扫描 + 粒度错配，成本不值）；列为后续增补
- §6 不可演化面增加显式约束：**feedback 信号不接 memory energy**——今天不存在双重计入是偶然（energy 接线休眠），不是设计；一旦未来激活 feedback→energy，thumbs 会同时进入 energy（→ 结晶条件）和贡献分

## 3. 结晶管线（memory → skill）

**硬依赖：Phase 2 evolver 已实现 + §2 归因数据积累 ≥30 天。**

### 3.1 Skill 形态（评审 M6 修正：作为 HarmonicUnit 写入，不走独立存储）

skill 是带标记的 HarmonicUnit，直接进谐波系统（复用 tier 文件、索引、检索全链路）：
- `type: 'procedural'`，`pinned` 不用，新增标记字段 `skill: { name, trigger, procedure, source_memory_ids, declared_prediction, status, version }`（HarmonicUnit 加可选字段）
- **管线豁免清单**（评审 M6 连锁反应）：`memory:decay` cron 跳过 skill 条目（skill 的存活由 §4 治理决定，不参与能量衰减）；MinHash 合并跳过（skill 是精心结晶的产物，不许被自动合并）；reflection 分组跳过
- index entry 不存 memory_value——命中后从 tier 文件按需加载完整 procedure（现有"按需从 tier 文件加载完整 memory_value"路径直接复用）
- skill 命中同样落 `memory_retrievals`（memory_id = skill id），归因链不断

### 3.2 触发条件（evolver 候选筛选，代码强制）

procedural memory 成为结晶候选需**同时**满足：
- `energy ≥ 0.6`（§2.0 修复后的增量衰减当前值；最多 stale 24h 可接受）
- 近 30 天检索命中 ≥ 5 次，且命中时 rank ≤ 5，**只计 source ∈ {search_hybrid, recall_context, step_inject} 且 surfaced=1 的记录**（评审 M5：reflection 与未入上下文的命中都不算"真被用到"）
- 命中归因贡献分净值为正（≥ +2，按 §2.4 口径）
- 内容结构检测：memory_value 含多步操作特征（步骤标记/条件分支/命令序列），一句话事实不结晶
- 未被现有 skill 覆盖（skill.source_memory_ids 查重 + evolver prompt 携带现有 skill 清单）

满足条件只是**候选**；是否提议结晶由 evolver 判断（"no change" 仍是合法输出）。

**冷启动语义（评审 m4，写明防误判）**：memory_retrievals 上线为空表，"近 30 天命中 ≥5 次"意味着**首月必然零候选——这是特性不是故障**。存量 memory 不会首日淹没 triage（触发条件天然限量）；30 天后若集中达标，evolver 配额内限流（单次运行结晶提议 ≤1 条）。

### 3.3 结晶提议与激活（复用 Phase 2 闭环）

- **注册相位（评审 B1 修正）**：`memory.skill_crystallize` 注册为 `evolvablePhase: 2`（结晶风险近似 artifact 层：错了只是多一条低质 skill，§4 治理可回收）。registry.ts 类型联合（现 `2 | 3`）无需为本 spec 扩展。注：goal-loop spec 的 phase 2.5/3.5 组件有同类问题，其 phase 门修订（可配置 maxActivePhase）属该 spec 的前置改动，不在本 spec 范围
- proposal diff 内容 = skill 定义全文（新组件无"旧值"）；evolution 类 triage → 人确认 → 写入谐波系统 + proposal status=active
- declared_prediction 随 skill 快照，验证窗口按引用次数计（"surfaced=1 命中后的 15 个关联 goal 中..."，口径依赖 §2.4 归因——评审 m5：归因修复前该验证不可启用）
- 验证/回滚/superseded 语义完全复用 Phase 2 validator

### 3.4 生效方式：检索注入

skill 不进 opencode 原生 skill 系统（要求重启/改配置、无法版本化治理），作为检索增强材料：
- skill 进谐波索引（§3.1），trigger 文本即 primary_abstraction，参与 BM25 检索
- 命中 skill 时，`/api/recall/context` pointers 块额外注入 procedure 摘要（带 skill_id 标记；step-inject 路径同理）
- **源 memory 保留**（继续参与检索）；**双命中降权在查询时实现**（评审 m2：检索后处理阶段按命中 skill 的 `source_memory_ids` 构建抑制集，源 memory 排序降权 ×0.5——**不改 energy**，改 energy 会污染记忆语义并干扰 decay 基准）

### 3.5 全局 vs 项目级

首期只做全局（skill 存 `~/.mafw` 谐波 tier 文件）。项目级 `.opencode/skills/` 有 git 版本红利但污染仓库、多项目结晶来源冲突处理复杂——列为后续增补。

## 4. Skill 库治理（Library Drift 防线，本 spec 的成败点）

### 4.1 Outcome 驱动退役

- skill surfaced 命中 ≥ 10 次后，贡献分净值 ≤ 0 → evolver 提议退役（triage 人确认）
- 退役 = skill.status: retired + 从索引移除，tier 文件保留（stepping stones，可复活）
- 连续 90 天零 surfaced 命中 → 自动提议退役（化石清理）

### 4.2 活跃上限与替换规则（评审 m1 补全）

- 活跃 skill 硬上限 **15 个**
- 达到上限后新结晶提议必须**同时提议退役一个现有 skill**，否则 evolver 丢弃
- 退役选择的确定性排序：贡献分净值升序 → 同 trigger 领域优先 → **保护期**：命中数 < 10 的新 skill 不可被选为替换对象（未到判定样本量）

### 4.3 防退化约束

- skill 的 procedure 修改走 proposal（段落级 diff，同 prompt 模板约束），禁止全文替换
- `source_memory_ids` 只增不删（追溯链不可断）

## 5. 管理面（评审 m3 补全）

- `GET /api/skills`：列出 skill（含贡献分、命中数、status）
- 新 MCP 工具：`mafw_list_skills`（只读）、`mafw_retire_skill`（强制退役，人控面入口，不走 proposal）
- AGENTS.md Tools 清单与权限白名单（manager 35 工具）同步更新

## 6. 不可演化面

- 结晶触发条件的阈值参数（0.6 / 5 次 / +2 / 15 上限 / 保护期 10）——改这些走 Phase 2 参数层（登记入 ORCHESTRATION_REGISTRY，`evolvablePhase: 2`），evolver 不能自我放宽结晶标准
- **feedback 信号不接 memory energy**（评审 M3：显式约束，不依赖"接线碰巧休眠"的偶然现状）
- 贡献归因的 join 逻辑、埋点代码、surfaced 判定
- 退役提议的 triage 确认流；`mafw_retire_skill` 人控入口
- skill 的 decay/merge/reflection 豁免清单本体

## 7. 测试

- 前置修复：增量衰减（last_decay_at）不重复扣、跨天幂等
- session 穿透：插件包装注入 sessionID、缺失时 NULL fallback、`isInternalSession` 导出与 worker 不埋点
- 埋点：四出口均落库、surfaced 三出口判定（recall rank≤3 / step-inject 过门）、落库失败 fail-open
- 归因：goal_sessions 精确 join 优先、时间窗 fallback、五 verdict 映射、NULL session 路径
- 结晶候选：五条件各自边界；reflection/未 surfaced 命中不计入触发计数；冷启动首月零候选
- skill 存储：decay/merge/reflection 豁免、双命中查询时降权（不动 energy）、tier 文件按需加载 procedure
- 治理：命中 ≥10 且贡献 ≤0 → 退役提议；90 天化石清理；上限 15 替换式 + 退役选择排序 + 保护期
- 管理面：list/retire 工具、retire 后索引移除 + 文件保留

## 8. 改动清单

| 文件 | 改动 |
|---|---|
| `gateway/src/core/automation-engine.ts`（或 decay 所在处） | 修复增量衰减（last_decay_at）~30 行 |
| `gateway/src/memory/gateway-db.ts` | +memory_retrievals 表 + 写入/归因查询 ~140 行 |
| `src/tools/`（插件侧） | search_hybrid 包装注入 sessionID |
| `gateway/src/mcp/tool-registry.ts`、`core/mcp/tools.ts` | search_hybrid schema +sessionID 可选参数 |
| `gateway/src/index.ts` | `isInternalSession` 导出；recall 路由 + step-inject 埋点 |
| `gateway/src/mcp/handlers/search-hybrid.ts`、`recall/reflection.ts` | 埋点（handler 改调 searchScored） |
| `gateway/src/orchestration/registry.ts` | +`memory.skill_crystallize`（phase 2）+ 阈值参数组件（phase 2） |
| `gateway/src/core/memory/harmonic-types.ts` | HarmonicUnit +可选 skill 字段 |
| `gateway/src/core/memory/harmonic-index.ts` | 双命中查询时降权（抑制集后处理） |
| decay/merge/reflection 管线 | skill 豁免清单 |
| `gateway/src/recall/inject-format.ts` | pointers 块支持 skill procedure 摘要段 |
| `gateway/src/orchestration/evolver.ts`（Phase 2 新建） | 扩展：skill 候选扫描（限流 ≤1/次）+ 结晶/退役提议 |
| `gateway/src/index.ts`、`mcp/tool-registry.ts` | `GET /api/skills` + `mafw_list_skills`/`mafw_retire_skill` |
| `tests/unit/gateway/` | +4 个测试文件 |
| `AGENTS.md` | Tools 清单 +2、memory-skill 演化小节、manager 白名单 |

## 9. 退出标准

- **Phase 0（§2，可独立验收）**：增量衰减修复上线；四出口埋点在真实环境跑 7 天无 fail-open 告警；归因查询能回答"这条 memory 近 30 天贡献净值（含 verdict 五值映射）"
- **结晶（§3，依赖 Phase 2 evolver + 30 天归因数据）**：≥1 条真实 procedural memory 走完候选 → 提议 → triage → 激活 → recall 注入全流程
- **治理负例（§4）**：合成"命中多但贡献为负"的 skill 触发退役提议；合成第 16 个结晶提议被要求替换式演化且退役选择符合确定性排序；保护期内新 skill 不被选中
