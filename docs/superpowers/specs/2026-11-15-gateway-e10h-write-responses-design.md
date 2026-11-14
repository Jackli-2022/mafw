# Gateway E10h 写响应契约（全量）：设计（2026-11-15）

> 目标：给 195 个写 op 补 200 响应 schema。当前只有 `humanToken.rotate` 有；其余 194 个未建模。
> 请求契约已由 E10g 完成（189/195 + 6 排除）。

## 0. 基线

- catalog 327 ops = 132 GET + 195 写。
- 响应覆盖 127/327（126 GET + `humanToken.rotate`）；GET 侧 6 个非 JSON 排除。
- 本波：补 193 个写响应 schema；`tts.speakStream`（音频流）排除；终值 **320/327（97.9%）**，
  排除 7（6 非 JSON GET + 1 流式写）。

## 1. 分类规则

每个写 op 的 200 响应三选一：

1. **JSON**：TypeBox schema + catalog `response`。优先复用已有 DTO；共享的 `{status:'ok'}` /
   `{ok:true}` 用一个公共 `OkResponse`（或已有同名 schema）。
2. **领域对象**：返回任务/会话/goal/pod 等实体时，用已有 schema 组合（如 `PodDetailResponse`）。
3. **排除**：流式/二进制响应（`tts.speakStream` 音频；若某 chat/command 端点实际是 SSE，也在本波确认后加入排除）。
   A2A JSON-RPC 响应仍是 JSON：用协议边界 `additionalProperties:true` + owner 注释，不排除。

## 2. 批次（顺序执行）

| 批次 | 域 | 约数 |
|---|---|---|
| P0 | `schema-coverage.cjs` 增加 `writeResponses: X/195` + 2 pilot（session.create、tasks.submit） | 2 |
| R1 | session 写接口（含 usage plugins / subagents / queue / rename / delete） | ~32 |
| R2 | pods（含 pod.events.*、tasks/messages/goals/reviewItems/memory/a2a） | ~33 |
| R3 | goals / decisions / lead / standing / cognition | ~26 |
| R4 | events / automations / approvals / questions / triage / permissions | ~22 |
| R5 | mcp / plugins（含 Phase 6 7 个）/ runtime / config / project / manager / commands / models | ~32 |
| R6 | memory / media / tts / chat / python / obs / embedding / tools / eval / llm / mobile / devices / fileHistory / skills | ~34 |

每批一个 commit `(E10h-Rn)`；同一 worktree 顺序执行。

## 3. 响应覆盖率守卫

收口新增 `gateway/tests/unit/architecture/write-response-coverage.test.ts`：
- 每个非 GET op 必须 `response` 或在 `WRITE_RESPONSE_EXCLUDED`（op → reason），二者恰好其一；
- 排除项必须存在；总数 = 195；
- 历史/共享 schema 不得“空壳”（`Type.Object({})` 仅用于确实无字段的 200 体，并在注释说明）。

`schema-coverage.cjs` 在 P0 扩展输出 `writeResponses / writeResponseCovered / writeResponseTotal`。

## 4. 非目标

- 错误体 schema（4xx/5xx）。
- 运行时响应校验（声明式契约，与既有策略一致）。
- 请求契约补充（E10g 已完成）。

## 5. 门禁

每批：gateway tsc 0 + api-contract/schema-coverage + 相关路由 + analyze TOTAL 0 + SDK tsc/contract + 生成物幂等。
收口：全量 gateway（9 env-red）、响应 320/327、请求 189/195、SDK 226、desktop 全量、mobile/analyze、kernel-split 7/7。
