/**
 * E10h-R5：platform 写接口（5 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 覆盖 config / project / manager / commands / models 五个 gateway 平台面。
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/config.ts`（config.set）
 *   - `http/transport.ts` 的 `/register` 分支（project.setCurrent）
 *   - `routes/manager-rotate.ts`（manager.rotate）
 *   - `routes/mafw-commands.ts`（mafwCommands.run）
 *   - `routes/model-config.ts`（models.update）
 *
 * 复用读侧 DTO（不写第二份转写）：
 *   - `ModelRefSchema` / `MediaConfigSchema` / `GoalModelConfigSchema`
 *     （`schemas/media-voice.ts`，`models.get` 的同一投影）——models.update 的
 *     `recall` / `media` / `goal` 三段就是读回来的当前状态。
 *
 * 错误体（400/429/500）不属于 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { GoalModelConfigSchema, MediaConfigSchema, ModelRefSchema } from './media-voice'

// ── config.set ──────────────────────────────────────────────────────────────

/**
 * `PUT /api/config`（handler：`routes/config.ts` `config.set`）。
 *
 * 落盘 + 热载成功后 200：`success` 恒 true（写盘/解析失败是 400）。
 * `restartRequired` 是本次 reload 判定为「需重启才生效」的配置分区名
 * （非空也仍是 200，只是提示）。响应不回显写入内容。
 */
export const ConfigSetResponse = Type.Object({
  success: Type.Literal(true),
  restartRequired: Type.Array(Type.String(), {
    description: 'Config sections that only take effect after a gateway restart.',
  }),
})

// ── project.setCurrent ──────────────────────────────────────────────────────

/**
 * `POST /register`（handler：`http/transport.ts` 的 `/register` 分支）。
 *
 * 注册（可选切换当前项目）成功后回 `{status:'ok', registered}`，
 * `registered` 是 handler 收到的 projectDir 原样回显（`Project` DTO 不适用：
 * 这里没有 id/mafwDir 投影）。400（缺字段 / 用户数据目录 / 基础设施目录）
 * 与 429（配额）不进本 schema。
 */
export const ProjectSetCurrentResponse = Type.Object({
  status: Type.Literal('ok'),
  registered: Type.String({ description: 'Project directory that was registered (echoed verbatim).' }),
})

// ── manager.rotate ──────────────────────────────────────────────────────────

/**
 * `POST /api/manager/session/rotate`（handler：`handleManagerRotate`）。
 *
 * `created` 区分懒建（`initial`：该项目此前没有 Lead 会话）与轮换
 * （`rotated`：旧 Lead 已归档，`previousSessionId` 指向它）。
 * `sessionId` 是全仓库统一的 camelCase wire 名（不是 sessionID）。
 */
export const ManagerRotateResponse = Type.Object({
  success: Type.Literal(true),
  sessionId: Type.String({ description: 'Newly created (or lazily ensured) manager session id.' }),
  previousSessionId: Type.Optional(Type.String({
    description: 'Archived Lead session id; present only when created is rotated.',
  })),
  created: Type.Union([Type.Literal('initial'), Type.Literal('rotated')]),
})

// ── mafwCommands.run ────────────────────────────────────────────────────────

/**
 * `POST /api/mafw-commands/run`（handler：`handleMafwCommandRun` → 命令 handler）。
 *
 * 200 body 就是命令 handler 的 `MafwCommandResult`：`ok` 是命令自身的判定
 * （false 会降级成 400），`message` / `text` / `error` 是常见回显，
 * 但 **内置与自定义命令都可以追加任意键**（`[k: string]: unknown`），
 * 所以这里按开放对象建模（owner = 命令注册表 / 自定义命令作者），
 * 不把契约钉死在内置命令的字段上。
 */
export const MafwCommandRunResponse = Type.Object({
  ok: Type.Boolean(),
  message: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
}, {
  additionalProperties: true,
  description: 'Command result (MafwCommandResult); custom commands may add arbitrary keys.',
})

// ── models.update ───────────────────────────────────────────────────────────

/**
 * `POST /api/model-config`（handler：`handleModelConfigUpdate`）。
 *
 * 写入成功后回 `{success:true, recall, media, goal}`：三段都是**写入后重新读回**
 * 的当前配置（与 `models.get` 的对应段严格同形），因此这里复用同一批 schema。
 * 校验失败是 400（带 `available`），不是 200。
 */
export const ModelsUpdateResponse = Type.Object({
  success: Type.Literal(true),
  recall: Type.Object({ workerModel: ModelRefSchema }),
  media: MediaConfigSchema,
  goal: GoalModelConfigSchema,
})
