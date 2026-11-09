/**
 * canonical v3 flat 消息/部件类型 —— 兼容导入路径。
 *
 * 事实源已迁至 MAFW View DTO：`packages/gateway-sdk/src/view-dto.ts`。
 * 镜像与守卫现在由 `@mafw/runtime-core` 持有（`packages/runtime-core/src/view-dto.generated.ts`，
 * 由 `npm run sync:view-dto` 生成），gateway 只保留这个再导出路径，不再维护第二份定义。
 *
 * spec: docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md §5
 */
export * from '@mafw/runtime-core';
