/**
 * E10h-R6：device / mobile 写接口（7 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/devices-mobile.ts`（devices.register / devices.delete /
 *     mobile.devicesRegister / mobile.pairingVerify / mobile.devicesDelete）
 *   - `mobile/media-proxy.ts`（mobile.mediaTaskAsk / mobile.mediaTaskUpload）
 *
 * 注册/删除的响应都**不含任何凭据哈希**：`toPublicDevice()` 已剥掉
 * `deviceTokenHash` / `apiTokenHash`，因此复用 `PublicDeviceEntrySchema`
 * （与 `devices.list` 的 item 同一投影）。`mobile.pairingVerify` 是唯一返回
 * 新设备 token 的端点（只此一次，之后不可再读）。
 *
 * 错误体（400/404/409/413/500/503）不属于 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { PublicDeviceEntrySchema } from './devices'

// ── devices.register / mobile.devicesRegister ───────────────────────────────

/**
 * `POST /api/devices`（handler：`routes/devices-mobile.ts` `devices.register`）。
 *
 * legacy 注册：`{ok:true, device}`。`pushGateway` 未初始化时 handler 拿到
 * `undefined`，`JSON.stringify` 会丢掉 `device` 键 → 因此是 optional
 * （不是 null：wire 上不出现该键）。
 */
export const DevicesRegisterResponse = Type.Object({
  ok: Type.Literal(true),
  device: Type.Optional(PublicDeviceEntrySchema),
})

/**
 * `POST /api/mobile/devices/register`（handler：同上 `mobile.devicesRegister`）。
 *
 * 手机端别名：投影与 `devices.register` **严格同形**（同一 `toPublicDevice()`
 * 分支），复用同一 schema 对象。`token` 是客户端上报的 FCM push token，
 * 网关 bearer 凭据只走 Authorization 头、永不回显。
 */
export const MobileDevicesRegisterResponse = DevicesRegisterResponse

// ── devices.delete / mobile.devicesDelete ───────────────────────────────────

/**
 * `DELETE /api/devices/:id`（handler：同上 `devices.delete`）。
 *
 * 命中 → 200 `{ok:true}`（硬撤销：设备行与凭据一起删）；未命中 → 404
 * `{error:'device not found'}`，不在本 schema 内。
 */
export const DevicesDeleteResponse = Type.Object({
  ok: Type.Literal(true),
})

/**
 * `DELETE /api/mobile/devices/:id`（handler：同上 `mobile.devicesDelete`）。
 *
 * 与 legacy 别名同一实现、同一 200 回执 → 复用同一 schema 对象。
 */
export const MobileDevicesDeleteResponse = DevicesDeleteResponse

// ── mobile.pairingVerify ────────────────────────────────────────────────────

/**
 * `POST /api/mobile/pairing/verify`（handler：同上 `mobile.pairingVerify`）。
 *
 * 用单次 nonce 换 **per-device** token：`token` 是 `dev_` 前缀的新凭据
 * （只存 sha256，不落日志），`deviceId` 是凭据绑定的稳定 id（已配对设备重新
 * 配对需显式 `rotate:true`，否则 409；nonce 单次且 5 分钟过期）。
 */
export const MobilePairingVerifyResponse = Type.Object({
  ok: Type.Literal(true),
  token: Type.String({ description: 'New device bearer credential (dev_…); shown once, stored hashed.' }),
  deviceId: Type.String({ description: 'Stable device id the credential is bound to.' }),
})

// ── mobile.mediaTaskAsk ─────────────────────────────────────────────────────

/**
 * `POST /api/mobile/media/tasks/:id/ask`（handler：`mobile/media-proxy.ts`
 * 的 ask 分支）。
 *
 * 追问代理：`answer` 是 A2A 任务消息里的第一段文本（任务未带文本时是空串），
 * `taskId` 原样回显（A2A 回包缺 task 时该键被丢掉 → optional）。问题文本内的
 * 外部 URL / IP 会被 400 拒绝（SSRF 纵深防御）。
 */
export const MobileMediaTaskAskResponse = Type.Object({
  answer: Type.String({ description: 'Follow-up answer text (empty when the task carried no text part).' }),
  taskId: Type.Optional(Type.String({ description: 'Echoed A2A task id; absent when the agent returned no task.' })),
})

// ── mobile.mediaTaskUpload ──────────────────────────────────────────────────

/**
 * `POST /api/mobile/media/tasks`（handler：同上 multipart 分支）。
 *
 * 请求是 `multipart/form-data` 文件部（E10g 排除），200 是任务窄投影
 * （`{id, contextId, state, artifactId}`）——比 `media.createTaskApi` 多一个
 * `artifactId`，因为这条路径自己落盘了上传字节。
 */
export const MobileMediaTaskUploadResponse = Type.Object({
  id: Type.String({ description: 'A2A task id (analysis runs in the background).' }),
  contextId: Type.String(),
  state: Type.String({ description: 'A2A task state; empty string when the agent omitted it.' }),
  artifactId: Type.String({ description: 'Artifact id created from the multipart file part.' }),
})
