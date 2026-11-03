// Canonical, user-facing Goal buckets. Internal stage kinds stay available for
// execution detail; every list/count surface must use this one projection.
import type { PodGoalStage } from './pod-stage';

export type PodWorkBucket =
  | 'needs_you'
  | 'queued'
  | 'in_progress'
  | 'result_ready'
  | 'ended';

export interface PodWorkBucketInput {
  stage: PodGoalStage;
  status: 'queued' | 'active' | 'done' | 'aborted';
  resultReady: boolean;
}

export function projectPodWorkBucket(input: PodWorkBucketInput): PodWorkBucket {
  const { stage, status, resultReady } = input;

  if (status === 'aborted') return 'ended';
  if (status === 'done') return resultReady ? 'result_ready' : 'ended';
  if (stage.kind === 'ended') return 'ended';
  if (stage.owner === 'person') return 'needs_you';
  if (stage.kind === 'queued') return 'queued';
  if (stage.kind === 'result_notified') return 'result_ready';
  return 'in_progress';
}
