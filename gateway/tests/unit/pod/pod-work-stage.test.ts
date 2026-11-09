import {
  projectPodWorkBucket,
  type PodWorkBucket,
} from '../../../src/core/pod/pod-work-stage';
import type { PodGoalStage, PodGoalStageKind } from '../../../src/core/pod/pod-stage';

function stage(kind: PodGoalStageKind): PodGoalStage {
  return {
    owner: kind === 'plan_approval' || kind === 'direction_review' || kind === 'question' || kind === 'blocked'
      ? 'person'
      : 'team',
    kind,
  };
}

describe('projectPodWorkBucket', () => {
  const cases: Array<[PodGoalStageKind, PodWorkBucket]> = [
    ['plan_approval', 'needs_you'],
    ['direction_review', 'needs_you'],
    ['question', 'needs_you'],
    ['blocked', 'needs_you'],
    ['queued', 'queued'],
    ['discussing', 'in_progress'],
    ['planning', 'in_progress'],
    ['probing', 'in_progress'],
    ['implementing', 'in_progress'],
    ['reviewing', 'in_progress'],
    ['working', 'in_progress'],
    ['waiting', 'in_progress'],
    ['result_notified', 'result_ready'],
    ['ended', 'ended'],
  ];

  test.each(cases)('%s -> %s', (kind, expected) => {
    expect(projectPodWorkBucket({
      stage: stage(kind),
      status: 'active',
      resultReady: false,
    })).toBe(expected);
  });

  test('a terminal result with evidence is readable before it becomes history', () => {
    expect(projectPodWorkBucket({
      stage: stage('ended'),
      status: 'done',
      resultReady: true,
    })).toBe('result_ready');
  });

  test('user-accepted results move to history even when evidence remains', () => {
    expect(projectPodWorkBucket({
      stage: stage('ended'),
      status: 'done',
      resultReady: true,
      accepted: true,
    })).toBe('ended');
  });

  test('evidence wins over a lagging goal row status (archive -> row update window)', () => {
    expect(projectPodWorkBucket({
      stage: stage('ended'),
      status: 'active',
      resultReady: true,
      accepted: false,
    })).toBe('result_ready');
    expect(projectPodWorkBucket({
      stage: stage('ended'),
      status: 'active',
      resultReady: true,
      accepted: true,
    })).toBe('ended');
  });

  test('a terminal Goal without evidence is history, never a fake result', () => {
    expect(projectPodWorkBucket({
      stage: stage('ended'),
      status: 'done',
      resultReady: false,
    })).toBe('ended');
    expect(projectPodWorkBucket({
      stage: stage('ended'),
      status: 'aborted',
      resultReady: true,
    })).toBe('ended');
  });
});
