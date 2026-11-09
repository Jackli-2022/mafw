/**
 * @mafw/runtime-core — the runtime-neutral data contract a driver needs to
 * satisfy without importing the gateway.
 *
 * `view-dto.generated.ts` is a verbatim mirror of
 * `packages/gateway-sdk/src/view-dto.ts` (single source of truth), produced by
 * `npm run sync:view-dto`. Do not edit it by hand.
 */
export * from './view-dto.generated.ts';
export { coerceOutput } from './output.ts';
export { requireSessionDir, resolvePluginProjectDir } from './session-dir.ts';
export { fixMediaPayload } from './media-payload.ts';
export * from './host-adapter.ts';
