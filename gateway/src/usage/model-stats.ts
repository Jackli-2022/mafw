import { TrajectoryStore } from '../trajectory/trajectory-store';
import { ModelUsageRow } from '../trajectory/types';
import { getModelPrice, calculateCost } from './model-prices';

export interface ModelUsageRowWithCost extends ModelUsageRow {
  estimatedCost: number | null;
}

export interface ModelUsageWindows {
  today: ModelUsageRowWithCost[];
  '7d': ModelUsageRowWithCost[];
  '30d': ModelUsageRowWithCost[];
  all: ModelUsageRowWithCost[];
}

function withCost(rows: ModelUsageRow[]): ModelUsageRowWithCost[] {
  return rows.map((r) => ({
    ...r,
    estimatedCost: getModelPrice(r.model) ? calculateCost(r.model, r.tokens) : null,
  }));
}

export function buildModelStats(store: TrajectoryStore, nowMs: number = Date.now()): ModelUsageWindows {
  const nowSec = Math.floor(nowMs / 1000);
  const localMidnight = new Date(nowMs);
  localMidnight.setHours(0, 0, 0, 0);
  return {
    today: withCost(store.getModelUsageStats(Math.floor(localMidnight.getTime() / 1000))),
    '7d': withCost(store.getModelUsageStats(nowSec - 7 * 86400)),
    '30d': withCost(store.getModelUsageStats(nowSec - 30 * 86400)),
    all: withCost(store.getModelUsageStats(null)),
  };
}
