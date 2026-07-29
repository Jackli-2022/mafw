const DISTILL_THRESHOLD = 3;

export interface ObservationResult {
  shouldDistill: boolean;
  count: number;
}

export class DeferredMemory {
  private topicCount = new Map<string, number>();

  recordObservation(observation: string, topic: string): ObservationResult {
    const count = (this.topicCount.get(topic) || 0) + 1;
    this.topicCount.set(topic, count);
    return { shouldDistill: count >= DISTILL_THRESHOLD, count };
  }
}
