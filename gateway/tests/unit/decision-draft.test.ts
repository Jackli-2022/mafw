import { handleDecisionDraft } from '../../src/mcp/handlers/decision-draft';
import { DecisionRecordError } from '../../src/core/decision/decision-record-service';

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    projectDir: 'C:/repo',
    goalId: 'g1',
    revision: 1,
    kind: 'plan',
    status: 'draft',
    question: '采用哪个方案？',
    options: [],
    evidence: [],
    rationale: null,
    consequences: null,
    reviewAt: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
    history: [],
    ...overrides,
  } as any;
}

function services(draft = jest.fn(() => record())) {
  return {
    decisionRecords: { draft },
    projectDir: () => 'C:/repo',
  } as any;
}

test('drafts a decision with the current project', async () => {
  const draft = jest.fn(() => record());
  const out = await handleDecisionDraft({
    goalId: 'g1',
    kind: 'plan',
    question: '采用哪个方案？',
  }, services(draft));

  expect(out.isError).toBeUndefined();
  expect(out.structuredContent?.success).toBe(true);
  expect(draft).toHaveBeenCalledWith(expect.objectContaining({
    projectDir: 'C:/repo',
    goalId: 'g1',
    kind: 'plan',
    question: '采用哪个方案？',
  }));
});

test('rejects a missing question', async () => {
  const draft = jest.fn(() => { throw new DecisionRecordError(400, 'question is required'); });
  const out = await handleDecisionDraft({ kind: 'plan' }, services(draft));
  expect(out.isError).toBe(true);
  expect(out.structuredContent?.status).toBe(400);
});

test('does not let the agent confirm', async () => {
  const draft = jest.fn(() => record());
  const out = await handleDecisionDraft({
    goalId: 'g1',
    kind: 'plan',
    question: '采用哪个方案？',
    status: 'decided',
    decidedBy: 'agent',
  }, services(draft));

  expect(out.isError).toBeUndefined();
  const input = draft.mock.calls[0][0] as Record<string, unknown>;
  expect(input.status).toBeUndefined();
  expect(input.decidedBy).toBeUndefined();
});

test('returns 503 without a project', async () => {
  const draft = jest.fn();
  const out = await handleDecisionDraft(
    { kind: 'plan', question: '采用哪个方案？' },
    { decisionRecords: { draft } } as any,
  );
  expect(out.isError).toBe(true);
  expect(out.structuredContent?.status).toBe(503);
  expect(draft).not.toHaveBeenCalled();
});
