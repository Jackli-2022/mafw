# Desktop 记忆配置面：观测面板 + 检索行为卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P2 观测（`/api/memory/stats` 增 FOK 标注与检索事件计数 + desktop Memory 统计行）+ P1 检索行为卡（FOK 门/快照/邻居呈现/reranker 四控件，走通用 config.get/set，零新路由）。

**Architecture:** gateway 侧只扩既有 stats 路由（fok-samples 文件读 10s 缓存 + RetrievalEventBuffer 单例计数）；desktop 侧复用 SDK config 通道，校验抽纯模块 `search-behavior.ts`（bun test 可测）。

**Tech Stack:** TS (gateway CJS + jest；desktop SolidJS + bun:test)。依据：`docs/research/2026-09-29-desktop-config-surface-research.md` §3。

## Global Constraints

- TDD；gateway 改动过 `npm run build` + jest；desktop 过 `bun test`（纯逻辑模块）+ electron-vite build
- UI 组件守 §5.10（SwitchV2/SelectV2/TextInputV2，禁裸 input）
- stats 只读端点 fail-open（文件缺失/单例未建 → 字段为 null/零值，不 500）
- config.set 走 SDK 既有段级 merge（PUT 整文件由 SDK 合并）

---

### Task 1: Gateway — FOK 样本统计 + 事件缓冲计数入 stats

**Files:**
- Modify: `gateway/src/recall/fok-samples.ts`（增 `fokSampleStats(lines)` 纯函数）
- Modify: `gateway/src/core/memory/retrieval-events.ts`（增 `stats()`）
- Modify: `gateway/src/index.ts:3570-3596`（stats 路由增两字段）
- Test: `gateway/tests/unit/recall/fok-samples.test.ts`（追加）

**Interfaces:**
- Produces: `fokSampleStats(lines: string[]): { injections: number; redemptions: number; samples: number; hitRate: number | null }`（samples/hitRate 来自 joinFokSamples）；`RetrievalEventBuffer.stats(): { pending: number; needTracked: number }`

- [ ] Step 1: 失败测试（fok-samples.test.ts 追加 fokSampleStats 三例：空行集→零/null；2 inj + 1 rdm 命中→{2,1,2,0.5}；无 top1prob 的 inj 不计入 samples 但计入 injections）+ retrieval-events.test.ts 追加 stats() 两例（pending=drain 前计数；needTracked=need map 大小）
- [ ] Step 2: 跑测确认失败 → 实现 → 跑测通过
- [ ] Step 3: index.ts stats 路由增：

```typescript
fok: (() => {
  try {
    const { FOK_SAMPLES_FILE, fokSampleStats } = require('./recall/fok-samples');
    const fs = require('fs');
    const cacheKey = 'fok-stats';
    const now = Date.now();
    if (!this.fokStatsCache || now - this.fokStatsCache.at > 10_000) {
      const lines = fs.existsSync(FOK_SAMPLES_FILE())
        ? fs.readFileSync(FOK_SAMPLES_FILE(), 'utf-8').split(/\r?\n/).filter(Boolean)
        : [];
      this.fokStatsCache = { at: now, stats: fokSampleStats(lines) };
    }
    return this.fokStatsCache.stats;
  } catch { return null; }
})(),
retrievalEvents: (() => {
  try {
    return getRetrievalEventBuffer().stats();
  } catch { return null; }
})(),
```

（类字段 `private fokStatsCache: { at: number; stats: any } | null = null;`）
- [ ] Step 4: `npm run build` + `npx jest --runInBand tests/unit/recall/fok-samples.test.ts tests/unit/core/memory/retrieval-events.test.ts` → 绿 → commit `feat(stats): FOK sample + retrieval event counters in /api/memory/stats`

### Task 2: SDK — MemoryStats 类型 + memory.stats()

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`（`MemoryStats` 接口：embedding/consolidation/routing/reconsolidation/pipelines/coactivation/abstractionLevels/fok/retrievalEvents 全 optional）
- Modify: `packages/gateway-sdk/src/client.ts`（memory 命名空间增 `stats()`）

- [ ] Step 1: types.ts 增类型 + client.ts 增方法（照 listSticky 风格）
- [ ] Step 2: `cd packages/gateway-sdk && npm run build`（tsc 守门）→ commit `feat(sdk): memory.stats() + MemoryStats type`

### Task 3: Desktop — 检索行为纯模块（校验/转换）

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pages/search-behavior.ts`（+ `.test.ts`，bun:test）

**Interfaces:**
- Produces: `SearchBehaviorDraft { fokEnabled: boolean; probLow: string; probHigh: string; snapshotEnabled: boolean; neighborsPresentation: boolean; reranker: string }`；`draftFromConfig(cfg: any): SearchBehaviorDraft`；`validateFokThresholds(low: string, high: string): string | null`（错误文案）；`toSearchOverrides(d: SearchBehaviorDraft): { search: {...} }`（undefined 值剔除——不覆盖未触碰的键）

- [ ] Step 1: bun 失败测试：draftFromConfig 读缺省 config；validate（空串/非数字/越界/low≥high→错误文案，合法→null）；toSearchOverrides 形状（undefined 剔除）
- [ ] Step 2: 实现 → `bun test` 绿 → commit `feat(desktop): search behavior draft/validate pure module`

### Task 4: Desktop — Memory section 统计行 + 检索行为卡

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`（memory section：onMount 拉 `window.api.mafw.memory.stats()` 15s 轮询渲染统计行；嵌入卡下方增检索行为卡）
- Modify: `packages/desktop/src/renderer/mafw/pages/config-nav.ts`（memory desc 更新为「嵌入引擎与检索行为、记忆观测」）

- [ ] Step 1: 统计行（只读）：FOK 样本 `X（命中 Y%）`、事件流 `pending Z / need N`、consolidation `judged A / update B%`、pipelines 里 decay.bonused 与 turnCompress.replayed（存在才显示）
- [ ] Step 2: 检索行为卡：四个控件 + 保存按钮（校验失败禁用；保存走 `config.set('search', merged)` 后 toast + 15s 后重拉 stats 展示新阈值生效）
- [ ] Step 3: `cd packages/desktop && npx electron-vite build`（renderer 编译守门）+ `bun test` → commit `feat(desktop): memory observability row + search behavior card`

### Task 5: 验证与交付

- [ ] gateway 部署（pack/stop/install/daemon）→ curl stats 验证 fok/retrievalEvents 字段
- [ ] desktop dev 冒烟（`bun run dev` 或构建产物人工核对）→ 汇报新增测试数与全量数
