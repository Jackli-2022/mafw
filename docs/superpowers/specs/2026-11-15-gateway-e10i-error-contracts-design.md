# Gateway E10i 错误响应契约（全量）：设计（2026-11-15）

> 目标：给全部 327 op 建立**非 2xx 错误体契约**。当前只建模 200；客户端无法从 OpenAPI 得知错误形状。
> 采用「统一默认错误包 + 高价值路由显式状态码」策略，避免为 327 op 逐个手抄错误分支。

## 0. 基线

- catalog 327 ops（132 GET + 195 写）；200 响应 320/327（7 个非 JSON/流式排除）。
- 无错误响应建模；handler 的错误体大多为 `{error, code?}`，少数为 `{success:false,error}`、
  429 `{code:'quota_exceeded',resource,limit,current}`、503 `{error, code:'capability_unavailable'}`。

## 1. 设计

### 统一错误包
```ts
export const ErrorEnvelope = Type.Object({
  error: Type.String(),
  code: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  success: Type.Optional(Type.Literal(false)),
}, { additionalProperties: true });
```

### RouteDef 扩展
```ts
errors?: number[];                    // 显式状态码，使用 ErrorEnvelope
errorSchemas?: Record<number, object>; // 特殊形状（429 / 503 / 409 等）
errorDescription?: Record<number, string>;
```

`toOpenApiPaths()`：
- **所有 op** 自动获得 `default` 响应：`{ description:'Error', content: ErrorEnvelope }`；
- 路径以 `/api/` 开头的 op 自动获得 **401 / 403**（transport 鉴权层，所有 API 都可能有）；
- catalog 的 `errors` 追加显式状态码；`errorSchemas[status]` 覆盖该状态的 schema；
- `default` 是兜底：未列出的 4xx/5xx 都按统一包描述。

### 特殊形状
- `429 QuotaExceeded`：`{ error, code:'quota_exceeded', resource, limit, current }`；
- `503 capability`：`{ error, code:'capability_unavailable' }`；
- `409`：`{ error, code? }`（冲突/已配对等）；
- `404`：`{ error }`。

## 2. 显式状态码（按域，高价值）

| 域 | 显式状态 |
|---|---|
| session（create/fork/checkpoint/prompt/queue） | 400 / 404 / 409 / 429 |
| pods（create/tasks/messages/goals/reviewItems/accept） | 400 / 403 / 404 / 409 |
| goals / decisions / lead / standing | 400 / 403 / 404 / 409 |
| plugins / runtime / config / mcp | 400 / 404 / 409 / 503 |
| memory / media / tts / mobile / devices | 400 / 404 / 413 / 429 / 503 |
| events / automations / approvals / questions / triage / permissions | 400 / 403 / 404 / 409 |

## 3. 批次

| 批次 | 内容 |
|---|---|
| P0 | ErrorEnvelope + RouteDef 管线 + 全局 default/401/403 + 测试 |
| E1 | session + pods 显式状态码 |
| E2 | goals/decisions/lead/standing + events/automations/approvals/questions/triage/permissions |
| E3 | plugins/runtime/config/mcp + memory/media/tts/mobile/devices + 收口守卫 |

每批一个 commit `(E10i-*)`；同一 worktree 顺序执行。

## 4. 守卫

`error-coverage.test.ts`：
- 每个 op 必须有 `default` 错误响应（OpenAPI 投影后）；
- 每个 `/api/` op 必须有 401/403；
- `errors` 中列出的状态必须存在 `errorSchemas` 或使用 ErrorEnvelope；
- 至少 N 个 op 有显式状态码（防只做全局包）；N 由收口实测固定。

## 5. 非目标

- 逐 op 穷举所有可能状态码（`default` 兜底）。
- 请求体校验错误（transport 层）。
- 流式/二进制响应的错误体（仍用 default）。

## 6. 门禁

每批：gateway tsc 0 + api-contract/architecture + analyze TOTAL 0 + SDK tsc/contract + 生成物幂等。
收口：全量 gateway（9 env-red）、错误覆盖 327/327 default、SDK 226、desktop、mobile/analyze、kernel-split 7/7。
