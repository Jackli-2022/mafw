# MAFW Evaluation

评测 MAFW 各子系统的基准集合。

## 1. 多模态（Media EvalScope）

评测 **主 agent（opencode-go/deepseek-v4-flash，纯文本）** 通过 **A2A 与多模态模型对话**的多模态能力（端到端）。

### 被测链路

```
EvalScope（general_vqa 数据集 + openai_api 入口 + LLM-judge）
  → POST <gateway>/api/eval/chat/completions（适配端点）
      → 媒体（image_url / input_audio / video_url）→ opencode 会话 file part
      → 主 agent（opencode-go/deepseek-v4-flash，纯文本）：
          media-ingest → [媒体附件] 指针 → 自主调 mafw_media_ask
          → A2A → MediaAgent → pi adapter → xiaomi/mimo-v2.5 分析媒体
      → 等 session.idle → 最终回答
  → judge：opencode-go/minimax-m3（LLM，避免自评）→ 准确率
```

### 前置

1. **Gateway 运行**（含适配端点 `/api/eval/chat/completions`）：
   ```bash
   mafw daemon        # 或前台 node gateway/dist/index.js
   curl http://127.0.0.1:3000/health
   ```
2. **Python 环境**（venv 已建，Python 3.12）：
   ```bash
   evaluation\.venv\Scripts\python.exe -m pip install evalscope   # 网络慢可用 -i https://pypi.tuna.tsinghua.edu.cn/simple
   ```
3. **opencode 已 connect**：`opencode-go`（主 agent 用）与 `xiaomi`（媒体模型）凭据在 `~/.local/share/opencode/auth.json`

### 运行

```bash
# 1. 构建数据集（本地素材 → media-bench/general_vqa/media_bench.jsonl）
evaluation\.venv\Scripts\python.exe evaluation\build_dataset.py

# 2. 跑评测
evaluation\.venv\Scripts\python.exe evaluation\run_media_eval.py
```

评测结束终端输出表格（`mean_acc` 准确率 + BLEU/Rouge）。

### 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `MAFW_EVAL_URL` | `http://127.0.0.1:3000/api/eval/chat/completions` | 适配端点 |
| `MAFW_JUDGE_MODEL` | `minimax-m3` | judge 模型（opencode-go） |
| `MAFW_ZEN_GO_URL` | `https://opencode.ai/zen/go/v1` | judge API |

主 agent 模型固定 `opencode-go/deepseek-v4-flash`（eval-endpoint.ts 内配置，可改）。

### 扩展：标准基准

`build_dataset.py` 当前用本地素材手写样本。要接入标准基准（RealWorldQA 图 / TVBench 视频 / Fleurs 音频），拉取 hf/ModelScope 数据后按相同 JSONL 形状输出（媒体本地路径或 data URL + `answer`）。

### 文件

- `build_dataset.py` — 生成 general_vqa JSONL（本地素材 + 手写答案）
- `run_media_eval.py` — EvalScope 评测运行器（TaskConfig + LLM-judge）
- `gateway/src/eval-endpoint.ts` — 适配端点（媒体 → 主 agent 会话 → 回答）
- `tests/unit/gateway/eval-endpoint.test.ts` — 适配端点单测

## 2. LongMemEval 谐波记忆基准

评测 MAFW 谐波记忆系统的检索质量与下游 QA 准确率，基于 [LongMemEval (arXiv:2410.10813, ICLR 2025)](https://arxiv.org/abs/2410.10813) 的 S 集（500 题，~50 haystack sessions 题）。TS runner 直接 import gateway 类，tmpDir 隔离存储，**不污染**真实 `~/.mafw`，不需启动 gateway 实例。

### 三档评测

| 层 | 内容 | 成本 |
|---|---|---|
| **L1 检索层** | haystack 确定性灌入 → `HarmonicIndexManager.search(question, k)` → Recall@k / NDCG@k（per-session，对 answer_session_ids） | 纯本地，分级 |
| **L2 阅读层** | L1 top-k → reader LLM → judge LLM 官方 per-type prompt 判分 | 48 题子集，~96 LLM 调用 |
| **L3 端到端** | 复用 `/api/eval/chat/completions` 逐轮 replay 真实 agent | **本期未实现**，后续 |

### 数据集获取

由于 GitHub / HuggingFace 直连不通，本项目用 `xiaowu0162/longmemeval-cleaned`（官*/推荐版，去除了干扰性 noise session）。提前手动下载到 `data/`:

```bash
# 在能访问 hf-mirror 的环境下载
curl -L -o evaluation/longmemeval/data/longmemeval_s.json \
  https://hf-mirror.com/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json
```

数据集约 277 MB，**加入 .gitignore**。

### 运行

```bash
# L1 检索基准（默认 8 题/类，round 粒度，energy 冻结 0.8）
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity round

# 对比 session 粒度
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session

# L1 BM25 ablation（检索器可选 bm25；默认 token）
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session --retriever bm25

# L2 QA（需 OpenAI 兼容端点；mimo-v2.5 建议走 xiaomi 直连）
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l2-qa.ts \
  --l1Run evaluation/longmemeval/results/<timestamp>/l1-run.jsonl \
  --reader mimo-v2.5 \
  --judge mimo-v2.5 \
  --apiUrl https://api.xiaomimimo.com/v1/chat/completions \
  --apiKeyProvider xiaomi

# 报告生成（多个 run 合并）
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/report.ts
```

产物：`results/<timestamp>/l1-run.jsonl`、`l1-summary.json`、`l2-qa.jsonl`、`l2-summary.json`、`report.md`。

### 已知偏差与设计决定

1. **检索器实现**：当前 `HarmonicIndexManager.search()` 默认是「query 分词 regex 计数 × energy」；可通过 `--retriever bm25` 启用 BM25（k1=1.2, b=0.75）× energy。两种检索器都扫描 `primary_abstraction + cue_anchors`，不扫 `memory_value`。
2. **检索仅查 `primary_abstraction + cue_anchors`**（`memory_value` 不被 search 扫到）。摄入时将 haystack round 全文写入 `primary_abstraction`，与 production 的「agent 写 6-8 词摘要」不同 — 本期仅测检索器，未测 agent 写入决策（后者需 L3）。
3. **能量默认冻结 0.8**，对应 `energyMode=frozen`；`realistic` 模式以 `question_date` 为基准计入 0.005/天衰减。
4. **judge prompts 为近似移植**（GitHub / HF 直连不通，未拉取官方版本），结构对齐（per-type，输出 `{score:0/1, reason}`），`judge-prompts.ts` 顶部注释了这点。下次获取到官方 prompts 请替换。
5. **session 粒度 baseline 优于 round**（R@10 0.474 vs 0.277），与论文 round > session 结论相反 — 说明在 MAFW 现有 token 计数检索器下，session 聚合关键词反而有利。
6. **BM25 改造结果（Phase 2）**：session 粒度 R@10 从 token 的 0.474 提升到 **0.949**（6/6 类提升，1000 entries 约 2-3ms），`single-session-assistant` 从 0% → 100%。L2 QA 用 mimo-v2.5 经 xiaomi 直连从 token+openrouter 基线 0.167 提升到 **0.583**。默认 retriever 保持 `token`，BM25 为 opt-in。
7. **`single-session-assistant` 检索为 0%**：在 token 检索器下为 0%；BM25 检索器将其提升到 100%。
8. 数据集中 `*_abs` 后缀的题** 即 absertion 题，保留 `question_type` 不变（与原 issue 有关证据相同，但期望拒答）；计分列为同型组。
9. **L2 运行注意**：opencode-go 网关会把 `mimo-v2.5` 路由到 openrouter 且可能 402 余额不足，建议 `--apiUrl https://api.xiaomimimo.com/v1/chat/completions --apiKeyProvider xiaomi` 直连小米；mimo-v2.5 作为 judge 时 `max_tokens` 已提至 1024（原 256 会导致 reasoning 耗尽、content 为空）。

### 文件结构

```
evaluation/longmemeval/
├── data/longmemeval_s.json       # 数据（gitignored）
├── results/                      # 运行产物（gitignored）
└── src/
    ├── dataset.ts                # loader + 校验 + 分层采样（mulberry32）
    ├── metrics.ts                # recall@k / ndcg@k / by-type aggregation
    ├── ingest.ts                 # haystack → HarmonicUnit（tmpDir 隔离）
    ├── llm.ts                    # OpenAI 兼容的 chat helper + auth.json 读 key
    ├── judge-prompts.ts          # per-type judge prompt（近似版）
    ├── l1-retrieval.ts           # L1 runner（CLI）
    ├── l2-qa.ts                  # L2 runner（reader + judge）
    ├── report.ts                 # 报告生成（多处 run 合并）
    └── types.ts                  # JSON 行 schema
tests/unit/eval/
├── longmemeval-metrics.test.ts
└── longmemeval-ingest.test.ts
```

### 后续扩展

- L3 端到端：复用 `/api/eval/chat/completions` 逐轮 replay haystack 到主 agent，依赖 memory-guide 等机制自主写入
- 检索器改造对比变量：真 BM25 接入 / key expansion / time-aware query expansion
- 全量 500 题跑一遍
- 官方 judge prompts 移植

