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
            max_new_tokens=256,
        )
    return _model


async def _get_model() -> Qwen3ASRModel:
    # Model load is blocking and can take a long time; keep the event loop free.
    async with _model_lock:
        return await asyncio.to_thread(
            _load_model, APP_STATE["model"], APP_STATE["gpu"]
        )


APP_STATE = {"model": "Qwen/Qwen3-ASR-1.7B", "gpu": 0.6}


class TranscribeRequest(BaseModel):
    audio_b64: str
    language: Optional[str] = None
    sampleRate: int = 16000


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


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
        language=req.language or None,
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
    # 160 ms chunks leave room inside the 200 ms first-partial budget. Qwen's
    # examples only demonstrate 0.5-4 s steps, so P1's benchmark must validate
    # that 160 ms partials are stable; if not, fall back to 500 ms and relax
    # the first-partial target.
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
                    unfixed_chunk_num=2,
                    unfixed_token_num=5,
                    chunk_size_sec=2.0,
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
    args = parser.parse_args()

    os.makedirs(args.cache_dir, exist_ok=True)
    os.environ.setdefault("HF_HOME", os.path.join(args.cache_dir, "hf"))
    APP_STATE["model"] = args.model
    APP_STATE["gpu"] = args.gpu_memory_utilization

    # Warm the model before serving /health; the gateway's startup budget
    # (default 180 s) accounts for the first download/load.
    _load_model(args.model, args.gpu_memory_utilization)

    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
