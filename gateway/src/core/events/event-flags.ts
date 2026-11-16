/**
 * Event layer 开关：默认开启；只有显式 `MAFW_EVENT_LAYER=0` 才关闭。
 *
 * 2026-11-16 起事件层是常驻能力（internal goal/decision 事件、Lead 播报都
 * 依赖它）；外部 GitHub / webhook source 仍需显式创建，不会因为默认开启而
 * 自动联网。
 */
export function eventLayerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MAFW_EVENT_LAYER !== '0';
}
