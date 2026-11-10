import type { MafwMessage } from '../../../src/runtime/canonical-types';
import type { LeadTopicRow } from '../../../src/core/lead/lead-topic-store';
import { planFork } from '../../../src/core/lead/topic-fork';

const NOW = '2026-11-10T00:00:00.000Z';

const topic = (over: Partial<LeadTopicRow> = {}): LeadTopicRow => ({
  id: 't1',
  projectDir: '/p',
  leadSessionId: 's1',
  title: 'SQLite',
  startMessageId: 'm1',
  endMessageId: 'm3',
  goalId: 'g1',
  ownerRole: 'tech-lead',
  ownerSessionId: null,
  createdAt: NOW,
  summary: '决定：A',
  summaryHash: 'hash',
  summaryUpdatedAt: NOW,
  state: 'warm',
  lastActiveAt: NOW,
  residentTokens: 10,
  resumedFrom: null,
  forkedFrom: null,
  forkedAt: null,
  inheritedMessageRange: null,
  ...over,
});

const msg = (id: string, role: 'user' | 'assistant', text: string): MafwMessage => ({
  id,
  role,
  content: [{ type: 'text', text }],
});

describe('planFork', () => {
  test('references the source range and never copies the transcript', () => {
    const plan = planFork({
      topic: topic(),
      messages: [
        msg('m1', 'user', '决定：A'),
        msg('m2', 'assistant', 'ok'),
        msg('m3', 'user', '继续 B'),
      ],
      summary: '决定：A',
      budgetTokens: 40,
    });

    expect(plan).toMatchObject({
      sourceTopicId: 't1',
      inheritedFrom: 'm1',
      inheritedTo: 'm3',
      mode: 'reference',
    });
    expect(plan.handoffText).toContain('<forked-topic');
    expect(plan.handoffText).toContain('Source: t1');
    expect(plan.handoffText).toContain('决定：A');
    expect(plan.handoffText).not.toContain('Assistant: ok');
  });

  test('keeps at most five user words and truncates the summary budget', () => {
    const messages = Array.from({ length: 8 }, (_, i) => msg(`u${i}`, 'user', `user word ${i}`));
    const plan = planFork({ topic: topic(), messages, summary: 'x'.repeat(500), budgetTokens: 10 });
    expect(plan.summary.length).toBeLessThanOrEqual(40);
    expect((plan.handoffText.match(/- user word/g) ?? []).length).toBeLessThanOrEqual(5);
  });
});
