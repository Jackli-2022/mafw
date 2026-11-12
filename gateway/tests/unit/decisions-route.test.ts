import {
  handleDecisionDraft,
  handleDecisionList,
  handleDecisionMutation,
} from '../../src/routes/decisions';

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

function deps() {
  return {
    service: {
      list: jest.fn(() => [record()]),
      draft: jest.fn(() => record()),
      confirm: jest.fn(() => record({ status: 'decided', decidedBy: 'user' })),
      shelve: jest.fn(() => record({ status: 'shelved' })),
      reopen: jest.fn(() => record()),
    },
  } as any;
}

test('lists decisions for a project', () => {
  const out = handleDecisionList({ projectDir: 'C:/repo' }, deps());
  expect(out.status).toBe(200);
  expect(out.body.items).toHaveLength(1);
});

test('drafts a decision', () => {
  const d = deps();
  const out = handleDecisionDraft(
    { projectDir: 'C:/repo', goalId: 'g1', kind: 'plan', question: '采用哪个方案？' },
    d,
  );
  expect(out.status).toBe(200);
  expect(d.service.draft).toHaveBeenCalledWith(expect.objectContaining({
    projectDir: 'C:/repo',
    question: '采用哪个方案？',
  }));
});

test('confirm rejects an agent actor', () => {
  const out = handleDecisionMutation('confirm', 'd1', {
    projectDir: 'C:/repo',
    actorSessionID: 'ses_agent',
  }, deps(), true);
  expect(out.status).toBe(403);
  expect(out.body.error).toContain('human-only');
});

test('confirm rejects a non-human principal even without an actor', () => {
  const out = handleDecisionMutation('confirm', 'd1', { projectDir: 'C:/repo' }, deps(), false);
  expect(out.status).toBe(403);
  expect(out.body).toMatchObject({ code: 'human_principal_required' });
});

test('confirm rejects a non-empty actor even for a shelve/reopen action', () => {
  expect(handleDecisionMutation('shelve', 'd1', {
    projectDir: 'C:/repo',
    reviewAt: '2026-12-01T00:00:00.000Z',
    actorSessionID: 'ses_agent',
  }, deps(), true).status).toBe(403);
  expect(handleDecisionMutation('reopen', 'd1', {
    projectDir: 'C:/repo',
    actorSessionID: 'ses_agent',
  }, deps(), true).status).toBe(403);
});

test('confirm calls the service for a human', () => {
  const d = deps();
  const out = handleDecisionMutation('confirm', 'd1', { projectDir: 'C:/repo' }, d, true);
  expect(out.status).toBe(200);
  expect(d.service.confirm).toHaveBeenCalledWith('d1', { projectDir: 'C:/repo' });
});
