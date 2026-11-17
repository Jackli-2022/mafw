# 2026-11-19 · Embedding 溯源护栏

- **分支**：`main`
- **commits**：`991d1b4c`（护栏主体）→ `c9fbc2b3`（报告真实运行模型）
- **背景**：`docs/research/2026-11-19-heterogeneity-more-axes.md` §4

## 问题

`/api/memory/stats` 的 `embedding.model` 直接读 `config.memory.embedding.model`：
配置里写着 `engine: llamacpp`，但 model 默认值是 `onnx-community/Qwen3-Embedding-0.6B-ONNX`，
于是页面显示 ONNX、实际跑 llamacpp。同时 `t1_turn_encoding.model` 写的是常量 `sparse-embed-v1`，
换 gguf/engine 后 DB 里看不出差异，回填还会认为“已编码”跳过。

## 交付

- `stats.embedding` 新增并修正：
  ```json
  {
    "provider": "local",
    "model": "llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf",
    "configModel": "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    "providerId": "llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf",
    "engine": "llamacpp",
    "dims": 1024
  }
  ```
  `model`/`providerId` 来自运行时 `provider.name`；`configModel` 保留原始配置值用于排查。
- `t1_turn_encoding.model` 改为写 `providerId@dims`（如 `llamacpp:…gguf@1024`）；
  未传 provider 时回退到 `sparse-embed-v1`（测试/旧调用方）。
- 管线、kernel、`backfillT1Atoms` 与 `backfill-t1-atoms.ts` 全部透传真实 id。
- 启动告警：`engine=llamacpp` + ONNX model、或 `engine=onnx` + gguf model 时写 WARN。

## 线上证据

启动日志：

```text
[WARN] [Embedding] embedding engine is llamacpp but model "onnx-community/Qwen3-Embedding-0.6B-ONNX" is an ONNX id;
       the sidecar uses its own gguf — record the real provider id in stats/markers
[INFO] [Embedding] runtime initialized: llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf (16998 vectors, t1 39034)
```

`/api/memory/stats` 现在显示 `model=llamacpp:Qwen3-…gguf`、`configModel=…-ONNX`、`dims=1024`。

## 历史数据

已有 4,478 条 marker 仍是 `sparse-embed-v1`；**不回填盖章**——我们无法证明历史原子由哪个物理模型产生，
用今天的 provider 覆盖历史等于伪造溯源。新编码的 turn 才带真实 id。

## 测试

新增 **6** 个测试（2 个新套件）：

- `t1-encode-provenance.test.ts`：marker 写真实 id；未传时回退逻辑值。
- `embedding-config-warnings.test.ts`：llamacpp+ONNX、onnx+gguf 告警；一致配置无告警。
- `memory-wiring.test.ts`（+1）：stats 的 `providerId/model/configModel/dims`。

门禁：

```text
gateway full     1018/1018 suites；8082 tests（8080 passed，2 skipped，0 failed）
gateway tsc      rc=0
gateway build    rc=0
api contract     313/313
```

## 回滚

- stats 字段是新增/纠正，不影响读路径；`configModel` 保留旧语义。
- marker 只是字符串，回滚代码即可；无 schema 变更。
- 启动告警不影响启动。
