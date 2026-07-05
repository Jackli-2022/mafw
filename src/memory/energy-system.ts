export type EnergyEvent =
  | { type: 'useful_feedback' }
  | { type: 'useless_feedback' }
  | { type: 'retrieved' }
  | { type: 'referenced' }
  | { type: 'merged' };

export interface EnergyDistribution {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

const EVENT_DELTAS: Record<EnergyEvent['type'], number> = {
  useful_feedback: 0.1,
  useless_feedback: -0.05,
  retrieved: 0.02,
  referenced: 0.05,
  merged: 0.03,
};

export class EnergySystem {
  private decayRatePerDay: number;
  private readonly minEnergy = 0.0;
  private readonly maxEnergy = 1.0;
  private cleanupThreshold: number;
  private criticalThreshold: number;

  constructor(config?: {
    decayRatePerDay?: number;
    cleanupThreshold?: number;
    criticalThreshold?: number;
  }) {
    this.decayRatePerDay = config?.decayRatePerDay ?? 0.01;
    this.cleanupThreshold = config?.cleanupThreshold ?? 0.3;
    this.criticalThreshold = config?.criticalThreshold ?? 0.8;
  }

  calculateEnergy(currentEnergy: number, event: EnergyEvent, daysSinceLastUpdate: number, salience: number = 1.0): number {
    const effectiveDecay = this.decayRatePerDay * (1 / Math.max(0.1, salience));
    let energy = currentEnergy - effectiveDecay * Math.max(0, daysSinceLastUpdate);
    energy += EVENT_DELTAS[event.type];
    return Math.max(this.minEnergy, Math.min(this.maxEnergy, energy));
  }

  shouldCleanup(energy: number): boolean {
    return energy < this.cleanupThreshold;
  }

  isCritical(energy: number): boolean {
    return energy > this.criticalThreshold;
  }

  calculateDistribution(memories: Array<{ energy: number }>): EnergyDistribution {
    const dist: EnergyDistribution = { critical: 0, high: 0, medium: 0, low: 0, total: memories.length };
    for (const m of memories) {
      if (m.energy > 0.8) dist.critical++;
      else if (m.energy >= 0.6) dist.high++;
      else if (m.energy >= 0.3) dist.medium++;
      else dist.low++;
    }
    return dist;
  }
}
