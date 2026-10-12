### Task 1: laya-client `askPair` 双问题

**Files:**
- Modify: `gateway/src/memory/laya-client.ts`
- Test: `gateway/tests/unit/memory/laya-client.test.ts`

**Interfaces:**
- Produces: `REDUNDANT_QUESTION`（const）；`LayaConflictClient.askPair(known: string, newInfo: string): Promise<{ pConflict: number | null; pRedundant: number | null } | null>`。`askConflict` 签名不变（consolidation-service.ts:305 在用）。

- [ ] **Step 1: 写失败测试**（追加到 laya-client.test.ts）

```typescript
import { LayaConflictClient, CONFLICT_QUESTION, REDUNDANT_QUESTION } from '../../../src/memory/laya-client';

describe('askPair', () => {
  const deps = (fetchFn: any) => ({ url: 'http://127.0.0.1:13129', timeoutMs: 50, fetchFn });

  it('sends both questions in one call and returns both scores', async () => {
    let captured: any;
    const fetchFn = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ answers: { conflict: { noul: 0.2 }, redundant: { noul: 0.93 } } }), { status: 200 });
    }) as any;
    const r = await new LayaConflictClient(deps(fetchFn)).askPair('已知', '新信息');
    expect(captured.questions.conflict).toEqual(CONFLICT_QUESTION);
    expect(captured.questions.redundant).toEqual(REDUNDANT_QUESTION);
    expect(r).toEqual({ pConflict: 0.2, pRedundant: 0.93 });
  });

  it('missing redundant field → pRedundant null, overall non-null', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ answers: { conflict: { noul: 0.4 } } }), { status: 200 })) as any;
    const r = await new LayaConflictClient(deps(fetchFn)).askPair('a', 'b');
    expect(r).toEqual({ pConflict: 0.4, pRedundant: null });
  });

  it('total failure → null', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 })) as any;
    expect(await new LayaConflictClient(deps(fetchFn)).askPair('a', 'b')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd gateway; npx jest tests/unit/memory/laya-client.test.ts`
Expected: FAIL（REDUNDANT_QUESTION / askPair 不存在）

- [ ] **Step 3: 实现**（laya-client.ts）

在 `CONFLICT_QUESTION` 后加：

```typescript
/** G2 write-routing redundancy question — separate contract from CONFLICT_QUESTION,
 *  calibrated independently (observe-first, tauRedundantHigh default 1.0). */
export const REDUNDANT_QUESTION = {
  type: 'noul',
  instructions: '新信息(new)是否已被已有记忆(known)覆盖？覆盖=known已包含new的实质内容，new不带来新事实',
  labels: { false: '未覆盖', true: '已覆盖' },
} as const;
```

类中加方法（复用同一熔断器状态）：

```typescript
  async askPair(known: string, newInfo: string): Promise<{ pConflict: number | null; pRedundant: number | null } | null> {
    if (Date.now() < this.breakerOpenUntil) return null;
    try {
      const resp = await Promise.race([
        this.fetchFn(`${this.url}/v1/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: { known, new: newInfo },
            questions: { conflict: CONFLICT_QUESTION, redundant: REDUNDANT_QUESTION },
          }),
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('laya timeout')), this.timeoutMs);
          timer.unref?.();
        }),
      ]) as Response;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const pc = data?.answers?.conflict?.noul;
      const pr = data?.answers?.redundant?.noul;
      const pConflict = typeof pc === 'number' && Number.isFinite(pc) ? pc : null;
      const pRedundant = typeof pr === 'number' && Number.isFinite(pr) ? pr : null;
      if (pConflict === null && pRedundant === null) return null;
      this.consecutiveFails = 0;
      return { pConflict, pRedundant };
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
```

注意：`consecutiveFails` / `breakerOpenUntil` 现为 private——同类内新方法直接可用，无需改可见性。

- [ ] **Step 4: 跑测试确认绿**

Run: `cd gateway; npx jest tests/unit/memory/laya-client.test.ts`
Expected: PASS（9 个）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/laya-client.ts gateway/tests/unit/memory/laya-client.test.ts
git commit -m "feat: laya askPair dual-question (conflict+redundant) client"
```

---

