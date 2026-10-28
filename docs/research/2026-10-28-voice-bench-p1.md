# Voice Runtime P1 benchmark (Qwen3-ASR-1.7B)

> Date: 2026-10-28
> Reference machine: RTX 4090 Laptop 16 GB / i9-13900H / 32 GB RAM / Windows 11
> Status: **BLOCKED — harness implemented and unit-tested; manual 4090 measurement not run.**

## Why blocked

The local Python environment does not have the Qwen3-ASR runtime installed:

```
python -c "import importlib.util; print(bool(importlib.util.find_spec('qwen_asr')), bool(importlib.util.find_spec('vllm')))"
# False False
```

No 16 kHz mono PCM16 fixture is checked into the repo. Installing
`qwen-asr[vllm]` downloads vLLM and the ~4.4 GB Qwen3-ASR-1.7B weights; that is
a deliberate setup step, not something the implementation should do silently.

## Harness

`gateway/scripts/voice-bench.ts` connects to `/ws/voice`, streams a 16 kHz mono
PCM16 WAV, and reports first-partial and final latency.

```bash
# terminal 1: sidecar
python gateway/voice_sidecars/qwen3_asr_server.py \
  --model Qwen/Qwen3-ASR-1.7B --port 3911 --gpu-memory-utilization 0.6

# terminal 2: gateway
npm run dev --prefix gateway

# terminal 3: benchmark
npx ts-node gateway/scripts/voice-bench.ts \
  --url ws://127.0.0.1:3000/ws/voice \
  --wav docs/fixtures/voice/zh-01.wav --repeat 3
```

Acceptance from the design: first partial p50 ≤ 200 ms, final p50 ≤ 300 ms
(hot model, 30 clips).

## What is verified

- `summarizeBench` unit test passes (p50 + empty count).
- `npm run build --prefix gateway` exits 0.
- `/ws/voice` unit test passes with a fake session.
- The sidecar adapter unit test passes against a real `ws` server.

## Next step

After installing the sidecar environment and adding a 16 kHz mono PCM16
fixture, run the command above and replace this file with the measured JSON.
Until then, P1 latency remains unverified.
