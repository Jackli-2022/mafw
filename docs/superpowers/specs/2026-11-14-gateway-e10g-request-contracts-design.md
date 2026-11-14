# Gateway E10g 请求契约（全量写请求）：设计（2026-11-14）

> 目标：给 catalog 的 **188 个写 op** 补请求契约：JSON body schema；无 body 的动作用空对象 + `required:false`；
> 二进制 / multipart / SSE / 原始透传显式列入排除表并说明原因。
> 响应契约已完成（E10f：125/318，JSON GET 100%）。

## 0. 管线缺口

`RouteDef` 只有 `response`；`toOpenApiPaths()` 不生成 `requestBody`。因此需要先加：

```ts
request?: object;                 // JSON Schema（TypeBox 或原生 JSON Schema）
requestContentType?: string;      // 默认 'application/json'；二进制用 'application/octet-stream'
requestRequired?: boolean;        // 默认 true；无 body 的动作用 false
```

投影：

```ts
if (def.request) op.requestBody = {
  required: def.requestRequired !== false,
  content: { [def.requestContentType ?? 'application/json']: { schema: def.request } },
};
```

**只声明、不运行时校验**（与 response 同策略）；handler 仍是事实源。

## 1. 分类规则

每个写 op 三选一：

1. **JSON body**：加 `request`（typebox）+ `requestRequired: true`。
2. **无 body 动作**（pause/resume/stop/abort/seen/cancel 等）：`request: Type.Object({})` + `requestRequired: false`；语义是“无字段”，不是“任意 body”。
3. **排除**（不入 catalog request，写入 `REQUEST_EXCLUDED` 清单与原因）：
   - 原始二进制：`media.upload`、`mobile.mediaTaskUpload`、`obs.capture` 等；
   - multipart/特殊 content-type；
   - SSE/流式请求（`tts.speakStream` 响应是流，但请求仍是 JSON → 按 JSON 处理）；
   - A2A 协议透传（`media.createTask`、`pods.a2a`、`events.webhook.receive`）；
   - 纯 query/path 参数且 body 被忽略的 op。

## 2. 批次（按域，顺序执行）

| 批次 | 域 | 约数 |
|---|---|---|
| P0 | RouteDef / registry / emit / coverage 台账 + 3 个 pilot | 3 |
| W1 | session 写接口（create/config/switch/fork/revert/checkpoint/prompt/queue/rename/delete/…） | ~32 |
| W2 | tasks / terminal / background / usage plugins / subagents / fileHistory | ~20 |
| W3 | pods 全部写接口 | ~24 |
| W4 | goals / decisions / lead / standing / goalRuns | ~30 |
| W5 | events / automations / approvals / questions / triage / permissions | ~30 |
| W6 | mcp / plugins / runtime / config / project / manager / commands | ~30 |
| W7 | memory / media / tts / chat / python / obs / models / embedding / tools / eval / llm / mobile / devices / a2a | ~30 |

每批一个 commit `(E10g-Wn)`；顺序执行（同一 worktree，避免 catalog/生成物冲突）。

## 3. 请求覆盖率台账

- `schema-coverage.cjs` 扩展输出：`requests: X/188 (write ops)`（解析 `request:`）。
- 收口新增 `gateway/tests/unit/architecture/request-coverage.test.ts`：
  - 每个写 op 必须 `request` 存在，或在 `REQUEST_EXCLUDED`（op → reason）中，二者恰好其一；
  - 排除项必须在 catalog 中存在；禁止既覆盖又排除；
  - 目标：`covered + excluded = 188`。
- 台账文件 `gateway/tests/unit/architecture/request-ledger.ts`（或测试内常量），由各批累加。

## 4. 非目标

- 运行时 body 校验（保持声明式契约）。
- 响应契约补充（已由 E10f 完成）。
- 二进制/multipart 的 multipart schema 建模（只排除并记录）。

## 5. 门禁

每批：gateway tsc 0 + registry/api-contract 相关 + analyze TOTAL 0 + SDK tsc/contract + `gen:api` 幂等。
收口：全量 gateway（9 env-red）、`requests: X/188`、SDK 226、desktop 全量、mobile/analyze、kernel-split 7/7。
