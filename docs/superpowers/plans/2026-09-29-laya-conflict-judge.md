# Laya Conflict Judge 级联部署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把社区微调 checkpoint `Modusnsus/laya-nli-memory-conflict` 部署为本地 Python sidecar，以单边级联接入 ConsolidationService——置信冲突（p ≥ τ）直接采纳 UPDATE，其余照旧走 LLM 判官，修复 update ratio 长期为 0 的问题。

**Architecture:** 新增 laya-serve-conflict.py（stdlib HTTP，CPU 设备，端口 13129）+ LayaConflictClient（TS，2s 超时 + 熔断器）+ ConsolidationService 单边级联插入点（liveCandidates 之后、LLM 判官之前）。JudgedPair 扩展 `decidedBy`/`layaScores` 字段，pairs jsonl 自动携带一致率数据。sidecar 由 gateway spawn（windowsHide + HF_ENDPOINT 镜像），venv 落在 `~/.mafw/laya/`，未 provisioning 时级联惰性（fail-open 到 LLM）。

**Tech Stack:** TypeScript (gateway CJS) / Python 3.10+ (`pip install laya`) / jest / ts-node (setup script)

## Global Constraints

- **一切 laya 路径 fail-open**：sidecar 挂/超时/未部署 → 照旧走 LLM 判官，绝不阻塞或破坏写入
- **jest 不 typecheck `gateway/src/index.ts`**——改了 index.ts 必须 root `npm run build` 过了才 commit
- **中文内容文件只用 edit/write 工具**，绝不用 PowerShell 写（UTF-8 损坏）
- **HF 网络实测**：huggingface.co 直连不通 → sidecar spawn 环境必须带 `HF_ENDPOINT=https://hf-mirror.com`
- **detached gateway 下所有 spawn 必须 `windowsHide: true`**（黑窗事故教训）
- **测试**：`cd gateway && npx jest --runInBand`；SDK/desktop 不动
- **部署链**：root `npm run build` → gateway jest → root `npm pack` → `mafw stop` → `npm install -g jack200714-mafw-<ver>.tgz` → `mafw daemon` → health ~45-60s（"Gateway already running" = stale PID，再 restart 一次）
- **端口约定**：13129（embedding 13123 / reranker 13128 之后的下一个）
- **τ_high 默认 0.85**：模型卡实测——软化温度 1.2176 使清晰冲突落在 0.85-0.92，auto-write 阈值不得高于 ~0.92
- **模型卡已知限制（写进设计）**：否定式输入弱（"do NOT cancel"类 4/5）→ 我们的 UPDATE 是 soft-supersede 可回滚，可接受；confidence 字段是压缩带（0.918-0.928）无排序力 → 级联判据只用 **noul 概率**

## 模型契约（精确，来自模型卡，不得改动一字）

```python
QUESTION = {
    'type': 'noul',
    'instructions': '新信息(new)与已有记忆(known)是否冲突？冲突=矛盾需更新旧记忆，兼容=一致或无关',
    'labels': {'false': '兼容', 'true': '冲突'},
}
state = {'known': '<已有记忆文本>', 'new': '<新信息文本>'}
p_conflict = float(agent.predict(state, {'conflict': QUESTION})['answers']['conflict']['noul'])
```

---

## 设计决策记录（为什么是单边级联）

**语义错配发现**：laya 冲突模型的"冲突"= 取代语义（新信息使旧记忆失效需 supersede），只覆盖 LLM 判官 UPDATE 判定的**取代子集**；LLM 的 UPDATE 还包含"同主题互补细节合并"（evolving state 的友好补充），后者在 laya 眼里是"兼容"。若做双边级联（laya 低分时直接采纳 CREATE），互补合并类将永远到不了 LLM——损失一类合法 update。

**单边 v1**：laya 只在 `max p ≥ tauHigh` 时采纳 UPDATE（那正是 LLM 判官现在做不到、而 laya 0.901 acc 擅长的取代判定）；其余全部照旧走 LLM，且 laya 分数附进 pairs jsonl——**所有**事件都积累一致率数据，为 v2 校准双边带做准备。零回归、直接攻击 updates=0。

**Out of scope**（后续计划）：双边级联（adopt-create）、GPU device、watchdog 重启、desktop 统计卡 laya 字段展示、英文岗（evidence-gate/prompt-guard）、FOK join 窗口修正、query 捕获。

---

### Task 1: LayaConflictClient（TS 客户端 + 熔断器）

**Files:**
- Create: `gateway/src/memory/laya-client.ts`
- Test: `gateway/tests/unit/memory/laya-client.test.ts`

**Interfaces:**
- Produces: `LayaConflictClient`（构造 `{url, timeoutMs?, fetchFn?}`；`askConflict(known, newInfo): Promise<number|null>`；`healthCheck(): Promise<boolean>`）、`CONFLICT_QUESTION` 常量——Task 3/5 消费

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/memory/laya-client.test.ts
import { LayaConflictClient, CONFLICT_QUESTION } from '../../../src/memory/laya-client';

function okFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as any;
}

describe('LayaConflictClient', () => {
  const deps = (fetchFn: any) => ({ url: 'http://127.0.0.1:13129', timeoutMs: 50, fetchFn });

  it('returns noul probability on success', async () => {
    const c = new LayaConflictClient(deps(okFetch({ answers: { conflict: { noul: 0.92 } } })));
    expect(await c.askConflict('用户对花生过敏', '用户想试试花生酱饼干')).toBe(0.92);
  });

  it('sends the exact model-card contract', async () => {
    let captured: any;
    const fetchFn = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ answers: { conflict: { noul: 0.1 } } }), { status: 200 });
    }) as any;
    await new LayaConflictClient(deps(fetchFn)).askConflict('a', 'b');
    expect(captured.state).toEqual({ known: 'a', new: 'b' });
    expect(captured.questions.conflict).toEqual(CONFLICT_QUESTION);
    expect(CONFLICT_QUESTION.type).toBe('noul');
    expect(CONFLICT_QUESTION.labels).toEqual({ false: '兼容', true: '冲突' });
  });

  it('returns null on non-200', async () => {
    const c = new LayaConflictClient(deps(okFetch({ error: 'x' }, 500)));
    expect(await c.askConflict('a', 'b')).toBeNull();
  });

  it('returns null on malformed body', async () => {
    const c = new LayaConflictClient(deps(okFetch({ nope: true })));
    expect(await c.askConflict('a', 'b')).toBeNull();
  });

  it('returns null on timeout', async () => {
    const never = (async () => { await new Promise((r) => setTimeout(r, 500)); return new Response(); }) as any;
    const c = new LayaConflictClient(deps(never));
    expect(await c.askConflict('a', 'b')).toBeNull();
  });

  it('circuit breaker opens after 3 consecutive failures and cools down', async () => {
    let fail = true;
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (fail) throw new Error('down');
      return new Response(JSON.stringify({ answers: { conflict: { noul: 0.5 } } }), { status: 200 });
    }) as any;
    const c = new LayaConflictClient({ url: 'http://x', timeoutMs: 50, fetchFn, breakerCooldownMs: 10 });
    expect(await c.askConflict('a', 'b')).toBeNull();
    expect(await c.askConflict('a', 'b')).toBeNull();
    expect(await c.askConflict('a', 'b')).toBeNull();
    // breaker open — no further calls
    expect(await c.askConflict('a', 'b')).toBeNull();
    expect(calls).toBe(3);
    await new Promise((r) => setTimeout(r, 20));
    fail = false;
    expect(await c.askConflict('a', 'b')).toBe(0.5); // half-open probe succeeds
    expect(calls).toBe(4);
  });

  it('healthCheck returns true on 200', async () => {
    const c = new LayaConflictClient(deps(okFetch({ ok: true })));
    expect(await c.healthCheck()).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/memory/laya-client.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```typescript
// gateway/src/memory/laya-client.ts
// Thin HTTP client for the laya-nli-memory-conflict sidecar (one-sided v1
// cascade). Every failure returns null — the cascade treats null as
// "escalate to LLM judge" (fail-open). A circuit breaker stops log spam and
// per-call timeout cost when the sidecar is down: after 3 consecutive
// failures the client stops calling for `breakerCooldownMs`, then probes once
// (half-open) before restoring.
import { log } from '../core/utils/logger';

export interface LayaClientDeps {
  url: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  breakerCooldownMs?: number;
}

/** Exact question contract from Modusnsus/laya-nli-memory-conflict model card — do not reword. */
export const CONFLICT_QUESTION = {
  type: 'noul',
  instructions: '新信息(new)与已有记忆(known)是否冲突？冲突=矛盾需更新旧记忆，兼容=一致或无关',
  labels: { false: '兼容', true: '冲突' },
} as const;

export class LayaConflictClient {
  private url: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;
  private breakerCooldownMs: number;
  private consecutiveFails = 0;
  private breakerOpenUntil = 0;

  constructor(deps: LayaClientDeps) {
    this.url = deps.url.replace(/\/$/, '');
    this.timeoutMs = deps.timeoutMs ?? 2000;
    this.fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.breakerCooldownMs = deps.breakerCooldownMs ?? 5 * 60_000;
  }

  async askConflict(known: string, newInfo: string): Promise<number | null> {
    if (Date.now() < this.breakerOpenUntil) return null;
    try {
      const resp = await Promise.race([
        this.fetchFn(`${this.url}/v1/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: { known, new: newInfo },
            questions: { conflict: CONFLICT_QUESTION },
          }),
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('laya timeout')), this.timeoutMs);
          timer.unref?.();
        }),
      ]) as Response;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const p = data?.answers?.conflict?.noul;
      if (typeof p !== 'number' || !Number.isFinite(p)) return null;
      this.consecutiveFails = 0;
      return p;
    } catch (err: any) {
      this.consecutiveFails++;
      if (this.consecutiveFails >= 3) {
        this.breakerOpenUntil = Date.now() + this.breakerCooldownMs;
        this.consecutiveFails = 0;
        log.warn(`[Laya] circuit breaker open for ${this.breakerCooldownMs / 1000}s (${err?.message || err})`);
      }
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const resp = await Promise.race([
        this.fetchFn(`${this.url}/health`),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 1000);
          timer.unref?.();
        }),
      ]) as Response;
      return resp.ok;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest --runInBand tests/unit/memory/laya-client.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/laya-client.ts gateway/tests/unit/memory/laya-client.test.ts
git commit -m "feat(laya): conflict-judge HTTP client with circuit breaker"
```

---

### Task 2: Python sidecar（stdlib HTTP + selftest）

**Files:**
- Create: `gateway/scripts/laya-serve-conflict.py`

**Interfaces:**
- Produces: HTTP 服务——`GET /health` → `200 {"ok":true,"model":"..."}`；`POST /v1/predict` body `{"state":{"known","new"},"questions":{...}}` → `200 {"answers":{"conflict":{"noul":p}}}`；`--selftest` 模式跑花生示例并 exit 0/1。Task 4/5 消费。

- [ ] **Step 1: 写 sidecar 脚本**

```python
#!/usr/bin/env python3
"""Thin stdlib HTTP sidecar for Modusnsus/laya-nli-memory-conflict.

GET  /health      -> {"ok": true, "model": "..."}
POST /v1/predict  -> {"answers": {"conflict": {"noul": p}}}  (passthrough of laya predict)

Env: LAYA_PORT (default 13129), LAYA_DEVICE (default cpu),
     HF_ENDPOINT (gateway sets https://hf-mirror.com — huggingface.co is
     unreachable from this network; must be set BEFORE huggingface_hub import).

Run `python laya-serve-conflict.py --selftest` for an end-to-end checkpoint check.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = "Modusnsus/laya-nli-memory-conflict"
QUESTION = {
    "type": "noul",
    "instructions": "新信息(new)与已有记忆(known)是否冲突？冲突=矛盾需更新旧记忆，兼容=一致或无关",
    "labels": {"false": "兼容", "true": "冲突"},
}
agent = None


def load_agent():
    global agent
    import laya  # deferred: HF_ENDPOINT must be in env before hub import

    agent = laya.load(MODEL_ID, device=os.environ.get("LAYA_DEVICE", "cpu"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": agent is not None, "model": MODEL_ID})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/predict":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length).decode("utf-8"))
            result = agent.predict(req["state"], req["questions"])
            self._send(200, result)
        except Exception as e:  # noqa: BLE001 — sidecar must never crash on bad input
            self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        print(f"[laya-serve] {fmt % args}", flush=True)


def selftest():
    load_agent()
    r1 = agent.predict({"known": "用户对花生过敏", "new": "用户想试试花生酱饼干"}, {"conflict": QUESTION})
    p1 = float(r1["answers"]["conflict"]["noul"])
    r2 = agent.predict({"known": "用户对花生过敏", "new": "用户今天吃了米饭"}, {"conflict": QUESTION})
    p2 = float(r2["answers"]["conflict"]["noul"])
    print(f"peanut conflict p={p1:.3f} (expect >0.5)")
    print(f"rice compatible p={p2:.3f} (expect <0.5)")
    ok = p1 > 0.5 and p2 < 0.5
    print("SELFTEST", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    load_agent()
    port = int(os.environ.get("LAYA_PORT", "13129"))
    print(f"[laya-serve] listening on 127.0.0.1:{port} model={MODEL_ID} device={os.environ.get('LAYA_DEVICE', 'cpu')}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
```

注意：instructions 文本与 labels 必须与 Task 1 的 `CONFLICT_QUESTION` 逐字一致（从模型卡复制，不得改写）。

- [ ] **Step 2: 语法检查**

Run: `python -m py_compile gateway/scripts/laya-serve-conflict.py`
Expected: 无输出（exit 0）

- [ ] **Step 3: Commit**

```bash
git add gateway/scripts/laya-serve-conflict.py
git commit -m "feat(laya): stdlib HTTP sidecar for conflict judge with selftest"
```

（selftest 的真实运行在 Task 6 venv 建好后执行——脚本依赖 `pip install laya`。）

---

### Task 3: ConsolidationService 单边级联（核心）

**Files:**
- Modify: `gateway/src/memory/consolidation-service.ts`
- Test: `gateway/tests/unit/memory/consolidation-cascade.test.ts`（新建，不动既有 `consolidation-pairs.test.ts`）

**Interfaces:**
- Consumes: Task 1 的 `LayaConflictClient.askConflict` 形状（注入为 `{ askConflict(known, newInfo): Promise<number|null> }`）
- Produces: `ConsolidationDeps.laya?: { client, tauHigh, maxTextChars? }`；`JudgedPair.decidedBy?: 'laya'|'llm'`、`JudgedPair.layaScores?: Array<{id, p}>`；stats 新增 `layaAdopted`/`layaEscalated`（经 getStats 展开自动进 /api/memory/stats 与 kv 持久化）——Task 5 消费

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/memory/consolidation-cascade.test.ts
import { ConsolidationService, JudgedPair } from '../../../src/memory/consolidation-service';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import { MemoryVectorStore } from '../../../src/memory/vector-store';
import { EmbeddingProvider } from '../../../src/memory/embedding-provider';

function makeUnit(id: string, value: string): HarmonicUnit {
  return {
    id, type: 'semantic', primary_abstraction: 'abs ' + id, cue_anchors: ['a'],
    memory_value: value, energy: 0.8, created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z',
  } as HarmonicUnit;
}

function makeHarness(opts: {
  p?: number | null;                // laya client 返回（undefined = 不配 laya）
  tauHigh?: number;
  llmVerdict?: string;              // LLM 判官 JSON 回复（undefined = 不配 LLM）
}) {
  const newUnit = makeUnit('new-1', '新事实');
  const pairs: JudgedPair[] = [];
  const written: any[] = [];
  const superseded: string[] = [];
  const store = {
    async read(id: string) {
      if (id === 'new-1') return newUnit;
      return makeUnit(id, `旧事实 ${id}`);
    },
    async write(u: any) { written.push(u); return u.id; },
    async markSuperseded(id: string) { superseded.push(id); },
  };
  const vectors = {
    get: () => [1, 0],
    searchByCosine: () => [{ id: 'old-1', cosine: 0.9 }],
    upsert: () => {}, remove: () => {}, flush: () => {},
  } as unknown as MemoryVectorStore;
  const provider = { embed: async () => [[1, 0]] } as unknown as EmbeddingProvider;
  const svc = new ConsolidationService({
    store: store as any, vectors, provider,
    llm: opts.llmVerdict !== undefined ? {
      baseUrl: 'http://judge.test', apiKey: 'k', model: 'm',
      fetchFn: (async () => new Response(
        JSON.stringify({ choices: [{ message: { content: opts.llmVerdict! } }] }), { status: 200 },
      )) as any,
    } : undefined,
    laya: opts.p !== undefined ? {
      client: { askConflict: async () => (opts.p ?? null) as any },
      tauHigh: opts.tauHigh ?? 0.85,
    } : undefined,
    onPair: (pr) => pairs.push(pr),
  });
  return { svc, pairs, written, superseded, newUnit };
}

describe('laya one-sided cascade', () => {
  it('adopts UPDATE when p >= tauHigh (no LLM call)', async () => {
    const h = makeHarness({ p: 0.95 });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('update');
    if (out.action === 'update') expect(out.targetId).toBe('old-1');
    expect(h.pairs[0].decidedBy).toBe('laya');
    expect(h.pairs[0].layaScores).toEqual([{ id: 'old-1', p: 0.95 }]);
    expect(h.written[0].merged_from).toContain('old-1');
    expect(h.superseded).toContain('old-1');
    const s = h.svc.getStats();
    expect(s.layaAdopted).toBe(1);
    expect(s.updates).toBe(1);
    expect(s.judged).toBe(0); // LLM 从未被调用
  });

  it('adopts UPDATE with laya alone (no LLM configured)', async () => {
    const h = makeHarness({ p: 0.95 }); // llmVerdict undefined → 无 LLM
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('update');
  });

  it('escalates to LLM on middle band, scores attached to pair', async () => {
    const h = makeHarness({ p: 0.5, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
    expect(h.pairs[0].layaScores).toEqual([{ id: 'old-1', p: 0.5 }]);
    const s = h.svc.getStats();
    expect(s.layaEscalated).toBe(1);
    expect(s.judged).toBe(1);
  });

  it('escalates when client returns null (sidecar down), no scores', async () => {
    const h = makeHarness({ p: null, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
    expect(h.pairs[0].layaScores).toBeUndefined();
  });

  it('no laya deps → legacy behavior (regression guard)', async () => {
    const h = makeHarness({ llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
    expect(h.pairs[0].layaScores).toBeUndefined();
    expect(h.svc.getStats().judged).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest --runInBand tests/unit/memory/consolidation-cascade.test.ts`
Expected: FAIL（`layaAdopted` 不存在于 stats / `decidedBy` 字段缺失）

- [ ] **Step 3: 实现（consolidation-service.ts 五处修改）**

3a. `ConsolidationDeps` 增加字段（在 `minCosine` 之前）：

```typescript
  /** Laya conflict-judge cascade (one-sided v1): when the local conflict
   *  model is confident (p >= tauHigh) that the new unit SUPERSEDES a
   *  candidate, adopt UPDATE without an LLM call. Everything else falls
   *  through to the LLM judge unchanged (scores land in the audit pair). */
  laya?: {
    client: { askConflict(known: string, newInfo: string): Promise<number | null> };
    tauHigh: number;
    maxTextChars?: number;
  };
```

3b. `JudgedPair` 扩展两个可选字段：

```typescript
export interface JudgedPair {
  newId: string;
  newAbstraction: string;
  candidates: Array<{ id: string; cosine: number }>;
  verdict: 'update' | 'create' | 'separate' | 'skip';
  ts: number;
  /** Which judge decided: 'laya' = local conflict model adopted, 'llm' = worker LLM. */
  decidedBy?: 'laya' | 'llm';
  /** Per-candidate laya noul scores (present whenever the cascade ran). */
  layaScores?: Array<{ id: string; p: number }>;
}
```

3c. 类字段与构造器：`private laya?: ConsolidationDeps['laya'];` + 构造器 `this.laya = deps.laya;`；stats 初始值改为
`private stats = { judged: 0, updates: 0, creates: 0, skipped: 0, layaAdopted: 0, layaEscalated: 0 };`

3d. `consolidateInner` 在 `if (liveCandidates.length === 0) return { action: 'create' };` 之后、`if (!this.llm && ...)` 之前插入：

```typescript
    // Laya conflict cascade (one-sided v1): confident conflicts adopt UPDATE
    // directly; everything else escalates to the LLM judge with scores
    // attached (audit/calibration data on every event).
    let layaScores: Array<{ id: string; p: number }> | undefined;
    if (this.laya) {
      const r = await this.layaCascade(unit, liveCandidates);
      layaScores = r.scores.length > 0 ? r.scores : undefined;
      if (r.adoptedTargetId) {
        this.stats.layaAdopted++;
        this.stats.updates++;
        this.emitPair(unit, liveCandidates, 'update', 'laya', layaScores);
        const merged = await this.mergeIntoNewer(unit, r.adoptedTargetId);
        return { action: 'update', targetId: r.adoptedTargetId, mergedId: merged.id };
      }
      this.stats.layaEscalated++;
    }
```

并把 LLM 路径里原 inline 的 `this.onPair?.({...})` 块（当前 207-218 行）替换为：

```typescript
    const invalidTarget =
      verdict?.action === 'update' &&
      !(verdict.target_id && candidateIds.includes(verdict.target_id));
    this.emitPair(unit, liveCandidates, !verdict || invalidTarget ? 'skip' : verdict.action, 'llm', layaScores);
```

3e. 新增两个私有方法（放在 `mergeIntoNewer` 之前）：

```typescript
  /** Ask the laya conflict model per live candidate; returns scores and the
   *  adopted target when the best score clears tauHigh. Client failures
   *  (null) are skipped — sidecar-down means "no scores", not a verdict. */
  private async layaCascade(
    unit: HarmonicUnit,
    candidates: Array<{ id: string; cosine: number }>,
  ): Promise<{ scores: Array<{ id: string; p: number }>; adoptedTargetId?: string }> {
    const laya = this.laya!;
    const cap = laya.maxTextChars ?? 800;
    const trunc = (s: string) => String(s ?? '').slice(0, cap);
    const scores: Array<{ id: string; p: number }> = [];
    let best: { id: string; p: number } | null = null;
    for (const c of candidates) {
      const target = await this.store.read(c.id);
      if (!target) continue;
      const p = await laya.client.askConflict(trunc(target.memory_value), trunc(unit.memory_value));
      if (p === null) continue;
      scores.push({ id: c.id, p });
      if (!best || p > best.p) best = { id: c.id, p };
    }
    return { scores, adoptedTargetId: best && best.p >= laya.tauHigh ? best.id : undefined };
  }

  private emitPair(
    unit: HarmonicUnit,
    candidates: Array<{ id: string; cosine: number }>,
    verdict: JudgedPair['verdict'],
    decidedBy: JudgedPair['decidedBy'],
    layaScores?: Array<{ id: string; p: number }>,
  ): void {
    try {
      this.onPair?.({
        newId: unit.id,
        newAbstraction: unit.primary_abstraction,
        candidates: candidates.map((c) => ({ id: c.id, cosine: +c.cosine.toFixed(4) })),
        verdict,
        decidedBy,
        layaScores,
        ts: Date.now(),
      });
    } catch { /* fail-open */ }
  }
```

- [ ] **Step 4: 跑新测试 + 既有全套（回归）**

Run: `cd gateway && npx jest --runInBand tests/unit/memory/`
Expected: 新 5 例 PASS；`consolidation-pairs.test.ts`/`judge-verdict.test.ts` 等全部 PASS（若 pairs 断言用严格对象相等而新增字段破坏它，修断言为字段级断言——不允许为过测试删新字段）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/consolidation-service.ts gateway/tests/unit/memory/consolidation-cascade.test.ts
git commit -m "feat(consolidation): one-sided laya conflict cascade with audit scores"
```

---

### Task 4: Config 键 + venv provisioning 脚本

**Files:**
- Modify: `gateway/src/config.ts`（interface ~201-214 行区 + defaults ~484-491 行区）
- Create: `gateway/scripts/setup-laya-venv.ts`

**Interfaces:**
- Produces: `config.memory.embedding.laya { enabled?: boolean; url?: string; tauHigh?: number; device?: 'cpu'|'cuda' }`（默认 `{ enabled: true, url: 'http://127.0.0.1:13129', tauHigh: 0.85, device: 'cpu' }`）——Task 5 消费；`~/.mafw/laya/` 下 `.venv/` + `laya-serve-conflict.py` 副本

- [ ] **Step 1: config.ts interface 增字段**（`consolidation: boolean;` 之后）

```typescript
      /** Laya conflict-judge cascade (one-sided v1). Inert until the sidecar
       *  is provisioned at ~/.mafw/laya (gateway/scripts/setup-laya-venv.ts). */
      laya?: {
        enabled?: boolean;
        url?: string;
        tauHigh?: number;
        device?: 'cpu' | 'cuda';
      };
```

- [ ] **Step 2: config.ts defaults 增**（`consolidation: true,` 之后）

```typescript
        laya: { enabled: true, url: 'http://127.0.0.1:13129', tauHigh: 0.85, device: 'cpu' },
```

- [ ] **Step 3: 写 provisioning 脚本**

```typescript
// gateway/scripts/setup-laya-venv.ts
// Provision ~/.mafw/laya: venv + pip install laya + sidecar copy + selftest.
// Run: npx ts-node scripts/setup-laya-venv.ts   (from gateway/)
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const home = path.join(os.homedir(), '.mafw', 'laya');
const venvPy = path.join(home, '.venv', 'Scripts', 'python.exe');
const srcScript = path.join(__dirname, 'laya-serve-conflict.py');
const dstScript = path.join(home, 'laya-serve-conflict.py');

function run(cmd: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd, env: { ...process.env, ...opts.env } });
}

fs.mkdirSync(home, { recursive: true });
if (!fs.existsSync(venvPy)) {
  console.log('[1/4] creating venv (torch download is ~2GB, first run takes minutes)...');
  run(`python -m venv "${path.join(home, '.venv')}"`);
} else {
  console.log('[1/4] venv exists');
}
console.log('[2/4] pip install laya (tuna mirror fallback)...');
const pip = path.join(home, '.venv', 'Scripts', 'pip.exe');
try {
  run(`"${pip}" install laya`);
} catch {
  console.log('direct PyPI failed, retrying via tuna mirror...');
  run(`"${pip}" install laya -i https://pypi.tuna.tsinghua.edu.cn/simple`);
}
console.log('[3/4] copying sidecar script...');
fs.copyFileSync(srcScript, dstScript);
console.log('[4/4] selftest (downloads checkpoint via hf-mirror on first run)...');
run(`"${venvPy}" "${dstScript}" --selftest`, { env: { HF_ENDPOINT: 'https://hf-mirror.com' } });
console.log(`\nDone. Gateway will auto-spawn the sidecar on next start (~/.mafw/laya).`);
```

- [ ] **Step 4: 验证脚本可编译 + pack 包含 py 文件**

Run: `cd gateway && npx tsc --noEmit scripts/setup-laya-venv.ts 2>$null; npm pack --dry-run 2>&1 | findstr /i "laya"`
Expected: 若 pack 输出无 `laya-serve-conflict.py`，在 gateway `package.json` 的 `files` 数组加 `"scripts/laya-serve-conflict.py"`（setup 脚本从 `__dirname` 读源文件，必须在包内）。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/config.ts gateway/scripts/setup-laya-venv.ts gateway/package.json
git commit -m "feat(laya): config keys + venv provisioning script"
```

---

### Task 5: index.ts 接线（spawn + 健康探测 + deps 注入）

**Files:**
- Modify: `gateway/src/index.ts`（`initEmbeddingServices` ~1204-1249 行区 + 类字段区 + `stop()` 序列）

**Interfaces:**
- Consumes: Task 1 `LayaConflictClient`、Task 3 `ConsolidationDeps.laya`、Task 4 config 键
- Produces: 运行时 sidecar（13129）+ 级联生效；`[Laya]` 前缀日志

- [ ] **Step 1: import 与类字段**

顶部 import 区加：

```typescript
import { LayaConflictClient } from "./memory/laya-client";
```

类字段区（`private consolidationService: ConsolidationService | null = null;` 附近）加：

```typescript
  private layaSidecar: import("child_process").ChildProcess | null = null;
```

- [ ] **Step 2: initEmbeddingServices 内、`new ConsolidationService({...})` 之前插入 spawn + deps 构造**

```typescript
      // Laya conflict cascade (one-sided v1): spawn sidecar when provisioned;
      // cascade is inert otherwise (fail-open to the LLM judge).
      const layaCfg = (config.memory.embedding as any).laya;
      let layaDeps: ConsolidationDeps['laya'] | undefined;
      if (layaCfg?.enabled) {
        const layaHome = path.join(os.homedir(), '.mafw', 'laya');
        const layaPy = path.join(layaHome, '.venv', 'Scripts', 'python.exe');
        const layaScript = path.join(layaHome, 'laya-serve-conflict.py');
        if (fs.existsSync(layaPy) && fs.existsSync(layaScript)) {
          this.startLayaSidecar(layaPy, layaScript, layaCfg);
          layaDeps = {
            client: new LayaConflictClient({ url: layaCfg.url }),
            tauHigh: layaCfg.tauHigh ?? 0.85,
          };
          log.info(`[Laya] conflict cascade enabled (tauHigh=${layaDeps.tauHigh}, url=${layaCfg.url})`);
        } else {
          log.info('[Laya] sidecar not provisioned (~/.mafw/laya) — cascade inert; provision via gateway/scripts/setup-laya-venv.ts');
        }
      }
```

`new ConsolidationService({...})` 的 deps 里加一行 `laya: layaDeps,`。

- [ ] **Step 3: 新增 startLayaSidecar 方法（类内任意方法区）**

```typescript
  /** Spawn the laya conflict sidecar (windowsHide mandatory — detached
   *  gateway). Non-blocking readiness probe: cascade stays fail-open until
   *  healthy. HF_ENDPOINT routes the checkpoint download through hf-mirror
   *  (huggingface.co unreachable from this network). */
  private startLayaSidecar(python: string, script: string, cfg: { url: string; device?: string }): void {
    try {
      this.layaSidecar?.kill();
      const port = (() => { try { return new URL(cfg.url).port || '13129'; } catch { return '13129'; } })();
      this.layaSidecar = spawn(python, [script], {
        windowsHide: true,
        env: {
          ...process.env,
          LAYA_PORT: port,
          LAYA_DEVICE: cfg.device || 'cpu',
          HF_ENDPOINT: 'https://hf-mirror.com',
        },
      });
      this.layaSidecar.stdout?.on('data', (d) => log.info(`[Laya] ${String(d).trim()}`));
      this.layaSidecar.stderr?.on('data', (d) => log.warn(`[Laya] ${String(d).trim()}`));
      this.layaSidecar.on('exit', (code) => log.warn(`[Laya] sidecar exited (code=${code}) — cascade degraded to LLM-only (fail-open)`));
      const t0 = Date.now();
      (async () => {
        for (let i = 0; i < 30; i++) {
          try {
            const resp = await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(1000) } as any);
            if (resp.ok) { log.info(`[Laya] sidecar ready (${((Date.now() - t0) / 1000).toFixed(1)}s)`); return; }
          } catch { /* not up yet */ }
          await new Promise((r) => setTimeout(r, 2000));
        }
        log.warn('[Laya] sidecar not healthy after 60s — cascade degraded (LLM-only)');
      })();
    } catch (err: any) {
      log.warn(`[Laya] sidecar spawn failed: ${err?.message || err}`);
    }
  }
```

（`spawn`/`os`/`fs`/`path` 若未在 index.ts import 则补——`spawn` 大概率已在。）

- [ ] **Step 4: stop() 序列杀 sidecar**

Run: `cd gateway && grep -n "stop()" src/index.ts | head -5` 找到 stop 方法；在已有 sidecar/serve 清理语句附近加：

```typescript
    try { this.layaSidecar?.kill(); } catch { /* best effort */ }
```

- [ ] **Step 5: build 门禁（jest 不 typecheck index.ts）**

Run: `cd .. && npm run build`
Expected: 编译通过、零 TS 错误

- [ ] **Step 6: 全量测试**

Run: `cd gateway && npx jest --runInBand`
Expected: 全套 PASS

- [ ] **Step 7: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(laya): sidecar spawn/health-probe wiring + cascade deps injection"
```

---

### Task 6: 部署与生产验证

**Files:** 无代码——provisioning + deploy + 验证清单

- [ ] **Step 1: venv provisioning（一次性，~2GB torch 下载）**

Run: `cd gateway && npx ts-node scripts/setup-laya-venv.ts`
Expected: 末尾 `SELFTEST PASS`（花生冲突 p>0.5、米饭兼容 p<0.5）

- [ ] **Step 2: 构建打包安装**

```bash
npm run build
cd gateway && npx jest --runInBand && cd ..
npm pack
mafw stop
npm install -g jack200714-mafw-4.14.0.tgz
mafw daemon
```
（"Gateway already running" = stale PID → 再 `mafw stop; mafw daemon` 一次）

- [ ] **Step 3: 验证清单（health 就绪 ~45-60s 后）**

```powershell
# 1. sidecar 健康
Invoke-RestMethod http://127.0.0.1:13129/health
# 期望 {"ok":true,"model":"Modusnsus/laya-nli-memory-conflict"}

# 2. stats 出现 laya 字段（layaAdopted/layaEscalated，初始 0）
Invoke-RestMethod http://127.0.0.1:3000/api/memory/stats | Select-Object -ExpandProperty consolidation

# 3. 强制触发一次级联：写入一对冲突记忆（经 mafw_add_memory 走生产写路径）
#    （在任意 agent 会话调用 mafw_add_memory 写：
#      a) semantic "用户偏好 TDD 先行的开发流程"（先写，等入索引）
#      b) semantic "用户现在改为偏好先实现后补测试"（cosine≥0.8 候选 → laya 判冲突 → 期望 p≥0.85 采纳 UPDATE））

# 4. pairs 日志出现 decidedBy 字段
Get-Content "$env:USERPROFILE\.mafw\logs\consolidation-pairs.jsonl" -Tail 3
# 期望最新一行含 "decidedBy":"laya","layaScores":[{"id":"...","p":0.8x...}]

# 5. updateRatio 开始离开 0
Invoke-RestMethod http://127.0.0.1:3000/api/memory/stats | Select-Object -ExpandProperty consolidation
```

- [ ] **Step 4: 记录验证结果到记忆（验收后）**

观察 24h：`layaAdopted` 增长、`updateRatio` 从 0 回升、pairs jsonl 里 laya 与 LLM（escalated 案例的 decidedBy=llm + layaScores）的一致率肉眼可查。把首日数字记入记忆（样本量小不做结论，只记观察）。

- [ ] **Step 5: Commit（如有 package.json files 修正等遗留）**

```bash
git add -A
git commit -m "chore(laya): deployment follow-ups"
```

---

## Self-Review 记录

- **Spec 覆盖**：解冻决定三步走的第一步（conflict 判官部署）全覆盖；②query 捕获/③FOK join 修正不在本计划（独立小计划）
- **占位符扫描**：无 TBD/TODO；所有代码块完整
- **类型一致性**：`askConflict(known: string, newInfo: string): Promise<number | null>` 在 Task 1/3/5 三处一致；`JudgedPair.decidedBy`/`layaScores` 在 Task 3 定义、Task 3 测试与 pairs jsonl 消费一致；config 键 `memory.embedding.laya` 在 Task 4/5 一致
- **风险已内建**：否定式弱（soft-supersede 可回滚）、confidence 压缩带（判据用 noul p）、网络（HF_ENDPOINT 镜像）、黑窗（windowsHide）、sidecar 死亡（熔断器 + fail-open）
