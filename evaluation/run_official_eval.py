#!/usr/bin/env python3
"""Run EvalScope official-dataset evaluation of the main agent's A2A multimodal chain.

Main agent: opencode-go/deepseek-v4-flash (text-only) — it must ingest the media
pointer, call mafw_media_ask (A2A -> MediaAgent -> pi -> multimodal model), and
answer. Dataset metrics are rule-based (acc / wer); `analysis_report` additionally
uses an LLM (deepseek-v4-pro via zen/go) to generate a structured Chinese analysis
of the results (Report.analysis).

Datasets (small-sample first; `limit` slices the first N records):
  real_world_qa  — image VQA, test split, acc metric (needs "ANSWER: xxx")
  tvbench        — video MCQ (action_count), train split, acc (needs "ANSWER: X")
  fleurs         — audio ASR (cmn_hans_cn), test split, wer (raw transcription)

Each dataset runs as its own `run_task` so a download/eval failure in one does
not abort the others.

Usage:
  evaluation/.venv/Scripts/python.exe evaluation/run_official_eval.py [dataset] [limit]
  dataset: real_world_qa | tvbench | fleurs | all (default all)
  limit:   int sample count (default per-dataset LIMITS; a positional int overrides all)
"""

# 必须在 import evalscope 之前设置（constants 在 import 时读取）。
import os

os.environ.setdefault("EVALSCOPE_LANGUAGE", "zh")

import json  # noqa: E402
import sys  # noqa: E402

from evalscope.run import run_task  # noqa: E402
from evalscope.config import TaskConfig  # noqa: E402

GATEWAY_URL = os.environ.get("MAFW_EVAL_URL", "http://127.0.0.1:3000/api/eval/chat/completions")

# Analysis 生成模型（opencode-go, text）。复用 opencode auth key。
ZEN_GO_URL = os.environ.get("MAFW_ZEN_GO_URL", "https://opencode.ai/zen/go/v1")
JUDGE_MODEL = os.environ.get("MAFW_JUDGE_MODEL", "deepseek-v4-pro")

DATASETS = ["real_world_qa", "tvbench", "fleurs"]

# 每数据集独立样本数（all 模式默认值；可按需调整）
LIMITS = {
    "real_world_qa": 60,
    "tvbench": 40,
    "fleurs": 50,
}

DATASET_ARGS = {
    # TVBench defaults to action_count subset already; explicit for clarity.
    "tvbench": {"subset_list": ["action_count"]},
    # FLEURS defaults to 3 subsets (~1.8GB); pin to Mandarin only for small runs.
    "fleurs": {"subset_list": ["cmn_hans_cn"]},
}


def load_judge_key() -> str:
    auth_path = os.path.join(
        os.environ.get("USERPROFILE", os.path.expanduser("~")),
        ".local", "share", "opencode", "auth.json",
    )
    with open(auth_path, "r", encoding="utf-8") as f:
        auth = json.load(f)
    key = (auth.get("opencode-go") or {}).get("key")
    if not key:
        raise RuntimeError("opencode-go key not found in auth.json; connect opencode-go first")
    return key


def run_one(dataset: str, limit: int) -> None:
    print(f"\n=== [official-eval] {dataset} limit={limit} ===", flush=True)
    args = dict(DATASET_ARGS.get(dataset, {}))
    judge_key = load_judge_key()
    task_cfg = TaskConfig(
        model="opencode-go/deepseek-v4-flash",
        api_url=GATEWAY_URL,
        api_key="EMPTY",
        eval_type="openai_api",
        datasets=[dataset],
        dataset_args={dataset: args},
        limit=limit,
        generation_config={"temperature": 0.0, "max_tokens": 512},
        # LLM 生成结构化中文分析（dataset 指标仍为 rule-based，不受影响）。
        analysis_report=True,
        judge_model_args={
            "model_id": JUDGE_MODEL,
            "api_url": ZEN_GO_URL,
            "api_key": judge_key,
            "generation_config": {"temperature": 0.0, "max_tokens": 1024},
        },
    )
    try:
        result = run_task(task_cfg=task_cfg)
        print(result)
    except Exception as e:  # noqa: BLE001 — keep other datasets running
        print(f"[official-eval] {dataset} FAILED: {e}")


def main() -> None:
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    datasets = DATASETS if arg == "all" else [arg]
    if arg not in DATASETS and arg != "all":
        print(f"unknown dataset {arg}; choose from {DATASETS}")
        sys.exit(1)
    if len(sys.argv) > 2:
        limit = int(sys.argv[2])
        for ds in datasets:
            run_one(ds, limit)
    else:
        for ds in datasets:
            run_one(ds, LIMITS.get(ds, 5))


if __name__ == "__main__":
    main()
