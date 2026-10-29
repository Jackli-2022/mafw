# Voice Runtime P1 benchmark (Qwen3-ASR-1.7B)

> Date: 2026-10-29
> Commit: `03f6bdb6`
> Reference machine: RTX 4090 Laptop 16 GB / i9-13900H / 32 GB RAM / Windows 11
> Status: **measured**. Sidecar first-partial p50 **171.8 ms**; gateway `/ws/voice` p50 **180 ms**.

## Setup

- Windows host + WSL2 Ubuntu (Python 3.12.3). vLLM is Linux-only; the sidecar runs in WSL2.
- `torch 2.9.1+cu128`, `vllm 0.14.0`, `qwen-asr 0.0.6`.
- Model: `Qwen/Qwen3-ASR-1.7B`, downloaded from ModelScope to
  `/home/ubuntu/.mafw/models/voice/Qwen3-ASR-1.7B-ms` (4.4 GB snapshot).
- Sidecar flags:
  `--max-model-len 8192 --gpu-memory-utilization 0.6 --chunk-size-sec 0.16 --max-new-tokens 256`.
- Fixtures: 11 synthetic Chinese clips generated with MiMo TTS, converted to
  16 kHz mono PCM16 WAV (`docs/fixtures/voice/zh-01.wav` … `zh-11.wav`).
- Each fixture was run 3 times. Sidecar runs use 2 warmups; the gateway harness
  does not add warmups, so one cold outlier is visible below.

## Results

### Sidecar direct (`/stream`, 20 ms PCM frames)

31 measured samples (33 runs minus 2 warmups):

| Metric | p50 | p95 | max |
|---|---:|---:|---:|
| First non-empty partial | **171.8 ms** | 186.0 ms | 186.5 ms |
| Final after `end` | **33.1 ms** | 50.9 ms | 59.2 ms |

Empty finals: **0**.

### Gateway `/ws/voice` (real transport + session + ASR adapter)

33 measured samples (11 fixtures × 3):

| Metric | p50 | p95 | max |
|---|---:|---:|---:|
| First non-empty partial | **180 ms** | 200 ms | 485 ms |
| Final after `end_audio` | **50 ms** | 67 ms | 68 ms |

Empty finals: **0**. The 485 ms max is one cold/first-request outlier; the
remaining first-partial samples are 167–192 ms.

Raw reports:

- `docs/research/2026-10-29-voice-bench-sidecar.json`
- `docs/research/2026-10-29-voice-bench-gateway.json`

## Interpretation

The dGPU P1 targets are met with a 160 ms streaming chunk:

- first partial p50 ≤ 200 ms
- final p50 ≤ 300 ms

The previous sidecar default used `chunk_size_sec=2.0`, which quantized the
first partial to roughly 2 s regardless of the 160 ms audio step. The default is
now `0.16`; the 20 ms adapter frames still produce stable final text across all
11 fixtures.

**Deployment caveat:** the gateway benchmark used the real gateway voice
classes (`attachVoiceSocket` → `VoiceSession` → `Qwen3AsrEngine`) through
`gateway/scripts/voice-bench-server.ts`, with the sidecar in WSL2 reached via
Windows localhost forwarding. It did **not** exercise
`MafwScheduler.getVoiceRuntime()`'s default Windows Python spawn. On a Windows
host, vLLM must run in WSL2/Linux and the gateway needs an external-sidecar
configuration (or must run in the same Linux environment); the default
`python` spawn will not find vLLM on Windows.

## Reproduction

```bash
# WSL2: sidecar (from the repo root)
source /home/ubuntu/.venvs/mafw-voice/bin/activate
python -u gateway/voice_sidecars/qwen3_asr_server.py \
  --model /home/ubuntu/.mafw/models/voice/Qwen3-ASR-1.7B-ms \
  --port 3911 --gpu-memory-utilization 0.6 \
  --max-model-len 8192 --chunk-size-sec 0.16 --max-new-tokens 256

# Windows: minimal gateway voice server (uses the real gateway classes)
npx ts-node gateway/scripts/voice-bench-server.ts

# Windows: benchmark through /ws/voice
npx ts-node gateway/scripts/voice-bench.ts \
  --url ws://127.0.0.1:3001/ws/voice \
  --dir docs/fixtures/voice --repeat 3 \
  --out docs/research/2026-10-29-voice-bench-gateway.json
```

Direct sidecar benchmark (WSL2):

```bash
python gateway/scripts/voice-sidecar-bench.py \
  --url ws://127.0.0.1:3911/stream \
  --fixtures docs/fixtures/voice --repeat 3 --warmup 2 \
  --step-ms 20 --pace real \
  --json docs/research/2026-10-29-voice-bench-sidecar.json
```
