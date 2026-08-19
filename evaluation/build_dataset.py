#!/usr/bin/env python3
"""Build the general_vqa evaluation dataset for the A2A multimodal chain.

Samples reference local media files (image / video / audio) plus a question
and a reference answer. EvalScope sends the media reference (local path) to
the gateway eval endpoint, which reads the file, injects it into a main-agent
session, and returns the agent's final answer. An LLM judge scores the answer
against the reference (semantic, not exact).

To extend with standard benchmarks later: pull RealWorldQA / TVBench / Fleurs
samples and emit the same JSONL shape (media as local path or data URL).
"""

import json
import os
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
OUT_DIR = HERE / "media-bench" / "general_vqa"
OUT_FILE = OUT_DIR / "media_bench.jsonl"

# Local media assets (relative to the repo root; resolve at build time).
REPO = HERE.parent

# (media_rel_path, mime_kind, question, answer)
# kind ∈ {image_url, input_audio, video_url}
# 参考答案基于真实媒体内容（经 MediaAgent 多模态分析验证），
# 与 opencode 官方数据动画（opencode.ai/data）实际展示一致。
SAMPLES = [
    {
        "media": "opencode-dev/artifacts/glm52-rise-video/out/june-totals.png",
        "kind": "image_url",
        "question": "这个图表展示的是什么内容？请简要说明它最重要的信息。",
        "answer": "OpenCode Go 平台 2026 年 6 月的月度数据回顾图：当月处理了约 73T tokens、6.5 亿次请求、1100 万会话，展示平台极高的活跃度与处理规模。",
    },
    {
        "media": "opencode-dev/artifacts/glm52-rise-video/out/flash-share.mp4",
        "kind": "video_url",
        "question": "这段视频展示的是什么？请用一句话概括。",
        "answer": "一个动态柱状图，展示 2026 年 6 月 22 日至 28 日期间 OpenCode Go 平台各 AI 模型的 Token 使用份额分布，DeepSeek V4 Flash 以约 48% 占比领先。",
    },
    {
        "media": "opencode-dev/artifacts/glm52-rise-video/out/nz-sheep.mp4",
        "kind": "video_url",
        "question": "这段视频里主要出现了什么动物？场景大概是什么样的？",
        "answer": "一只绵羊的面部特写，占据画面主体，叠加了 OpenCode Go 的新西兰数据统计动画（如 tokens per sheep 计数、opencode.ai/data 标识），是一个幽默的数据展示视频。",
    },
    {
        "media": "opencode-dev/artifacts/glm52-rise-video/out/minimax-climb.mp4",
        "kind": "video_url",
        "question": "这段视频大致在展示什么内容？请概括主题。",
        "answer": "一个数据可视化动画：MiniMax M3 模型在 OpenCode Go 平台过去五周的 Token 使用量增长趋势柱状图，数值从约 0.01T 爆发式增长到 2.56T（周环比 +23.2%）。",
    },
    {
        "media": "opencode-dev/artifacts/glm52-rise-video/out/glm-52-broke-out.mp4",
        "kind": "video_url",
        "question": "这段视频在展示什么？标题暗示了什么事件？",
        "answer": "一个柱状图动画，展示 GLM-5.2 模型在 2026 年 6 月中旬的爆发式增长：标题 'GLM-5.2 broke out'，副题 'From 0 to 1.67T tokens in a week'，即该模型发布后一周内 Token 使用量从零冲到 1.67T。",
    },
]

IMAGE_B64 = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
SAMPLES.append({
    "media": IMAGE_B64,
    "kind": "image_url",
    "question": "这张图片是什么颜色？",
    "answer": "纯红色（solid red）的纯色块。",
})

ASSETS = HERE / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)


def ensure_tone_wav() -> str:
    """Generate a 1s 440Hz sine WAV if the asset is missing."""
    p = ASSETS / "tone.wav"
    if p.exists():
        return str(p)
    import math
    import struct
    import wave

    sr = 8000
    n = sr
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / sr)))
            for i in range(n)
        )
        w.writeframes(frames)
    return str(p)


SAMPLES.append({
    "media": ensure_tone_wav(),
    "kind": "input_audio",
    "question": "这段音频是什么声音？请简要描述。",
    "answer": "一段连续的哔声/单音（约 440Hz 正弦波测试音）。",
})


def resolve_media(media: str) -> str:
    if media.startswith("data:"):
        return media
    p = pathlib.Path(media)
    if not p.is_absolute():
        p = REPO / p
    if not p.exists():
        raise FileNotFoundError(f"media asset not found: {p}")
    return str(p)


def build():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        for s in SAMPLES:
            media_ref = resolve_media(s["media"])
            if s["kind"] == "image_url":
                part = {"type": "image_url", "image_url": {"url": media_ref}}
            elif s["kind"] == "video_url":
                part = {"type": "video_url", "video_url": {"url": media_ref}}
            else:
                part = {"type": "input_audio", "input_audio": {"data": media_ref, "format": "wav"}}
            record = {
                "messages": [
                    {
                        "role": "user",
                        "content": [{"type": "text", "text": s["question"]}, part],
                    }
                ],
                "answer": s["answer"],
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"wrote {len(SAMPLES)} samples to {OUT_FILE}")


if __name__ == "__main__":
    build()
