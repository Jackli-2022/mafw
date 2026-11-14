/**
 * E10h-R3：decision 写接口（4 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 * `routes/decisions.ts` 的 `handleDecisionDraft` / `handleDecisionMutation`
 * 全部回 `{record}`，record 来自 `core/decision/decision-record-service.ts`
 * （与 `decisions.list` 的 item 是同一个 `DecisionRecord`）。
 *
 * human-only 门（无人凭据 / 带 `actorSessionID`）是 403，不属于 200 形态。
 */
import { Type } from '@sinclair/typebox'
import { DecisionRecordSchema } from './read-models'

/**
 * `POST /api/decisions`（draft）与 `POST /api/decisions/:id/{confirm,shelve,reopen}`：
 * 四个动作同形 `{record}`——draft 回新建的草稿，三个 mutation 回状态变更后的记录。
 */
export const DecisionRecordResponse = Type.Object({
  record: DecisionRecordSchema,
})
