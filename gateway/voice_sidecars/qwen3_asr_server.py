#!/usr/bin/env python3
"""Qwen3-ASR streaming sidecar for MAFW Voice Runtime v2.

Protocol (must match gateway/src/voice/engines/asr/qwen3-vllm.ts):
  WS /stream
    client -> {"type":"start","language":"zh","sampleRate":16000}
    client -> binary PCM16 16 kHz mono frames
    client -> {"type":"end"} / {"type":"abort"}
    server -> {"type":"partial","text":"..."}
    server -> {"type":"final","text":"...","language":"zh","durationMs":123}
    server -> {"type":"error","message":"..."}
  POST /transcribe {"audio_b64":"...","language":"zh","sampleRate":16000}
  GET /health -> {"ok":true}

This sidecar is intentionally thin: model ownership stays in qwen-asr/vLLM;
the gateway speaks a small JSON protocol over the local loopback.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import os
import time
from typing import Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from qwen_asr import Qwen3ASRModel

app = FastAPI(title="MAFW Qwen3-ASR Sidecar")
_model: Optional[Qwen3ASRModel] = None
_model_lock = asyncio.Lock()

# The gateway protocol uses short ISO-ish codes, while qwen-asr validates
# case-sensitive English language names ("zh" is rejected).
_LANGUAGE_ALIASES = {
    "zh": "Chinese", "zh-cn": "Chinese", "zh-hans": "Chinese",
    "en": "English", "en-us": "English", "en-gb": "English",
    "yue": "Cantonese", "ar": "Arabic", "de": "German", "fr": "French",
    "es": "Spanish", "pt": "Portuguese", "id": "Indonesian", "it": "Italian",
    "ko": "Korean", "ru": "Russian", "th": "Thai", "vi": "Vietnamese",
    "ja": "Japanese", "tr": "Turkish", "hi": "Hindi", "ms": "Malay",
    "nl": "Dutch", "sv": "Swedish", "da": "Danish", "fi": "Finnish",
    "pl": "Polish", "cs": "Czech", "fil": "Filipino", "fa": "Persian",
    "el": "Greek", "ro": "Romanian", "hu": "Hungarian", "mk": "Macedonian",
}


def _language_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw or raw.lower() == "auto":
        return None
    return _LANGUAGE_ALIASES.get(raw.lower(), raw)


def _resample(wav: np.ndarray, sr: int, target: int = 16000) -> np.ndarray:
    if sr == target:
        return wav.astype(np.float32, copy=False)
    wav = wav.astype(np.float32, copy=False)
    duration = wav.shape[0] / float(sr)
    n = int(round(duration * target))
    if n <= 0:
        return np.zeros((0,), dtype=np.float32)
    old = np.linspace(0.0, duration, num=wav.shape[0], endpoint=False)
    new = np.linspace(0.0, duration, num=n, endpoint=False)
    return np.interp(new, old, wav).astype(np.float32)


def _load_model(model_id: str, gpu_memory_utilization: float) -> Qwen3ASRModel:
    global _model
    if _model is None:
        _model = Qwen3ASRModel.LLM(
            model=model_id,
            gpu_memory_utilization=gpu_memory_utilization,
            max_new_tokens=int(APP_STATE["max_new_tokens"]),
            max_model_len=int(APP_STATE["max_model_len"]),
        )
    return _model


async def _get_model() -> Qwen3ASRModel:
    # Model load is blocking and can take a long time; keep the event loop free.
    async with _model_lock:
        return await asyncio.to_thread(
            _load_model, APP_STATE["model"], APP_STATE["gpu"]
        )


APP_STATE = {
    "model": "Qwen/Qwen3-ASR-1.7B",
    "gpu": 0.6,
    "max_new_tokens": 256,
    "max_model_len": 8192,
    # 160 ms is the gateway's streaming step. It is the largest chunk that
    # keeps the first-partial p50 under the 200 ms P1 budget.
    "chunk_sec": 0.16,
    "unfixed_chunk_num": 2,
    "unfixed_token_num": 5,
}


class TranscribeRequest(BaseModel):
    audio_b64: str
    language: Optional[str] = None
    sampleRate: int = 16000


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "model": APP_STATE["model"],
        "chunkSizeSec": APP_STATE["chunk_sec"],
        "maxModelLen": APP_STATE["max_model_len"],
    }


@app.post("/transcribe")
async def transcribe(req: TranscribeRequest) -> dict:
    model = await _get_model()
    raw = base64.b64decode(req.audio_b64)
    wav, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
    wav = _resample(np.asarray(wav, dtype=np.float32), int(sr))
    started = time.perf_counter()
    results = await asyncio.to_thread(
        model.transcribe,
        audio=(wav, 16000),
        language=_language_name(req.language),
    )
    first = results[0] if results else None
    return {
        "text": getattr(first, "text", "") if first is not None else "",
        "language": getattr(first, "language", req.language) if first is not None else req.language,
        "durationMs": round((len(wav) / 16000.0) * 1000),
        "elapsedMs": round((time.perf_counter() - started) * 1000),
    }


@app.websocket("/stream")
async def stream(ws: WebSocket) -> None:
    await ws.accept()
    state = None
    total_samples = 0
    last_partial = ""
    pending = np.zeros((0,), dtype=np.float32)
    # 160 ms steps plus a 160 ms streaming chunk keep the first-partial p50
    # under the 200 ms P1 budget. Measured on the 4090 Laptop reference:
    # p50 172 ms / p95 186 ms over 31 samples with zero empty finals. Re-run
    # the benchmark before changing this step or the chunk size.
    step_samples = 2560  # 160 ms @ 16 kHz
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if "bytes" in msg and msg["bytes"] is not None:
                if state is None:
                    await ws.send_json({"type": "error", "message": "send start first"})
                    continue
                pcm = np.frombuffer(msg["bytes"], dtype=np.int16).astype(np.float32) / 32768.0
                if pcm.size == 0:
                    continue
                total_samples += int(pcm.size)
                pending = np.concatenate((pending, pcm))
                if pending.size < step_samples:
                    continue
                model = await _get_model()
                await asyncio.to_thread(model.streaming_transcribe, pending, state)
                pending = np.zeros((0,), dtype=np.float32)
                text = getattr(state, "text", "") or ""
                if text and text != last_partial:
                    last_partial = text
                    await ws.send_json({"type": "partial", "text": text})
                continue

            text = msg.get("text")
            if not text:
                continue
            try:
                ctrl = __import__("json").loads(text)
            except Exception:
                await ws.send_json({"type": "error", "message": "invalid json"})
                continue

            kind = ctrl.get("type")
            if kind == "start":
                model = await _get_model()
                state = model.init_streaming_state(
                    language=_language_name(ctrl.get("language")),
                    unfixed_chunk_num=int(APP_STATE["unfixed_chunk_num"]),
                    unfixed_token_num=int(APP_STATE["unfixed_token_num"]),
                    chunk_size_sec=float(APP_STATE["chunk_sec"]),
                )
                total_samples = 0
                last_partial = ""
                pending = np.zeros((0,), dtype=np.float32)
                await ws.send_json({"type": "partial", "text": ""})
            elif kind == "end":
                if state is None:
                    await ws.send_json({"type": "error", "message": "send start first"})
                    continue
                model = await _get_model()
                if pending.size:
                    await asyncio.to_thread(model.streaming_transcribe, pending, state)
                    pending = np.zeros((0,), dtype=np.float32)
                await asyncio.to_thread(model.finish_streaming_transcribe, state)
                await ws.send_json({
                    "type": "final",
                    "text": getattr(state, "text", "") or "",
                    "language": getattr(state, "language", None),
                    "durationMs": round((total_samples / 16000.0) * 1000),
                })
                state = None
                total_samples = 0
                last_partial = ""
            elif kind == "abort":
                state = None
                total_samples = 0
                last_partial = ""
                pending = np.zeros((0,), dtype=np.float32)
            else:
                await ws.send_json({"type": "error", "message": f"unknown control: {kind}"})
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001 - report to the client, keep serving
        try:
            await ws.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="Qwen/Qwen3-ASR-1.7B")
    parser.add_argument("--port", type=int, default=3911)
    parser.add_argument("--gpu-memory-utilization", type=float, default=0.6)
    parser.add_argument("--cache-dir", default=os.path.expanduser("~/.mafw/models/voice"))
    parser.add_argument("--max-new-tokens", type=int, default=256)
    parser.add_argument("--max-model-len", type=int, default=8192)
    parser.add_argument("--chunk-size-sec", type=float, default=0.16)
    parser.add_argument("--unfixed-chunk-num", type=int, default=2)
    parser.add_argument("--unfixed-token-num", type=int, default=5)
    args = parser.parse_args()

    os.makedirs(args.cache_dir, exist_ok=True)
    os.environ.setdefault("HF_HOME", os.path.join(args.cache_dir, "hf"))
    APP_STATE["model"] = args.model
    APP_STATE["gpu"] = args.gpu_memory_utilization
    APP_STATE["max_new_tokens"] = args.max_new_tokens
    APP_STATE["max_model_len"] = args.max_model_len
    APP_STATE["chunk_sec"] = args.chunk_size_sec
    APP_STATE["unfixed_chunk_num"] = args.unfixed_chunk_num
    APP_STATE["unfixed_token_num"] = args.unfixed_token_num

    # Warm the model before serving /health; the gateway's startup budget
    # (default 180 s) accounts for the first download/load.
    _load_model(args.model, args.gpu_memory_utilization)

    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
