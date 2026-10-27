# T2-4 系统提示分段 + 每会话 instruction entries Design

> 日期：2026-10-27 · 状态：已交付 v4.40.0（builder check 已过，按反馈修订；smoke 15/15）
> 上游：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` §3 Tier 2「系统提示分段/快照 + 每会话 instruction 条目」
> 目标：把 memory-guide / user-profile / agent-priors 从「每轮 system.transform 注入」迁到 opencode 2.1 原生 per-session instruction entries；动态 recall 保持 per-turn。

## 1. 意图

当前 MAFW 每轮经 `experimental.chat.system.transform`（v2 是 `session.hook('context')` 的 `event.system`）注入三块：

- `<memory-guide>`：静态记忆操作指南
- `<user-profile>`：pinned 披露层
- `<agent-priors>`：L5 公理/启发式 + L2 失败模式谱

这三个块每轮重新拼进 system，天然打断前缀缓存；它们也不在 opencode 的 instruction 快照里，压缩/倒带后的语义弱于原生 instructions。opencode 2.1 已提供 **per-session instruction entries**：durable、JSON 值、内容哈希快照、变更在下一个 step 边界公告。把三块迁过去，动态 `<recall>` / `<note-board>` / `<goal-snapshot>` 继续走 per-turn recall。

## 2. 侦察结论（2026-10-27 实证）

### 2.1 API 面

从 running serve 的 OpenAPI（经 gateway 反代 `GET http://127.0.0.1:3000/openapi.json`）确认：

| 动词 | 路径 | 语义 |
|---|---|---|
| GET | `/api/experimental/session/{sessionID}/instructions/entries` | 列出 API-managed entries，返回 `{data:[{key,value}]}` |
| PUT | `/api/experimental/session/{sessionID}/instructions/entries/{key}` | body `{value:<JSON>}`，204；不存在则创建，存在则替换 |
| DELETE | `/api/experimental/session/{sessionID}/instructions/entries/{key}` | 204（软删除，`removed=1`） |

- key 正则：`^[a-z0-9][a-z0-9._-]*$`；大写 key → 400。
- value 是任意 JSON；字符串/对象/数组均实测可存。
- 单条 70KB 字符串实测接受；413 错误类型为 `InstructionEntryValueTooLargeError`（上限未在 spec 暴露，三块预算远低于此）。
- 描述原文：*Attach or replace one durable instruction entry. Changes announce as updates at the next step boundary.*
- 当前 `session.instructions.updated` 在 `gateway/src/runtime/opencode-21-events.ts` 的 `NOISE_TYPES` 里被显式压制；本批不改变该压制（见 §4.9）。

### 2.2 存储与渲染

opencode 2.1 的 SQLite（`~/.local/share/opencode/opencode.db`）里：

- `instruction_entry(session_id, key, value, removed, time_created, time_updated)`：value 是 **JSON 序列化文本**。
- `instruction_blob(hash, value)`：按内容哈希存渲染后的指令块。
- `instruction_state(session_id, epoch_start, through_seq, initial_values, current_values)`：每个 source 的当前哈希；`initial_values` / `current_values` 是变更公告的基线。

API entry 在 state 里以 `api/<key>` 命名；内置 source 以 `core/<name>` 命名。实测一个 session 的 `current_values`：

```json
{
  "core/codemode": "<hash>",
  "core/skill-guidance": "<hash>",
  "core/date": "<hash>",
  "core/environment": "<hash>",
  "api/mafw.obj": "<hash>",
  "api/mafw.arr": "<hash>"
}
```

对应的 blob 值就是 **JSON 文本**：

```
core/date            -> "Tue Oct 27 2026"
core/environment     -> "<env>\n  Working directory: ...\n</env>"
api/mafw.obj         -> {"text":"OBJ-777","n":3}
api/mafw.arr         -> [1,2,"three"]
```

含义：

1. 指令不是「一段纯文本」，而是 **source key → JSON value** 的映射；字符串会被 JSON 引号/换行转义。
2. 变更公告由 opencode 生成（二进制字符串实证）：`The context under "<key>" changed and supersedes the previous value:"<new>" ... " no longer applies. Disregard it.`——只在 source 变化时出现，正是我们要的边界语义。
3. `core/date` / `core/environment` / `core/skill-guidance` / `core/codemode` 已在生产使用同一机制；说明它不是玩具通道。
4. `core/codemode` / `core/skill-guidance` 也意味着 T2-5 能力发现在 opencode 2.1 已有原生承载（本批不展开）。

### 2.3 生命周期实证

- **fork**：对临时 session fork 后，新 session 的 entries 原样复制（含 `mafw.obj`/`mafw.arr`）。→ fork 不需要首轮补写也能看到旧块。
- **模型可见性**：临时 session 写入 `mafw.obj` / `mafw.arr` 后发 prompt，模型能复述两个 key 的值；说明 entries 确实进入 system instructions，而非仅落库。
- **删除**：DELETE 后 GET 不再返回该 key；DB 行保留 `removed=1`（软删除）。
- **revert/compaction**：本次未完成可靠实证（revert 探针返回 500，未继续）；设计按「可能被清空」处理——每次 gateway prompt 前都会 sync，所以即使被清空也会在下次 LLM 调用前补回。compaction 的冒烟验收项见 §5。
- **`session.instructions.updated` 事件**：本批写入会触发；当前被压制，属于预期噪音，不能当 unknown event 处理。

### 2.4 现有注入链

- opencode 插件 v2：`src/plugin.ts` 的 `session.hook('context')` 里，`event.system` 数组每轮追加 `memoryGuideHook` / `userProfileSystemHook` / `agentPriorsSystemHook`；同时 `sessionRecallHook` 往 messages 尾部注入 `<recall>`。
- pi：`gateway/src/runtime/pi/pi-mafw-host-extension.ts` 的 `before_agent_start` 注入 `MEMORY_GUIDE` + pinned profile；当前没有 priors。
- gateway 已有唯一静态 guide：`gateway/src/runtime/host-adapter.ts` 的 `MEMORY_GUIDE`（与插件里的副本同文）；pi 宿主扩展直接 import 它。
- gateway 已有 pinned / priors 的渲染 handler（`routes/pinned-recall.ts` / `routes/agent-priors.ts`），本批复用，不重写排序。
- prompt 包装已有先例：`runtime/identity-state.ts::withIdentityPrompt` 用 Proxy 只覆写 `promptAsync`/`prompt`，其余方法透传；`wrapRuntimeIdentity` 在 runtime 创建后统一套用。本批在同一位置叠加 instruction sync 包装。

## 3. 目标 / 非目标

### 目标

1. opencode 2.1 的会话在**每次 gateway prompt 前**把三块写成 per-session instruction entries：
   - `mafw.memory-guide`（静态）
   - `mafw.user-profile`（pinned；空则删除）
   - `mafw.agent-priors`（L5+L2；空则删除）
2. 只在内容哈希变化时 PUT；未变化不写；空块 DELETE。避免每轮触发「context changed」公告。
3. gateway 为三块的**单一渲染源**；插件/pi 通过一个 `GET /api/recall/instructions` 读取，避免三处重复渲染。
4. 插件在 `managed=true` 时不再往 `event.system` 注入三块；`managed=false` 时只补**缺失**的块；gateway 不可达时使用 last-good 缓存/内置 guide 兜底。
5. pi 保持现有 `before_agent_start` 注入路径，但改为从新 endpoint 取三块，补上 priors。
6. 新增 runtime 能力 `instructionsApi`，opencode 2.1 = true，pi / opencode@v1 / opencode@v2 = false。
7. 不阻塞 prompt：整个 sync 硬预算 250ms，超时 abort；失败不抛、下次 prompt 重试。
8. 可观测：`/api/recall/instructions?sessionID=` 返回 `managed` / `revision` / `missing` / `staleKeys` / `reason` / `blocks`；日志记录写入 key 与失败原因。

### 非目标

- 不迁移 `<note-board>` / `<goal-snapshot>` / `<voice-guide>`（后续批次候选；它们仍走 per-turn recall / system 注入）。
- 不新增 UI（桌面/TUI 不展示/编辑 instruction entries）。
- 不把 `session.instructions.updated` 升级为 canonical 事件；也不进 SDK event union。
- 不改变 pinned / priors 的排序、预算、authority 语义。
- 不做 opencode <2.1 的 instruction entries 兼容（走回退注入）。
- 不做 session export/import 对 instruction entries 的携带（T2 会话可携带性单独立项；本批在边界记录）。
- 不改变 T2-5 能力发现 / skills / commands 广播。

## 4. 设计

### 4.1 总览

```
Before（每轮 LLM 调用）:
  opencode context hook
    event.system += <memory-guide>
    event.system += <user-profile>
    event.system += <agent-priors>
    messages 尾部 += <recall> pointers

After:
  gateway prompt wrapper (before runtime prompt)
    render 3 blocks -> compare hashes -> PUT/DELETE instruction entries
  opencode instruction source map
    core/* + api/mafw.memory-guide + api/mafw.user-profile + api/mafw.agent-priors
  opencode context hook
    GET /api/recall/instructions?sessionID=...
      managed=true  -> 不注入
      managed=false -> 只补 missing blocks（回退）
    messages 尾部 += <recall> pointers（不变）

  pi before_agent_start
    GET /api/recall/instructions?sessionID=...
      -> 追加 memoryGuide + userProfile + agentPriors（pi 无 entries，恒 managed=false）
```

### 4.2 单一渲染源

新增 `gateway/src/recall/instruction-blocks.ts`：

```ts
export interface InstructionBlocks {
  memoryGuide: string;
  userProfile: string | null;
  agentPriors: string | null;
  /** 单块渲染失败（null 但非空）：sync 保留旧 entry，不删除。 */
  errors?: { userProfile?: string; agentPriors?: string };
  revision: string; // sha256(JSON.stringify({memoryGuide,userProfile,agentPriors}))
}

export interface InstructionBlockDeps {
  getPinnedProfile(): Promise<string | null>; // 复用 handleRecallPinned
  getAgentPriors(): Promise<string | null>;   // 复用 handleAgentPriors
}

export async function renderInstructionBlocks(deps: InstructionBlockDeps): Promise<InstructionBlocks>;
```

- `MEMORY_GUIDE` 从 `runtime/host-adapter.ts` import 并 re-export（保持 pi 现有 import 不破）；文案微调：
  - pinned 条目「每轮保证注入」→「常驻披露层（instruction entries）」
  - sticky 条目「每轮必见」→「常驻可见，到期自动下架」
- `getPinnedProfile` / `getAgentPriors` 由 index.ts 用现有 route handler + 同一 deps 构造，不复制排序逻辑。
- 每个块独立 fail-open：某一侧渲染**抛错** → 该块 `null` + `errors.<key>`（sync 保留旧 entry）；渲染成功但内容为空 → `null` 且无 error（sync 删除）。
- `revision` 用 Node `crypto.createHash('sha256')`，对三块 JSON 序列化后求值；用于 endpoint 与日志，不落库。

### 4.3 `InstructionSyncService`

新增 `gateway/src/core/instructions/instruction-sync-service.ts`。

```ts
export interface InstructionSyncDeps {
  render(signal?: AbortSignal): Promise<InstructionBlocks>;
  getRuntime(): AgentRuntime | null;
  isEnabled(): boolean;      // config.recall.instructions.enabled !== false
  now?: () => number;
  log?: { info(msg: string): void; warn(msg: string): void };
  syncTimeoutMs?: number;    // default 250（整个 sync 的硬预算）
  disabledCooldownMs?: number; // default 60_000（404/405 熔断）
  maxBlockBytes?: number;    // default 16 * 1024
}

export class InstructionSyncService {
  sync(sessionID: string): Promise<{ managed: boolean; revision?: string; error?: string }>;
  /** endpoint 用：实际 list + 期望值比较，返回 missing/stale。 */
  inspect(sessionID: string, blocks: InstructionBlocks): Promise<{
    managed: boolean;
    missing: string[];
    staleKeys: string[];
    reason?: 'capability_absent' | 'disabled' | 'list_failed' | 'breaker';
  }>;
  forget(sessionID: string): void;
  reset(): void; // runtime switch / serve recovery
  diagnostics(): { disabledUntil?: number; disabledReason?: string; lastError?: string };
}
```

**sync(sessionID) 算法**：

1. `isEnabled()` 为 false：
   - best-effort 删除本 session 的三个 key（短超时；清理混合版本遗留）。
   - 返回 `{managed:false, error:'disabled'}`；不做其他写入。
2. `rt = getRuntime()`；无 `rt?.capabilities.instructionsApi` 或 `!rt.session.instructions` → `{managed:false, error:'capability_absent'}`。**能力位是唯一闸门**：`activeDialect` 探测在 gateway 重启后可能 fail-safe 成 v1，不能据此禁用；`@v1/@v2` 已声明 false，真 404/405 走熔断。
3. 若熔断未过期（`now < disabledUntil`）→ `{managed:false, error:disabledReason}`；不访问 API。
4. 单飞：同 session 并发 prompt 共用一次 sync（`Map<sessionID, Promise>`）。
5. 创建 `AbortController`；`setTimeout(abort, syncTimeoutMs)`；**整个 sync（render + list + PUT/DELETE）共用这个 signal**。
6. 渲染 blocks（`render(signal)`；render 内部只读本地 store，signal 用于提前退出）。
7. **每次 sync 先 `list(sessionID, {signal})`**，用实际 entries 构建 key→value 视图。不保留 write cache：外部删除/revert/compaction/fork/CLI 写入都会让缓存撒谎；list 是 presence 权威（本机一次 GET，250ms 预算内）。smoke 已实证：外部删 `mafw.user-profile` 后，仅靠 cache 的下一轮不会补回。
8. 对每个目标 key：
   - `errors.<key>` 存在 → **skip**（保留旧 entry；不删）。
   - `value` 非空：与 list 值相同 → skip；不同/缺失 → `put(sessionID, key, value, {signal})`。
   - `value` 为空/null 且无 error：list 显示存在 → `remove(sessionID, key, {signal})`。
   - 超过 `maxBlockBytes` → 截断到上限 + warn。
9. `signal.aborted` → 返回 `{managed:false, error:'timeout'}`，不更新任何 sync 状态。
10. 全部成功 → 返回 `{managed:true, revision}`。
11. 任一操作失败 → warn（每 session 每 5 分钟最多一次），返回 unmanaged；下一次 prompt 重试。
12. `err.status === 404 || 405` → `disabledUntil = now + disabledCooldownMs`，`disabledReason`，warn 一次；后续 sync 在窗口内直接 unmanaged。窗口过期后自动重试；成功后清空熔断。
13. session 删除/`session.deleted` 事件 → `forget(sessionID)`（只清单飞表；无内容缓存）。

**inspect(sessionID, blocks)**（endpoint 用；只读）：

1. 能力缺失 / 未启用 / 熔断 → `{managed:false, missing: allNonEmptyKeys, staleKeys:[], reason}`。
2. `list(sessionID, {signal})`（150ms 超时；不写）：
   - 失败 → `{managed:false, missing: allNonEmptyKeys, staleKeys:[], reason:'list_failed'}`。
3. 对三个目标 key：
   - 期望非空且 present 且字符串值相同 → current。
   - 期望非空且 absent → `missing`。
   - 期望非空且 present 但值不同 → `staleKeys`（**不注入**；下一次 gateway prompt 会更新）。
   - 期望为空但 present → `staleKeys`（下一次 gateway prompt 会删除；不注入）。
4. `managed = missing.length === 0`（present-but-stale 仍算 managed，避免回退注入与 entry 重复；stale 只做诊断）。
5. `missing` 的 blocks 只返回对应块；`managed=false` 时插件只补这些块。

**为什么 `managed` 用实际 list 而不是内存 flag**：entries 是 durable 的，内存 flag 在 gateway 重启、fork、compaction/revert 后都可能与实际状态脱节。list 是唯一事实源；代价是每 session 每 5 秒一次本地 GET（插件缓存），可接受。

**为什么 stale 不注入**：同一 key 的 entry 已存在时再注入 fallback 会让模型看到新旧两份；宁可保留旧值到下一次 gateway prompt 更新。直接 opencode CLI/TUI 的 pinned 更新可能滞后一轮，作为已记录限制。

### 4.4 Runtime 契约与能力

`gateway/src/runtime/contract.ts`：

```ts
export interface RuntimeCapabilities {
  // ...
  /** opencode 2.1 per-session instruction entries（experimental） */
  instructionsApi?: boolean;
}

export interface RuntimeClient {
  session: {
    // ...
    instructions?: {
      list(sessionID: string, opts?: { signal?: AbortSignal }): Promise<Array<{ key: string; value: unknown }>>;
      put(sessionID: string, key: string, value: unknown, opts?: { signal?: AbortSignal }): Promise<void>;
      remove(sessionID: string, key: string, opts?: { signal?: AbortSignal }): Promise<void>;
    };
  };
}
```

- `fullCapabilities()`：`instructionsApi: true`（当前 opencode 2.1 形状）。
- `minimalCapabilities()`：`instructionsApi: false`。
- `gateway/src/index.ts` 的 `opencode@v1` / `opencode@v2` 注册改为 `{ ...fullCapabilities(), instructionsApi: false }`；`opencode@v21` 与默认 `opencode` 保持 true。
- `opencode-adapter.ts` 实现：
  ```ts
  instructions: {
    list: async (sessionID, opts) => unwrapNative(await directNative(
      `/experimental/session/${sessionID}/instructions/entries`, 'GET', undefined, undefined, opts)),
    put: async (sessionID, key, value, opts) => {
      await directNative(`/experimental/session/${sessionID}/instructions/entries/${encodeURIComponent(key)}`,
        'PUT', { value }, undefined, opts);
    },
    remove: async (sessionID, key, opts) => {
      await directNative(`/experimental/session/${sessionID}/instructions/entries/${encodeURIComponent(key)}`,
        'DELETE', undefined, undefined, opts);
    },
  }
  ```
- `directNative` 增加第 5 个可选参数 `opts?: { signal?: AbortSignal }`，透传给 `fetch`；非 2xx 时抛出的 Error 带 `status` 属性（供熔断判定）。现有调用零改动。
- `pi-runtime.ts` 不实现 `instructions`，能力保持 false（`minimalCapabilities` 基线）。
- 插件热切换：`wrapRuntimeIdentity` 每次 runtime 创建/切换都会重新套 sync 包装，并调用 `instructionSync.reset()` 清熔断/最后错误；sync service 每次 `sync` 现读 runtime，无需重启。

### 4.5 Prompt 包装与生命周期

新增 `gateway/src/runtime/instruction-wrapper.ts`（或与 sync service 同文件）：

```ts
export function withInstructionSync<T extends { promptAsync(o:any):Promise<any>; prompt(o:any):Promise<any> }>(
  session: T,
  sync: (sessionID: string) => Promise<unknown>,
): T {
  return new Proxy(session as any, {
    get(target, prop, receiver) {
      if (prop === 'promptAsync') return async (o: any) => {
        try { await sync(o.sessionID); } catch { /* fail-open */ }
        return target.promptAsync(o);
      };
      if (prop === 'prompt') return async (o: any) => {
        try { await sync(o.sessionID); } catch { /* fail-open */ }
        return target.prompt(o);
      };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as unknown as T;
}
```

接线顺序（`index.ts::wrapRuntimeIdentity`）：

```ts
const synced = this.instructionSync
  ? withInstructionSync(rt.session as any, (sid) => this.instructionSync!.sync(sid))
  : rt.session;
(rt.session as any) = withIdentityPrompt(synced as any, ...);
```

- **identity 在外、sync 在内**：`withIdentityPrompt` 的队列拦截（busy + delivery:'queue'）先短路，不会为入队消息做无谓 sync；真正 flush 时再次走 promptAsync，会 sync。
- 覆盖所有 gateway-driven prompt：HTTP prompt / promptAsync、queue flush、run resume、goal node、worker、media；不覆盖用户在 opencode CLI/TUI 直接发起的 prompt（此时插件按 endpoint 的 missing/stale 回退，见 §4.6）。
- **延迟预算**：sync 整体硬上限 250ms（render + list + 最多 3 个 PUT/DELETE）；正常路径目标 p95 < 50ms。超时 abort 后 prompt 继续，下一次 prompt 重试。
- 不改变 `session.messages/list/get/...` 等其余方法（Proxy 透传，沿用 identity wrapper 的既有模式）。

### 4.6 插件与 pi 回退

**新 endpoint**：`GET /api/recall/instructions?sessionID=<id>`（注册在 `/api/recall/pinned` 附近、dashboard 兜底之前）：

```jsonc
// 被 gateway 管理且三块齐全
{
  "managed": true,
  "revision": "<sha256>",
  "missing": [],
  "staleKeys": [],
  "blocks": {}
}

// 回退路径（pi / opencode<2.1 / missing / list 失败 / 熔断）
{
  "managed": false,
  "revision": "<sha256>",
  "missing": ["mafw.user-profile"],
  "staleKeys": [],
  "reason": "capability_absent" | "list_failed" | "breaker" | "disabled",
  "blocks": {
    "memoryGuide": "<memory-guide>...</memory-guide>",
    "userProfile": "<user-profile>...</user-profile>",
    "agentPriors": null
  }
}
```

- `blocks` 只含 `missing` 对应的非空块；`managed=true` 时为空对象。
- pi / 无 instructions API / 熔断 / list 失败：`missing=allNonEmptyKeys`，`blocks=all`（回退全量；list 失败时可能产生重复，作为降级语义记录）。
- 渲染失败：对应块 `null`/缺席；HTTP 200 fail-open。
- 不新增 SDK 方法（插件/pi 走 loopback HTTP；桌面不需要）。

**opencode 插件**：

- 新增 `src/hooks/instruction-blocks.ts`：
  - `instructionBlocksSystemHook({sessionID}, output)`；
  - 每 session 5s TTL 缓存 endpoint 结果；另存 10min last-good 结果（`managed` + `blocks`）；
  - `managed=true` → 什么都不做；
  - `managed=false` → 按 memoryGuide → userProfile → agentPriors 追加 `blocks` 中存在的块（只补 missing，不重复已有 entry）；
  - endpoint 失败：
    - last-good 存在且 `managed=true` → 不注入（信任 entries）；
    - last-good 存在且 `managed=false` → 注入 last-good `blocks`；
    - 无 last-good → 只注入内置 `MEMORY_GUIDE`（见下）。
- `src/plugin.ts` 的 context hook：
  - 删除 `memoryGuideHook` / `userProfileSystemHook` / `agentPriorsSystemHook` 三行；
  - 改为 `await instructionBlocksSystemHook({ sessionID }, sysOut)`；
  - `voiceGuideSystemHook` 保留（本批不迁）。
- **内置 guide 兜底**：保留 `src/hooks/memory-guide.ts` 的 `buildMemoryGuide()`（与 gateway `MEMORY_GUIDE` 同文的 fail-open 副本；不参与正常路径）。删除 `user-profile.ts` / `agent-priors.ts`（数据只从 endpoint 取）。
- 测试改：`tests/plugin-v2.test.ts` 的「appends memory-guide, pinned profile and agent priors」改为：
  - `managed:true` → `event.system` 不含三块；
  - `managed:false` + missing → 只出现 missing 块（顺序 memoryGuide → userProfile → agentPriors）；
  - endpoint 500 + 无 last-good → 只有内置 `<memory-guide>`；
  - endpoint 500 + last-good managed=true → 不注入；
  - 5s 缓存命中（fake fetch 计数）。

**pi**：

- `MafwHostClient` 增加 `fetchInstructionBlocks(sessionID)`（loopback GET，150ms 超时，fail-open）。
- `pi-mafw-host-extension.ts` 的 `before_agent_start`：
  - 成功 → 追加 `blocks.memoryGuide` + `userProfile` + `agentPriors`（三块，块间 `\n\n`）；
  - 失败 → 仍追加 `MEMORY_GUIDE`（保持现有静态兜底），profile/priors 跳过。
- 因为 pi 不声明 `instructionsApi`，endpoint 恒返回 `managed:false` + 全量 blocks；不需要在 pi 侧判断 managed。
- 现有 pi 测试更新：断言三块；失败路径断言 memory-guide 仍在。

### 4.7 键与值约定

| key | 内容 | 空值行为 |
|---|---|---|
| `mafw.memory-guide` | `MEMORY_GUIDE` 全文（含 `<memory-guide>` 标签） | 恒非空，不删除 |
| `mafw.user-profile` | `formatPinnedProfile()` 输出（含 `<user-profile>`） | 无 pinned → DELETE |
| `mafw.agent-priors` | `formatAgentPriors()` 输出（含 `<agent-priors>`） | 空 → DELETE |

- 值是**字符串**，不是 `{text:string}` 对象。理由：opencode 内置 `core/date` / `core/environment` 同样用 JSON 字符串；模型实测能读。避免对象包装多一层转义。
- 在 opencode 的 `instruction_state` 中会显示为 `api/mafw.memory-guide` / `api/mafw.user-profile` / `api/mafw.agent-priors`。
- key 只允许小写字母/数字/`.`/`_`/`-`，已满足正则；不要加版本后缀（版本在值/revision 里）。
- 单块上限 16KB（正常预算：guide ~2KB、pinned ≤2000 字、priors ≤800 字）；超限截断 + warn，不阻塞 prompt。
- 不写 opencode 的 SQLite 表；只走 HTTP API。
- **渲染失败 vs 空值**：`errors.<key>` 存在 → 保留旧 entry（不删）；`null` 且无 error → 删除。避免一次临时读失败把旧 profile 删掉。

### 4.8 失败模式与降级

| 场景 | 行为 |
|---|---|
| opencode 2.1 正常 | prompt 前 sync；插件 endpoint list 三 key 齐全 → managed=true 跳过；模型从 instructions 读三块 |
| gateway 重启 | entries 仍 durable；endpoint list 仍齐全 → managed=true；不重复注入；下一次 gateway prompt sync 幂等 |
| opencode <2.1 / pi | `instructionsApi=false` → endpoint `managed=false` + 全量 blocks；插件/pi 注入 |
| 实验 API 404/405 | 60s 熔断；endpoint `managed=false` + 全量 blocks；插件回退；熔断过期自动重试，成功后清空 |
| 单块渲染抛错 | 该块保留旧 entry（skip）；其余块照常 PUT/DELETE；endpoint 对该块返回 null；session 不标记 managed（下次重试） |
| 单块内容为空（非错误） | DELETE 对应 key；模型不再看到旧块 |
| sync 超时/网络错 | AbortController 中止；不阻塞 prompt；不更新 sync 状态；endpoint 若 list 仍齐全则 managed=true；否则回退 missing |
| 部分 sync 失败（如 profile PUT 失败） | 成功块已写，失败块保持旧值；endpoint 只补缺失块；不重复整块 |
| fork | entries 已由 opencode 复制；每次 sync list 实际 entries，值一致 → 零 PUT；endpoint list 齐全 → managed=true |
| revert/compaction | entries 若保留 → managed=true；若被清空 → endpoint missing → 插件只补缺失；下一次 gateway prompt sync 补回 |
| session 删除 | opencode FK 级联；gateway `forget(sessionID)` |
| 用户在 opencode CLI/TUI 直接 prompt | 无 gateway sync；endpoint list：齐全 → managed=true（stale 不注入）；缺失 → 只补 missing。pinned/priors 更新可能滞后到下一次 gateway prompt |
| gateway 不可达 | 插件用 10min last-good：managed=true → 不注入；managed=false → 注入 last-good blocks；无 last-good → 只注入内置 `MEMORY_GUIDE` |
| gateway + 旧插件混装 | 旧插件仍每轮注入，entries 可能重复；`recall.instructions.enabled=false` 关闭 sync，并在下一次 gateway prompt 懒删除本 session 三 key；无 gateway prompt 的旧 session 可能残留 entry（已记录） |
| 配置 `enabled=false` | 停止 sync；下一次 gateway prompt best-effort 删除本 session 三 key；endpoint `managed=false` + 全量 blocks；插件回退注入 |

### 4.9 可观测性

- `GET /api/runtime` 的 active capabilities 自动多出 `instructionsApi`；`dialect` 已有。
- `GET /api/recall/instructions?sessionID=` 返回 `managed/revision/missing/staleKeys/reason/blocks`，是排障主入口。
- 日志：
  - `[Instructions] session=<sid> synced keys=<n> revision=<8位>`（debug）
  - `[Instructions] session=<sid> sync failed: <status/msg>`（warn，每 session 每 5 分钟最多一次）
  - `[Instructions] breaker open until <ts>: <reason>`（warn 一次）
- `session.instructions.updated` 继续在 `NOISE_TYPES` 压制；本批写入会让 `translationDrops.suppressed` 计数上升，属预期。不要把它接到 `unknownEvents`。
- 不新增 canonical 事件、不改 SDK event union、不改桌面/TUI dispatcher。

### 4.10 不做的事（明确边界）

- 不把 note-board / goal-snapshot / voice-guide 迁入 entries（下一批）。
- 不把 `core/*` 内置 source 关掉或改写；只加 `api/mafw.*`。
- 不做 instruction entries 的桌面 UI、diff、编辑、审计。
- 不做 session export/import 携带；导入后首次 gateway prompt 会重新 sync。
- 不做 instruction entries 的 per-entry TTL；内容变化由 sync 驱动。
- 不做多 gateway 实例一致性（当前单实例架构）。

## 5. 测试与验收

### 5.1 单元/集成测试

Gateway（jest）：

1. `instruction-blocks.test.ts`
   - 三块正常渲染；revision 稳定；内容变化 revision 变化。
   - pinned/priors 为空 → null（无 error）。
   - 单块抛错 → 该块 null + errors；其余仍返回。
2. `instruction-sync-service.test.ts`
   - 每次 sync：list + PUT 缺失/不同 key；无 write cache。
   - 第二次相同内容：list 出现，但零 PUT / 零 DELETE。
   - 单块变化：只 PUT 该 key。
   - 空块（无 error）：DELETE；已有 key 被移除。
   - 渲染抛错：保留旧 entry，不 DELETE；其余 key 正常。
   - list 返回已有相同值：不 PUT（fork/重启场景）。
   - 整个 sync 超时：AbortController 触发；返回 unmanaged；不更新 sync 状态；prompt 不被阻塞（wrapper 测试）。
   - 并发 sync 单飞。
   - 404/405 → 60s 熔断；窗口内不再访问 API；过期后重试成功清熔断；`reset()` 立即清。
   - `enabled=false` → best-effort DELETE 三 key + unmanaged；endpoint 返回全量 blocks。
3. `recall-instructions-route.test.ts`
   - 三 key 齐全 → managed=true，blocks={}。
   - 缺 `mafw.user-profile` → managed=false，missing 只含该 key，blocks 只含该块。
   - present-but-stale → managed=true，staleKeys 含该 key，blocks 不注入。
   - 无 instructions API / list 失败 / 熔断 → managed=false + 全量 blocks。
   - 无 sessionID / 渲染失败 → 200 fail-open。
4. `opencode-adapter.instructions.test.ts`
   - list 解包 `{data}`；put body `{value}`；delete 204；URL 编码 key；signal 透传；错误带 status。
5. `instruction-wrapper.test.ts`
   - promptAsync/prompt 先 sync 再调用；sync 抛错不阻断；其余方法透传。
   - 与 identity 的队列拦截顺序：入队消息不触发 sync（或至少不阻塞）。
   - sync 超过 250ms 时 prompt 仍在预算内继续（模拟慢 sync）。
6. 能力测试：`fullCapabilities().instructionsApi === true`；`minimalCapabilities()` false；`opencode@v1/@v2` 注册覆盖 false。

Plugin（node --test / bun? 以现有 `tests/plugin-v2.test.ts` 为准）：

7. managed=true → `event.system` 不含三块。
8. managed=false + missing → 只追加 missing 块；顺序 guide → profile → priors。
9. endpoint 500 + 无 last-good → 只有内置 `<memory-guide>`。
10. endpoint 500 + last-good managed=true → 不注入；last-good managed=false → 注入 last-good blocks。
11. 5s 缓存：同一 session 连续 context hook 只请求一次（fake fetch 计数）。

Pi（jest）：

12. `pi-mafw-host-extension.test.ts`：成功 → 三块；失败 → `MEMORY_GUIDE` 仍在、profile/priors 缺失。
13. `host-adapter.test.ts`：`MEMORY_GUIDE` 文案更新后仍含 `<memory-guide>` 与 `## 记忆`。

### 5.2 活体冒烟（本机 gateway + opencode 2.1）

1. 创建临时 session（temp 项目）→ 发一个 prompt。
2. `GET /api/experimental/session/{sid}/instructions/entries` → 三个 `mafw.*` key 存在，值非空。
3. `GET /api/recall/instructions?sessionID=` → `managed:true`，`revision` 非空，`missing=[]`。
4. 第二个 prompt（内容不变）→ entries 的 `time_updated` 不变；`instruction_state.current_values` 三 key 哈希不变。
5. 修改一条 pinned 记忆（临时写入 + pin）→ 下一个 prompt → `mafw.user-profile` 值变化；旧值被新值取代。
6. 清空 pinned / priors（临时）→ 下一个 prompt → 对应 key 被 DELETE；GET 不再返回。
7. 手动删除 `mafw.user-profile` entry（模拟部分缺失）→ `GET /api/recall/instructions` → `managed:false`、`missing=["mafw.user-profile"]`、`blocks` 只含 profile；gateway prompt 后恢复 managed=true。
8. 插件回退：把 `recall.instructions.enabled=false` → endpoint `managed:false` + 全量 blocks；下一次 prompt 后三 key 被删除；恢复 true 后重新 sync。
9. pi 路径：切到 pi（若有测试 runtime）→ endpoint `managed:false` → `before_agent_start` 注入三块；或至少单测覆盖。
10. fork 临时 session → 新 session GET entries 仍含三 key；endpoint managed=true。
11. compaction：对临时 session 执行 `summarize` → entries 仍存在；GET 仍返回；endpoint managed=true。
12. `GET /api/runtime` → `capabilities.instructionsApi:true`（opencode） / false（pi）。
13. 清理：删除临时 entries / session；确认无 70KB 测试残留。

### 5.3 全量门禁

- gateway jest 全量绿（预计 2807 + 新增 ~35）。
- root `npm run build` 绿（plugin + gateway + SDK + TUI）。
- desktop `bun test` 全量绿（预计 1534，本批不改桌面，但需确认无回归）。
- session-ui / SDK / TUI 全量绿（本批预计无改动，仍跑）。
- 汇报新增测试数量 + 全量通过数（用户偏好）。
- 版本 v4.40.0；提交前 `git status` 只含本批文件；不 stage 并行未跟踪文档。

## 6. 风险与开放问题

1. **实验 API 不稳定**：路径带 `experimental`，2.2 可能改。缓解：`instructionsApi` 能力位 + 404/405 60s 熔断 + 插件回退 + 配置逃生开关；未来只改 adapter/sync service。
2. **JSON 转义的可读性与 token 开销**：多行 markdown 会变成 `"\n"` 转义。模型实测能读；但 token 数略增。缓解：三块预算固定（<8KB），不把 note-board/goal-snapshot 一起塞入；如实测 token 明显变差，再评估结构化 value 或缩短文案。
3. **缓存收益不确定**：opencode 的 instruction source map 还含 `core/date`（每天变）、`core/codemode`（工具目录变）等，整体前缀仍会因这些 source 变化而断。缓解：验收以「entries 稳定 + 不再每轮 system 注入」为主，缓存命中率作为观测项而非硬门槛；如果收益为负，可只迁 profile/priors，memory-guide 留在 system。
4. **混合版本重复**：新 gateway + 旧插件时，旧插件仍注入三块，entries 也存在 → 重复。缓解：`recall.instructions.enabled=false` 关闭 sync，并在下一次 gateway prompt 懒删除本 session 三 key；发布说明要求 gateway/plugin 同版本升级。v1 不做客户端握手（避免复杂度）。
5. **revert/compaction 语义未完全实证**：fork 已实证复制；revert 探针 500，compaction 未跑。设计按「可能清空、下一次 gateway prompt 补回」处理；冒烟必须覆盖 compaction；若 revert 会清空且用户在 opencode 直接 prompt，插件在 endpoint missing 时会补缺失块（不会重复）。
6. **直接 opencode CLI/TUI 的 stale 窗口**：无 gateway prompt 时，pinned/priors 变化不会立即更新 entries；endpoint 会报告 `staleKeys`，但插件不注入（避免新旧两份）。下一次 MAFW 桌面 prompt 会更新。记录为可接受限制。
7. **gateway 不可达的重复风险**：插件用 last-good；若 last-good 是 `managed=false` 且 entries 后来被 sync 写入，网关恰好不可达时可能重复。10min 缓存窗口 + 本机 loopback 场景，概率低；记录为降级语义。
8. **pi 的 `before_agent_start` 时机**：pi 在每次 agent start 注入；若 pi 运行中 pin 变化，下一轮 agent start 才更新。与现状一致（现状也是每次 start 拉 pinned）。不引入新问题。
9. **session export/import**：entries 不随 export 携带；导入后首次 gateway prompt 会重 sync。若用户在 opencode 直接使用导入会话，插件按 missing 回退。记录为 T2 可携带性边界。
10. **内部/worker 会话**：当前插件对所有 opencode 会话注入三块；本批保持 parity（不按 parentID/role 过滤）。若 worker 会话不需要 memory-guide，可后续加白名单，但会改变现有行为，本批不做。

### Builder check 5 问的裁决（本 spec 的最终选择）

1. **managed 语义**：不用内存 TTL flag；endpoint 每次 `list` 实际 entries，`managed = 所有期望非空 key 都存在`。缺失块才回退注入；present-but-stale 只报 `staleKeys`、不注入（避免新旧两份）。gateway 重启/fork/compaction 后以实际 entries 为准。
2. **gateway 不可达**：插件保留内置 `MEMORY_GUIDE` + 10min last-good endpoint 缓存；last-good managed=true 不注入，managed=false 注入 last-good blocks，无 last-good 只注入 guide。明确“可能重复”只在 last-good 与 entries 脱节的窄窗口发生。
3. **超时**：250ms 是整个 sync 的硬预算（render + list + PUT/DELETE），AbortSignal 贯穿 adapter；超时 abort、不更新 sync 状态、prompt 继续。正常路径 p95 < 50ms。
4. **enabled=false**：停止 sync + 下一次 gateway prompt 对本 session best-effort 删除三 key + endpoint 返回全量 blocks；无 gateway prompt 的旧 session 可能残留，已记录。
5. **404/405**：60s 熔断（非永久），窗口内不访问 API；过期自动重试，成功清熔断；runtime switch/serve recovery 调 `reset()` 立即清。

## 7. 实施拆分（供 plan）

1. **契约/能力**：`RuntimeCapabilities.instructionsApi`、`session.instructions` 可选方法（带 signal）；`fullCapabilities`/`minimalCapabilities`；`opencode@v1/@v2` 覆盖 false；adapter 实现 + 单测。
2. **渲染源**：`recall/instruction-blocks.ts` + `MEMORY_GUIDE` 文案调整 + 复用 pinned/priors handlers + 单测。
3. **Sync service**：`core/instructions/instruction-sync-service.ts`（list seed、hash diff、PUT/DELETE、单飞、250ms abort、60s 熔断、disabled 懒删除、错误保留旧 entry）+ 单测。
4. **Prompt 包装**：`runtime/instruction-wrapper.ts` + `wrapRuntimeIdentity` 接线（identity 外、sync 内）+ 单测。
5. **Endpoint**：`GET /api/recall/instructions`（list 检查 + missing/stale + fail-open）+ 接线（recall 路由区，dashboard 兜底前）+ 单测。
6. **插件回退**：`src/hooks/instruction-blocks.ts` + context hook 替换 + 删除 user-profile/agent-priors 旧 hook、保留 memory-guide 兜底 + 测试更新。
7. **pi 回退**：`MafwHostClient.fetchInstructionBlocks` + `before_agent_start` 三块 + 测试更新。
8. **冒烟脚本**：`gateway/scripts/smoke-instruction-entries.mjs`（创建/清理 temp session、GET/PUT/DB 断言、fork/compaction）；跑 13 项。
9. **收尾**：全量测试/构建、版本 v4.40.0、交付记录、清理临时 session/entries。

## 8. 附：侦察命令与证据（可复跑）

- OpenAPI：`curl http://127.0.0.1:3000/openapi.json`（gateway 反代到 serve，自动 Basic auth），搜索 `InstructionEntry` / `instructions/entries`。
- 条目 CRUD：
  ```bash
  curl http://127.0.0.1:3000/api/experimental/session/<sid>/instructions/entries
  curl -X PUT -H 'content-type: application/json' \
    -d '{"value":"MARKER"}' \
    http://127.0.0.1:3000/api/experimental/session/<sid>/instructions/entries/mafw.test
  curl -X DELETE \
    http://127.0.0.1:3000/api/experimental/session/<sid>/instructions/entries/mafw.test
  ```
- 存储：`~/.local/share/opencode/opencode.db` 的 `instruction_entry` / `instruction_blob` / `instruction_state`（只读查询；不要直接写）。
- 模型可见性：写入 `mafw.obj={"text":"OBJ-777","n":3}` / `mafw.arr=[1,2,"three"]`，发 prompt 要求复述；模型能读到两个 key 的值。
- fork：`POST /api/sessions/<sid>/fork {"messageID":"<msg>"}`；新 session GET entries 包含原 entries。
- 注意：临时 session / entries 用完必须 DELETE，避免把 70KB 探针值留在用户库。

## 9. 交付记录（v4.40.0）

### 提交

- `9add0cc5` docs: T2-4 instruction entries spec and plan
- `8f9cea6c` feat(runtime): instruction entries capability and adapter
- `0d21e412` feat(recall): render instruction blocks from one source
- `764233da` feat(gateway): instruction sync service
- `96d35974` fix(gateway): bound instruction sync cache（后被 `ff3e4c6a` 的 list-every-sync 取代）
- `d7b3b71e` feat(gateway): sync instruction entries before prompts
- `8897d5b3` feat(gateway): recall instructions endpoint
- `acf8636a` feat(plugin): instruction blocks fallback
- `67e7718e` feat(pi): instruction blocks fallback
- `d84fb063` fix(gateway): gate instruction sync on capability, not lagging dialect
- `ff3e4c6a` fix(gateway): list instruction entries every sync
- `814ab105` test(instructions): live smoke for instruction entries

### 测试与构建

- gateway：394 suites / **2847 passed**（T2-4 新增约 40 个用例；Jest 测试结束后因既有 open handle 不退出，结果已完成）
- root plugin：**28 passed**
- SDK：**158 passed**
- session-ui：**94 passed**
- desktop：**1573 passed**
- TUI：225（**224 passed / 1 skipped**）
- `npm run build` rc=0；gateway/desktop/session-ui typecheck rc=0

### 真机 smoke

`node gateway/scripts/smoke-instruction-entries.mjs` → **15/15 PASS**（runtime capability、三块 entries、endpoint managed/missing/revision、DB 三条、第二轮零写、外部删除后 missing-only、下一轮恢复、fork 复制三块）。

人工/单测覆盖未 live 执行：

- pinned 变更：不 live 写真实记忆（避免污染）；pinned 渲染与 user-profile 块由 renderer/route 单测覆盖。
- compaction：未 live 跑 summarize；list-every-sync 与 entries durable 语义在 service 单测覆盖，下一次 prompt 会补回。
- pi 回退：单测覆盖；切 runtime 需重启/切换，未在本批 live 执行。
- `enabled=false`：单测覆盖懒删除 + 全量 blocks；未改真实 config 重启。

### 已知边界

- 直接 opencode CLI/TUI 且不走 gateway prompt 时，pinned/priors 更新可能滞后到下一次 gateway prompt（endpoint 报 `staleKeys`，插件不注入旧/新两份）。
- gateway + 旧插件混装可能重复注入；`recall.instructions.enabled=false` 停止 sync 并在下一次 gateway prompt 懒删本 session 三 key。
- session export/import 不携带 entries；导入后首次 gateway prompt 会重新 sync。
- 本机部署本次只替换了全局包 `gateway/dist` 并重启 gateway；当前 agent serve 内的 opencode 插件仍可能是旧实例，`mafw restart-agent` 后加载新插件（新会话/重启后生效）。
