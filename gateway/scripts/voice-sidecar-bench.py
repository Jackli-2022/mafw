#!/usr/bin/env python3
"""Measure Qwen3-ASR sidecar streaming latency directly.

This is the sidecar-level companion to `voice-bench.ts`. It exists so the P1
model/latency baseline can be measured even when the gateway is running on a
different OS/venv than the Python sidecar (for example WSL2 on Windows).

Protocol (see `gateway/voice_sidecars/qwen3_asr_server.py`):
  start -> binary PCM16 16 kHz frames -> end
  <- partial (possibly empty) / final / error

The report separates:
  firstPartialMs: first non-empty partial, measured from the first audio frame
  finalMs:        final result, measured from sending `end`
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import websockets


@dataclass
class Sample:
    fixture: str
    first_partial_ms: float | None
    final_ms: float
    text: str
    duration_ms: float


def read_pcm16(path: Path) -> tuple[bytes, int]:
    with wave.open(str(path), "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise ValueError(f"{path}: expected mono PCM16, got {wf.getnchannels()}ch/{wf.getsampwidth()}B")
        if wf.getframerate() != 16000:
            raise ValueError(f"{path}: expected 16000 Hz, got {wf.getframerate()}")
        return wf.readframes(wf.getnframes()), wf.getframerate()


def p50(values: Iterable[float | None]) -> float | None:
    clean = [v for v in values if v is not None]
    return round(statistics.median(clean), 1) if clean else None


async def run_once(url: str, fixture: Path, step_ms: int, pace: str, timeout_s: float) -> Sample:
    pcm, _ = read_pcm16(fixture)
    step_bytes = max(2, int(16000 * (step_ms / 1000.0)) * 2)
    first_partial_ms: float | None = None
    final_ms: float | None = None
    final_text = ""
    final_duration_ms = 0.0
    started: float | None = None
    ended: float | None = None

    async with websockets.connect(url, max_size=8 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"type": "start", "language": "zh", "sampleRate": 16000}))
        # The sidecar sends an empty partial on start; consume it before audio.
        start_ack = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout_s))
        if start_ack.get("type") == "error":
            raise RuntimeError(start_ack.get("message", "sidecar start failed"))

        async def receive() -> None:
            nonlocal first_partial_ms, final_ms, final_text, final_duration_ms
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout_s)
                if isinstance(raw, bytes):
                    continue
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind == "partial":
                    if first_partial_ms is None and msg.get("text"):
                        first_partial_ms = (time.perf_counter() - started) * 1000 if started else None
                elif kind == "final":
                    final_ms = (time.perf_counter() - ended) * 1000 if ended else 0.0
                    final_text = str(msg.get("text") or "")
                    final_duration_ms = float(msg.get("durationMs") or 0)
                    return
                elif kind == "error":
                    raise RuntimeError(msg.get("message", "sidecar error"))

        receiver = asyncio.create_task(receive())
        started = time.perf_counter()
        for offset in range(0, len(pcm), step_bytes):
            if receiver.done():
                await receiver
            await ws.send(pcm[offset : offset + step_bytes])
            if pace == "real":
                await asyncio.sleep(step_ms / 1000.0)
        ended = time.perf_counter()
        await ws.send(json.dumps({"type": "end"}))
        await asyncio.wait_for(receiver, timeout=timeout_s)

    if final_ms is None:
        raise RuntimeError("sidecar closed without final")
    return Sample(
        fixture=fixture.name,
        first_partial_ms=round(first_partial_ms, 1) if first_partial_ms is not None else None,
        final_ms=round(final_ms, 1),
        text=final_text,
        duration_ms=final_duration_ms,
    )


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:3911/stream")
    parser.add_argument("--fixtures", default="docs/fixtures/voice")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--step-ms", type=int, default=160)
    parser.add_argument("--pace", choices=["real", "fast"], default="real")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--json", default="")
    args = parser.parse_args()

    fixtures = sorted(Path(args.fixtures).glob("*.wav"))
    if not fixtures:
        raise SystemExit(f"no wav fixtures under {args.fixtures}")

    samples: list[Sample] = []
    total = args.warmup + len(fixtures) * args.repeat
    n = 0
    for fixture in fixtures:
        for repeat in range(args.repeat):
            n += 1
            is_warmup = n <= args.warmup
            try:
                sample = await run_once(args.url, fixture, args.step_ms, args.pace, args.timeout)
            except Exception as exc:
                print(f"[{n}/{total}] {fixture.name} ERROR: {exc}", flush=True)
                continue
            if is_warmup:
                print(f"[{n}/{total}] {fixture.name} warmup {sample.first_partial_ms}ms/{sample.final_ms}ms", flush=True)
                continue
            samples.append(sample)
            print(
                f"[{n}/{total}] {fixture.name} first={sample.first_partial_ms}ms "
                f"final={sample.final_ms}ms text={sample.text!r}",
                flush=True,
            )

    report = {
        "url": args.url,
        "fixtures": len(fixtures),
        "repeat": args.repeat,
        "samples": len(samples),
        "stepMs": args.step_ms,
        "pace": args.pace,
        "firstPartialP50": p50(s.first_partial_ms for s in samples),
        "firstPartialP95": round(sorted(
            [s.first_partial_ms for s in samples if s.first_partial_ms is not None]
        )[max(0, int(len([s for s in samples if s.first_partial_ms is not None]) * 0.95) - 1)], 1)
        if any(s.first_partial_ms is not None for s in samples) else None,
        "finalP50": p50(s.final_ms for s in samples),
        "empty": sum(1 for s in samples if not s.text.strip()),
        "results": [asdict(s) for s in samples],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
