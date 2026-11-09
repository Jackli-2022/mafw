# LongMemEval 记忆基准

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

## LongMemEval 记忆基准（evaluation/longmemeval/）

基于 LongMemEval (arXiv:2410.10813, ICLR 2025) S 集（500 题，6 类，~50 haystack sessions/题）的谐波记忆质量评测。TS runner 直接 import gateway 类，`fs.mkdtempSync` 隔离 HarmonicUnitFileStore，**不污染**真实 `~/.mafw`，不需启动 gateway 实例。

**两层**：
- **L1 检索层**：`ingest` 灌入 → `HarmonicIndexManager.search(question, k)` → `recall@k / ndcg@k`（per-session 对 `answer_session_ids`）
- **L2 阅读层**：L1 top-k 记忆 + reader LLM → judge LLM（per-type prompt，0/1）

**关键发现（baseline，48 题子集，session 粒度，frozen energy）**：
- Phase 2：总体 R@10 = 47.4% → **94.9%**（bm25 检索器）；R@5 = 28.1% → 93.2%；R@1 = 5.8% → **58.6%**
- **session 粒度优于 round**（0.474 vs 0.277）
- L2 QA accuracy：token+openrouter 基线 16.7% → bm25+mimo-v2.5(xiaomi) **58.3%**；Phase Q 加来源标记/排序 ablation 后进一步到 **64.6% (date order) / 66.7% (rank order)**
- multi-session / preference 仍是短板（0.375），需 Phase M 语义层
- 生产默认检索器已切为 **bm25**（Phase R），`token` 仍可通过 `MAFW_SEARCH_RETRIEVER=token` 回退

**设计决定（README 也写了）**：
- 能量默认冻结 0.8（保可复现），`realistic` 模式以 `question_date` 为基准算 0.005/天衰减
- 摄入时 haystack 全文入 `primary_abstraction`，对应"检索器只看 primary_abstraction + cue_anchors" 的事实
- judge prompts 是近似移植（GitHub / HF 直连不通，未拉取官方版），下次获取官方 prompts 请替换 `evaluation/longmemeval/src/judge-prompts.ts`

**运行**（详见 `evaluation/README.md`）：
```bash
# 数据下载（需 hf-mirror.com 可访问）
curl -L -o evaluation/longmemeval/data/longmemeval_s.json \
  https://hf-mirror.com/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json

# L1 检索层
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session

# L2 阅读层（reader + judge）
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l2-qa.ts \
  --l1Run evaluation/longmemeval/results/<ts>/l1-run.jsonl \
  --reader meta-llama/llama-3.1-8b-instruct \
  --judge meta-llama/llama-3.1-70b-instruct \
  --apiUrl https://openrouter.ai/api/v1/chat/completions \
  --apiKeyProvider openrouter
```
