/**
 * E10g-W4：lead（topic / boundary）写接口的请求体 schema（`RouteDef.request`）。
 *
 * 字段面来自 `routes/lead-boundaries.ts` 与 `routes/lead-topics.ts` 的 handler 读取
 * （`clean(body.sessionID)` / `body.text` / `body.topicId` / `body.goalTitle`）。
 *
 * 只有声明，不做运行时校验。分类（与 W2/W3 同口径）：
 *   - JSON body（required:true）：`lead.boundaries.observe`（body 是观察输入）、
 *     `lead.compact`（`topicId` 缺失 → 404，无法完成动作）；
 *   - 可选 body（有字段 + `requestRequired:false`）：`lead.topics.fork`
 *     （`goalTitle` 只是标题覆盖，缺省由 service 派生）。
 *
 * 空对象 + `requestRequired:false`（`EmptyRequest`）：
 *   - `lead.boundaries.accept` / `merge` / `undo`：human-only 判定只看凭据，
 *     handler 从不读 body，topic/boundary id 全在 path；
 *   - `lead.topics.resume`：handler 只读路径 id。
 */
import { Type } from '@sinclair/typebox'

// ── boundaries ────────────────────────────────────────────────────────────

/**
 * `POST /api/lead/boundaries/observe`（handler：`routes/lead-boundaries.ts`）。
 * 观察是 advisory：`sessionID` 或 `text` 为空 → 200 `{proposed:false}`（不抛错），
 * 因此两者在契约里都是可选字段，但 body 本身是动作输入。
 */
export const LeadBoundaryObserveRequest = Type.Object({
  sessionID: Type.Optional(Type.String({ description: 'Lead session id; absent/blank → proposed:false.' })),
  text: Type.Optional(Type.String({ description: 'Utterance to observe; absent/blank → proposed:false.' })),
})

// `lead.boundaries.accept` / `merge` / `undo` 使用 `EmptyRequest` + `requestRequired:false`：
// human-only 门只看凭据，handler 不读取 body（见文件头）。

// ── topics ────────────────────────────────────────────────────────────────

/**
 * `POST /api/lead/compact`（handler：`routes/lead-topics.ts` `handleCompact`）。
 * `topicId` 必须能查到 topic（否则 404）；working set / compaction 关闭时 503。
 */
export const LeadCompactRequest = Type.Object({
  topicId: Type.String({ minLength: 1 }),
})

// `lead.topics.resume` 使用 `EmptyRequest` + `requestRequired:false`：只读路径 id。

/**
 * `POST /api/lead/topics/:id/fork`（handler：`handleForkTopic`）。
 * `goalTitle` 缺省时由 service 派生；fork 不可用时 503。
 */
export const LeadTopicForkRequest = Type.Object({
  goalTitle: Type.Optional(Type.String({ description: 'Goal title for the forked topic; blank = derived default.' })),
})
