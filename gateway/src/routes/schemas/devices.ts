/**
 * E10f-D：设备注册 / 移动端配对读面 schema（3 op，全部 GET JSON）。
 *
 *   - `mobile.devicesList` → `routes/devices-mobile.ts` `listPublicDevices()` =
 *     `DeviceStore.listPublic()` → `PublicDeviceEntry[]`（credential hash 已剥离）
 *   - `devices.list`       → legacy 别名，**同一** `listPublicDevices()` wire
 *   - `mobile.pairingCode` → `mobile/pairing.ts` `generatePairingCode()` → `{url}`
 *     （单次 nonce、5 分钟 TTL；429 是错误信封，不在 200 schema 内）
 *
 * `PublicDeviceEntry` 是 gateway 稳定的 wire 投影（`mobile/device-store.ts`：
 * `Omit<DeviceEntry, 'deviceTokenHash' | 'apiTokenHash'>`），编译期 AssertEq 钉住
 * schema 与该投影逐字段等价——`fcmToken` 保留（客户端上报的 FCM push token，不是
 * 网关凭据），两个 hash 永不出现。
 */
import { Type, type Static } from '@sinclair/typebox'
import type { PublicDeviceEntry } from '../../mobile/device-store'

/**
 * 编译期精确相等（恒等函数技巧，never 安全）。与 SDK
 * `contract-compat.checks.ts` 的 AssertEq 同一写法，但这里锁的是 gateway 自己的
 * wire 投影（`PublicDeviceEntry` 没有 SDK DTO）。
 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type AssertEq<A, B> = Equals<A, B> extends true ? true : ['MISMATCH', A, B]

/** `PublicDeviceEntry`：列表/注册响应共用（`toPublicDevice()` 的字段面）。 */
export const PublicDeviceEntrySchema = Type.Object({
  id: Type.String(),
  /** FCM push token（客户端上报，非网关 bearer 凭据）。 */
  fcmToken: Type.String(),
  platform: Type.String(),
  lastSeen: Type.String(),
  /** 配对请求带的人类可读标签（legacy 记录没有）。 */
  deviceName: Type.Optional(Type.String()),
  /** 当前设备凭据签发时间（轮换标记；无凭据时缺省）。 */
  tokenIssuedAt: Type.Optional(Type.String()),
})

/** `GET /api/mobile/devices` 与 `GET /api/devices` → `{devices: PublicDeviceEntry[]}`。 */
export const DeviceListResponse = Type.Object({
  devices: Type.Array(PublicDeviceEntrySchema),
})

/** `GET /api/mobile/pairing-code` → `{url}`（`orcalore://pair?...`）。 */
export const PairingCodeResponse = Type.Object({
  url: Type.String(),
})

/** Remote-access tunnel lifecycle status (`/api/mobile/remote-access`). */
export const RemoteAccessStatusResponse = Type.Object({
  enabled: Type.Boolean(),
  provider: Type.Optional(Type.String()),
  url: Type.Optional(Type.String()),
  startedAt: Type.Optional(Type.Number()),
})

/** `POST /api/mobile/remote-access` body. */
export const RemoteAccessRequest = Type.Object({
  enabled: Type.Boolean(),
})

/** schema ↔ `PublicDeviceEntry` 漂移即 gateway tsc 红（`npx tsc --noEmit -p tsconfig.json`）。 */
const _PUBLIC_DEVICE_SCHEMA_MATCHES_STORE: AssertEq<Static<typeof PublicDeviceEntrySchema>, PublicDeviceEntry> = true
export { _PUBLIC_DEVICE_SCHEMA_MATCHES_STORE }
