const DECAY_PER_DAY = 0.005;
const ACCESS_BOOST_PER_EVENT = 0.02;
const MAX_ACCESS_BOOST = 0.3;

export function calculateEnergy(
  energyBase: number,
  lastReviewed: number | string,
  reviewCount: number,
  recentAccessCount: number,
): number {
  const lastTime = typeof lastReviewed === 'string'
    ? new Date(lastReviewed).getTime()
    : lastReviewed;
  const daysSinceUpdate = (Date.now() - lastTime) / (24 * 60 * 60 * 1000);
  const reviewSlow = 1 / (1 + reviewCount * 0.3);
  const decay = Math.max(0, 1 - DECAY_PER_DAY * Math.max(0, daysSinceUpdate * reviewSlow));
  const boost = Math.min(MAX_ACCESS_BOOST, ACCESS_BOOST_PER_EVENT * recentAccessCount);
  return Math.min(1.0, Math.max(0, energyBase * decay + boost));
}
