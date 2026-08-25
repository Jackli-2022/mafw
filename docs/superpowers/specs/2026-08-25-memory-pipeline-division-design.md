# 记忆管线两级分工设计（TurnCompress / Reflect）

日期：2026-08-25
状态：已批准（用户确认方案 B）

## 背景与问题

MAFW 有两条后台记忆提取管线：

- **TurnCompress**（每小时，`gateway/src/recall/turn-pipeline.ts`）：输入本会话原始 T1 观察全文，worker agent 自主调 `mafw_add_memory`，三类型（semantic/episodic/procedural）全收。
- **Reflect**（每日，`gateway/src/recall/reflection.ts`）：输入本 session 未反思的 episodic 条目，worker 一次调用产出 6 类 insight（failure/correction/insight/preference/convention/tool-quirk）。

现存问题：

1. **reflect 输入太薄**：`unreflectedBySession`（reflection.ts:99）只喂 `primary_abstraction + cue_anchors`（一句话），不喂 `memory_value` 全文——做"跨回合蒸馏"却拿不到细节。
2. **职责重叠**：preference 两条管线都在提；procedural lesson 两边都出现。
3. **无显式提取标准**：`calculateSalience`（salience-perceptor.ts）只是关键词正则（0.5/1.0/1.5 三档），"什么值得记"没有量化判据。

业界调研结论（Generative Agents / Mem0 / Zep / A-MEM / LangMem / MemoryOS / NEMORI）：两级写入是主流骨架；第一级忠实记录事实层，第二级产跨回合高阶洞察；Generative Agents 的 reflection 模板为"聚合触发 → 生成显著问题 → 检索取证 → 带引用洞察"；提取标准的最简可行方案是 importance 1-10 显式打分。

## 设计（4 处改动）

### 改动 1：reflect 输入升级为全文

**文件**：`gateway/src/recall/reflection.ts`

`reflectSession`（line 172）拿到 episodes 列表后，逐条 `this.store.read(id)` 加载 `memory_value` 全文组成 prompt；读取失败回退到现有摘要行（`${primary_abstraction} ${cue_anchors}`）。每条截断 2000 字符防爆 token。`unreflectedBySession` 签名不变。

### 改动 2：两条管线 prompt 分工声明

**TOOL_EXTRACTION_SYSTEM**（turn-pipeline.ts:36）加分工段：

> 专注本会话的**事实层**：具体事实、决定、偏好、事件结果、具体的技术坑（哪个 API 怎么用）。不要做跨会话的模式泛化——那是每日 reflection 管线的职责。

**REFLECT_SYSTEM**（reflection.ts:48）加分工段：

> 只做**跨回合的高阶模式**：反复出现的失败根因、可泛化到未来任务的教训、用户行为模式。禁止重复 episodic 记忆里的单点事实（那些已被 turnCompress 记录）。

### 改动 3：Generative Agents 式三步反思（gateway 编排）

`reflectSession` 从"一次调用"改为编排式三步：

```
episodes 全文
  → Step 1: worker.prompt(episodes, QUESTIONS_SYSTEM, model)
            → 解析 JSON {"questions": ["...", ...]}（2-3 个最显著问题）
  → Step 2: 每个问题 gateway 代码侧调 this.opts.index.searchScored(q, 5)
            （bm25，跳过 superseded），汇总去重为证据块
  → Step 3: worker.prompt(episodes + 证据块, REFLECT_SYSTEM, model)
            → parseInsights(text)（现有格式不变）
```

- 新增 `QUESTIONS_SYSTEM` 常量 + `parseQuestions()` 解析函数（解析失败回退：跳过取证，直接 Step 3）
- 证据块格式：`### 相关历史记忆\n- [id] primary_abstraction`
- 输出格式不变（insights JSON），证据只作为输入增强；引用持久化留到以后（YAGNI）
- 每 session 每日多 1 次 LLM 调用，成本可接受
- Step 1 或 Step 3 硬失败（异常）→ episodes 保持未反思（现有行为）；Step 2 无结果不视为失败

### 改动 4：turnCompress importance 打分 → salience

`mafw_add_memory` 增加可选参数 `importance`（1-10 整数），prompt 标尺：1=琐碎日常，5=普通事实，9-10=架构级决定/严重事故。

映射：`salience = 0.5 + (importance - 1) / 9`（1→0.5，10→1.5，与现有三档范围兼容）。不传则回退现有 `calculateSalience(content)` 正则。

涉及写入路径（三处 salience 计算点）：

1. **插件工具 schema**：`src/tools/add-memory.ts` — args 加 `importance: z.number().int().min(1).max(10).optional()`，POST body 透传
2. **HTTP 路径**：`gateway/src/index.ts:4574` `/api/memory/add` — 读 `data.importance`，合法（1-10 有限数）则换算 salience，否则回退正则
3. **MCP 路径**：`gateway/src/mcp/handlers/add-memory.ts:38` — 同上逻辑
4. **TOOL_EXTRACTION_SYSTEM**（turn-pipeline.ts）加 importance 打分指引（标尺 + "每条记忆必须显式打分"）

`core/mcp/tools.ts:450` 是 legacy 路径，不动。

## 测试

- `tests/unit/gateway/reflection.test.ts` 更新/新增：
  - 全文加载：mock store.read 返回 memory_value，断言 prompt 含全文而非摘要行；read 失败回退摘要行
  - 三步流程：mock worker.prompt 两次返回（questions JSON → insights JSON），mock index.searchScored，断言 Step 3 prompt 含证据块
  - questions 解析失败回退：跳过取证直接 Step 3
  - 分工 prompt 断言：REFLECT_SYSTEM 含"跨回合"、TOOL_EXTRACTION_SYSTEM 含"事实层"
- importance 映射单测：importance=1 → 0.5，importance=10 → 1.5，缺省回退正则（HTTP + MCP 两路径）
- 全量 `npm test` + `npm run build` + 全局包同步（改的是 gateway 写路径）

## 明确不做（YAGNI）

- 证据引用持久化到 HarmonicUnit 字段
- insight category 独立字段保留（6 类 → semantic/procedural 的塌缩不处理）
- Mem0 式 ADD/UPDATE/DELETE/NOOP 写入决策（动 write() 核心路径，现有 soft supersede 在 LongMemEval knowledge-update 已 100%）
- reflect 管线的 importance 打分（CATEGORY_ENERGY 已够）
