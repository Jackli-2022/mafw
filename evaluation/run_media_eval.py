#!/usr/bin/env python3
"""Run the EvalScope evaluation of the main agent's A2A multimodal chain.

Main agent: opencode-go/deepseek-v4-flash (text-only) — it must ingest the
media pointer, call mafw_media_ask (A2A → MediaAgent → pi → multimodal model),
and answer. Judge: opencode-go/minimax-m3 (LLM judge, avoids self-eval).

Usage:
  evaluation/.venv/Scripts/python.exe evaluation/run_media_eval.py
"""

import json
import os
from evalscope.run import run_task
from evalscope.config import TaskConfig
from evalscope.constants import JudgeStrategy

GATEWAY_URL = os.environ.get("MAFW_EVAL_URL", "http://127.0.0.1:3000/api/eval/chat/completions")

# Judge model (opencode-go, text). Reuse the opencode auth key.
ZEN_GO_URL = os.environ.get("MAFW_ZEN_GO_URL", "https://opencode.ai/zen/go/v1")
JUDGE_MODEL = os.environ.get("MAFW_JUDGE_MODEL", "deepseek-v4-pro")


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


def main():
    judge_key = load_judge_key()

    task_cfg = TaskConfig(
        model="opencode-go/deepseek-v4-flash",
        api_url=GATEWAY_URL,
        api_key="EMPTY",
        eval_type="openai_api",
        datasets=["general_vqa"],
        dataset_args={
            "general_vqa": {
                "local_path": str(
                    os.path.join(os.path.dirname(__file__), "media-bench", "general_vqa")
                ),
                "subset_list": ["media_bench"],
            }
        },
        judge_model_args={
            "model_id": JUDGE_MODEL,
            "api_url": ZEN_GO_URL,
            "api_key": judge_key,
            "generation_config": {"temperature": 0.0, "max_tokens": 1024},
        },
        judge_strategy=JudgeStrategy.LLM,
        judge_worker_num=1,
    )

    result = run_task(task_cfg=task_cfg)
    print(result)


if __name__ == "__main__":
    main()
