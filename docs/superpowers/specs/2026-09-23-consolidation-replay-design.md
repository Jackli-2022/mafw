# 巩固层 · 回放（Consolidation Replay）设计

> 日期：2026-09-23 · 状态：设计已确认，待写实施计划
> 范围：P1 首切片——turnCompress worker 交错注入跨会话相关旧记忆（CLS interleaved replay 的非参数近似）
> 前置：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md`（§1.2E CLS / §1.4E 再巩固 / §5 行动项1）

## 1. 背景与目标

调研结论：MAFW 的巩固只有"快半"——`TurnPipeline` 把本小时 transcript 交 worker，只 CREATE 新记忆；没有 CLS 的"回放"（采样旧知识、交错复现、诱导结构）。worker prompt 虽已要求"写 preference 前先 `mafw_search_hybrid`"，但那是**worker 自主行为**，不可保证、不可测。

**目标**：在 `TurnPipeline.runSession` 里**主动召回跨会话相关旧记忆**并注入 worker prompt，使其判 UPDATE/合并/矛盾而非只 CREATE。

**非目标**：不做参数化写回（Dual-Layer）；不改存储；不改 L2/评测；不做再巩固（下一切片）。

## 2. 现状（代码事实）

- `TurnPipeline.runSession(sessionID)`（`gateway/src/recall/turn-pipeline.ts:145`）：
  1. `t1db.listTurns()` → `completeTurns` → 本会话 turns
  2. `observationsToTranscript` → transcript
  3. `sessionContext(index, sessionID, contextEpisodes)`（`:99`）→ **本会话**旧 episodic 的 primary_abstraction
  4. `workerFor(sessionID).prompt(base, TOOL_EXTRACTION_SYSTEM, ...)` → agent 自主 `mafw_add_memory`
- `TurnPipelineOptions`（`:18`）已有 `index: HarmonicIndexManager`、`contextEpisodes`、`gradeFor`。
- `TOOL_EXTRACTION_SYSTEM`（`:41`）已含"写 preference 前先 search + supersedes"段（`:68`）。

## 3. 设计

### 3.1 召回跨会话相关旧记忆（deps 注入，可测）
新增纯函数（`turn-pipeline.ts`）：

```ts
export function priorKnowledgeFor(
  index: HarmonicIndexManager,
  sessionID: string,
  query: string,
  k: number,
): HarmonicIndexEntry[] {
  if (k <= 0 || !query.trim()) return [];
  return index
    .searchScored(query, k * 3, { retriever: 'bm25', graphExpand: true })
    .map((s) => s.entry)
    .filter((e) => e.source_session_id !== sessionID)  // 排除本会话
    .filter((e) => e.type !== 'episodic')             // episodic 叙事，回放价值低
    .filter((e) => !e.superseded_by)
    .slice(0, k);
}
```
- 以新 transcript 为 query；`searchScored` 复用锚点边 + 联想层共激活边。
- 取 `k*3` 再过滤，保证过滤后仍有 `k` 条。

### 3.2 渲染注入块（纯函数，可测）
```ts
export function priorKnowledgeBlock(entries: HarmonicIndexEntry[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    const line = `- [${e.id}] ${e.primary_abstraction}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return '';
  return `Prior knowledge from other work (reconcile — update/merge/supersede rather than duplicate):\n${lines.join('\n')}`;
}
```

### 3.3 注入 runSession
把现有（`turn-pipeline.ts:168-171`）的 `base`/`grade` 拼装改为：
```ts
const prior = priorKnowledgeFor(this.opts.index, sessionID, transcript, this.opts.replayK ?? 5);
const priorBlock = priorKnowledgeBlock(prior, this.opts.replayMaxChars ?? 1500);
const grade = this.opts.gradeFor?.(sessionID);
const gradeBlock = grade
  ? `Outcome feedback for this session's recent work (a signal about trajectory reliability, not proof of correctness):\n${grade}`
  : '';
const prompt = [base, priorBlock, gradeBlock].filter(Boolean).join('\n\n');
```
（`HarmonicIndexEntry` 需从 `../core/memory/harmonic-types` 引入类型。）

### 3.4 prompt 指令
`TOOL_EXTRACTION_SYSTEM` 增一段（在现有 supersedes 段后）：
```
When "Prior knowledge from other work" is provided: compare each new insight against it.
If a new insight updates or contradicts an existing memory, call mafw_add_memory with
supersedes: [that id] (or mafw_supersede_memory to retract without replacement) —
do not create a duplicate. If prior knowledge is unrelated, ignore it.
```

## 4. 配置

`TurnPipelineOptions` 新增（默认值）：
- `replayK?: number`（默认 5）
- `replayMaxChars?: number`（默认 1500）

`index.ts` 的 `getTurnPipeline()` 传入默认值（或读 config.recall，若加配置键）。

## 5. 测试

- **单测** `turn-pipeline-replay.test.ts`：
  - `priorKnowledgeFor`：跨会话过滤（排除本会话）、排除 episodic、排除 superseded、top-K。
  - `priorKnowledgeBlock`：格式、预算截断（超 maxChars 停）。
  - `runSession` 集成：用 fake worker 捕获 prompt，断言含 prior knowledge 块且含跨会话记忆 id（deps 注入）。
- **回归**：现有 `turn-pipeline` 相关测试 + 全量套件。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 注入旧记忆带偏 worker（写错类型/噪声） | K 小（5）+ 预算 1500 + prompt 明确"无关则忽略" |
| token 成本上升 | K/预算可配；空则注入空串 |
| 召回质量差 | 复用 BM25 + 锚点/共激活；可后续用 feedback 调 |
| 与 worker 自主 search 重复 | 注入块标注 id，worker 可直接 supersedes，无需重复搜 |

## 7. 涉及文件

- 修改：`gateway/src/recall/turn-pipeline.ts`（`priorKnowledgeFor`/`priorKnowledgeBlock`/`runSession`/`TOOL_EXTRACTION_SYSTEM`）
- 修改：`gateway/src/index.ts`（`getTurnPipeline()` 传 `replayK`/`replayMaxChars`）
- 测试：`gateway/tests/unit/turn-pipeline-replay.test.ts`
