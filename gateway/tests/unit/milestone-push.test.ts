import { MilestonePushNotifier, milestoneDedupeKey } from '../../src/core/manager/milestone-push';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function makeNotifier(over: Record<string, any> = {}) {
  const notified = new Set<string>();
  const sent: Array<{ sessionId: string; text: string }> = [];
  const deps = {
    getManagerSession: (_pd: string) => ({ sessionId: 'ses_mgr' }),
    wasNotified: (key: string) => notified.has(key),
    markNotified: (key: string) => { notified.add(key); },
    readGoalState: (_goalId: string, _pd: string) => ({ stateVersion: 3, reviewVerdict: null, title: 'T' }),
    promptNoReply: async (sessionId: string, text: string) => { sent.push({ sessionId, text }); },
    ...over,
  };
  const notifier = new MilestonePushNotifier(deps as any, 10);
  return { notifier, notified, sent, deps };
}

describe('MilestonePushNotifier', () => {
  it('ignores non-milestone phases', async () => {
    const { notifier, sent } = makeNotifier();
    notifier.onPhaseTransition({ goalId: 'g1', phase: 'EXECUTING', loop: 1, projectDir: 'C:/p' });
    await sleep(30);
    expect(sent).toEqual([]);
    notifier.dispose();
  });

  it('pushes milestone transitions via promptNoReply', async () => {
    const { notifier, sent } = makeNotifier();
    notifier.onPhaseTransition({ goalId: 'g1', phase: 'PLANNING_COMPLETE', loop: 1, projectDir: 'C:/p' });
    await sleep(40);
    expect(sent.length).toBe(1);
    expect(sent[0].sessionId).toBe('ses_mgr');
    expect(sent[0].text).toContain('g1');
    expect(sent[0].text).toContain('PLANNING_COMPLETE');
    notifier.dispose();
  });

  it('dedupes by goalId:phase:stateVersion (replay-safe)', async () => {
    const { notifier, sent } = makeNotifier();
    const data = { goalId: 'g1', phase: 'REVIEWING_COMPLETE', loop: 1, projectDir: 'C:/p' };
    notifier.onPhaseTransition(data);
    await sleep(30);
    notifier.onPhaseTransition(data); // replayed event after crash recovery
    await sleep(30);
    expect(sent.length).toBe(1);
    notifier.dispose();
  });

  it('coalesces multiple milestones of one project into one message', async () => {
    const { notifier, sent } = makeNotifier();
    notifier.onPhaseTransition({ goalId: 'g1', phase: 'PLANNING_COMPLETE', loop: 1, projectDir: 'C:/p' });
    notifier.onPhaseTransition({ goalId: 'g2', phase: 'ASKING_USER', loop: 1, projectDir: 'C:/p' });
    await sleep(40);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('g1');
    expect(sent[0].text).toContain('g2');
    notifier.dispose();
  });

  it('skips when no active manager session', async () => {
    const { notifier, sent } = makeNotifier({ getManagerSession: () => null });
    notifier.onPhaseTransition({ goalId: 'g1', phase: 'ASKING_USER', loop: 1, projectDir: 'C:/p' });
    await sleep(40);
    expect(sent).toEqual([]);
    notifier.dispose();
  });

  it('pushes archived goals with verdict and dedupes', async () => {
    const { notifier, sent } = makeNotifier();
    notifier.onArchived('g1', 'C:/p', 'PASS');
    await sleep(30);
    notifier.onArchived('g1', 'C:/p', 'PASS');
    await sleep(30);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('ARCHIVED(PASS)');
    notifier.dispose();
  });

  it('milestoneDedupeKey falls back to 0 when no stateVersion', () => {
    expect(milestoneDedupeKey('g1', 'ASKING_USER')).toBe('g1:ASKING_USER:0');
    expect(milestoneDedupeKey('g1', 'ASKING_USER', 7)).toBe('g1:ASKING_USER:7');
  });
});
