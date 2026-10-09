# G1 权威标签（Authority Preservation）设计

> 日期：2026-10-09 ｜ 缺口来源：`docs/research/2026-10-09-brain-research-refresh.md` §2 G1
> 实证：AuthMem-Bench（arXiv:2608.01679）——49 个记忆配置中 48 个发生权威坍缩（authority collapse），
> 未授权行为率 50.3%；PPMF（arXiv:2607.29167）独立复现。巩固管线会擦除来源约束，存储条目获得超出其来源的权威。

## 1. 问题

MAFW 的写路径（agent 直写 / turnCompress 提取 / reflection 蒸馏 / consolidation 合并）把不同权威的
内容压平成同一个 `HarmonicUnit`：

- 「用户明确陈述的偏好」（最高权威——指令源）
- 「agent 观察到的现象」（中等权威——单点观察）
- 「工具返回的事实」（中等权威——可重验）
- 「管线推断的模式」（最低权威——统计归纳，可能过度泛化）

一旦写入，下游消费面（`<agent-priors>` 常驻注入、W2 skill 物化、审批参考）无法区分——
一条「管线推断」与一条「用户指令」获得同等行为驱动力。这正是权威坍缩。

现有相邻机制（不足以覆盖）：
- `verified:YYYY-MM-DD` 锚点：环境探测验证标记（B/C 管线），只覆盖「验证过」一维
- `redactSecrets`：脱敏密文，不管权威
- `tentative`/`rejected` 锚：A2 草稿状态，不管来源

## 2. 设计

### 2.1 数据模型（schema 增量，向后兼容）

`HarmonicUnit` 与 `HarmonicIndexEntry` 新增可选字段：

```typescript
/** G1: provenance authority. Absent = legacy → treated as 'pipeline' (lowest). */
authority?: 'user' | 'agent' | 'tool' | 'pipeline';
```

四级权威（高→低）：
| 值 | 含义 | 典型写路径 |
|---|---|---|
| `user` | 用户明确陈述（指令/偏好/约束） | 主会话 `mafw_add_memory` 由用户话语触发；`pinned` 披露层条目 |
| `agent` | agent 工作中学到/观察到的 | 主会话 `mafw_add_memory`（默认） |
| `tool` | 工具返回的可重验事实 | 主会话 `mafw_add_memory`（agent 标注） |
| `pipeline` | 后台管线推断（extract/reflect/merge 产物） | turnCompress / reflection / consolidation 合并产物 / axiom 蒸馏候选 |

**缺省即最低**：legacy 条目无字段 → 消费面按 `pipeline` 处理（fail-closed，
宁可低估权威也不高估——AuthMem 教训）。

### 2.2 写路径标注

| 写路径 | 规则 |
|---|---|
| `POST /api/memory/add` | body 接受 `authority`；缺省 `agent`；非法值 400。例外：body 显式 `authority:'user'` 只在请求携带 pinned/sticky 或 caller 标注时接受——HTTP 面无法自证「用户说的」，v1 信任调用方（loopback-only） |
| MCP `mafw_add_memory` | 参数 `authority`，缺省 `agent`；透传到 HTTP |
| reflection `buildInsightUnit` | 固定 `pipeline`（蒸馏=推断） |
| turnCompress worker | 经 `mafw_add_memory`，worker prompt 引导标注：transcript 中用户原话 → `user`；agent 自己总结 → `agent`（**worker 无 `pipeline` 标注权，防自我抬权**） |
| consolidation `mergeIntoNewer` | 取 `max(incoming, target)` 权威——**权威只升不降**（合并产物至少不弱于任一来源；但 merge 本身是管线操作 → cap 在 `agent`：两个 user 合并仍 user，pipeline+user → user 内容以 user 为准…简化：取来源中较高者，但若两者皆无 user 则结果 ≤ agent）<br>v1 简化规则：**`authority = 较高者`，若任一来源为 `pipeline` 且另一为 `agent` → `agent`**。即：user 不被降级，pipeline 不抬权 |
| MinHash merge / supersede 链 | 新条目 authority 继承触发方（写路径已定）；`superseded_by` 旧条目保留原值（历史） |
| A1 axiom 蒸馏 → L5 | L5Store 条目是独立存储；候选进 triage 时把来源 insights 的最低 authority 记入 `summary.axiomDraft.authorityFloor`，人审时可见 |

### 2.3 消费面校验（行为落点）

| 消费面 | 规则 |
|---|---|
| `<agent-priors>` 渲染（W1） | 每条先验带权威徽标：`[user]`/`[agent]`/`[pipeline]`（tool 并入 agent 显示）；**pipeline 级失败模式降权渲染**（energy 排序 ×0.7 软惩罚，不硬过滤——E.4 陷阱前车之鉴） |
| `<user-profile>` pinned 渲染 | 带权威徽标；非 user 条目 pinned 时在渲染层加 `[待确认]` 提示 |
| W2 skill 物化闸门 | 新增 **G6 闸门**：`authority === 'pipeline'` 且无 `verified:` 锚 → 不物化（推断未验证不得成为自动执行程序）。user/agent + verified 照常 |
| 审批三档（P1.5 后续） | v1 不接；决策日志已落，后续模型选型时 authority 是特征维度 |
| `mafw_search_hybrid` 返回 | 结果带 `authority` 字段（仅元数据透出，不改排序——排序干预留待测量后） |

### 2.4 不做的事（v1 边界）

- 不改 BM25/dense 排序（先observe：authority 透出 + priors 软惩罚，两周后看效果再议）
- 不强制迁移存量（缺省 pipeline 即是保守正确值；高价值旧条目可经 stale-verify 管线逐步补标）
- 不做跨条目权威冲突仲裁（如 user 条目 vs agent 条目矛盾时的解决策略）——走既有 supersede 链人工处理
- 不改 HarmonicUnitFileStore 文件格式之外的东西（OKF frontmatter 白名单加 `authority` 字段）

## 3. 测试计划（TDD）

1. `harmonic-types`：字段存在性（类型级，编译即证）
2. `add-memory` 路由：authority 接收/缺省 agent/非法 400
3. `route-write`：透传不丢
4. reflection：`buildInsightUnit` 固定 pipeline
5. consolidation `mergeIntoNewer`：权威只升不降规则矩阵（user+pipeline→user, agent+pipeline→agent, user+agent→user, pipeline+pipeline→pipeline）
6. `<agent-priors>` 渲染：徽标存在 + pipeline ×0.7 排序惩罚
7. skill-promotion G6 闸门：pipeline 无 verified → 拒绝；agent+verified → 通过
8. OKF round-trip：authority 写入/读回不丢

## 4. 风险

- **worker 自我抬权**：turnCompress worker 由 LLM 标注，可能把推断标成 user。缓解：prompt 明确「只有 transcript 中的用户原话可标 user」+ 事后抽检（authority 分布进 `/api/memory/stats`）
- **排序惩罚的 E.4 风险**：pipeline ×0.7 是软惩罚非硬过滤，且只作用于 priors 渲染面（预算 800 字符内的排序），不影响检索
- **schema 膨胀**：单字段四值枚举，成本极低
