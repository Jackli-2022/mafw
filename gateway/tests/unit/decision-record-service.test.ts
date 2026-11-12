import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecisionRecordService, DecisionRecordError, findMafwDirForProject } from '../../src/core/decision/decision-record-service';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'mafw-decisions-'));
  let tick = 0;
  const service = new DecisionRecordService({
    mafwDir: () => root,
    now: () => new Date(2026, 10, 12, 0, 0, tick++).toISOString(),
    id: () => `dec_${tick++}`,
  });
  return { root, service, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function draft(service: DecisionRecordService, overrides: Record<string, unknown> = {}) {
  return service.draft({
    projectDir: 'C:/repo',
    goalId: 'g1',
    revision: 1,
    kind: 'plan',
    question: '采用哪个方案？',
    ...overrides,
  } as any);
}

test('draft writes a draft record and lists it', () => {
  const { service, cleanup } = setup();
  try {
    const record = draft(service);
    expect(record.status).toBe('draft');
    expect(record.decidedBy).toBeNull();
    expect(record.history).toEqual([
      expect.objectContaining({ action: 'drafted', by: 'agent' }),
    ]);
    const listed = service.list('C:/repo');
    expect(listed).toHaveLength(1);
    expect(listed[0].question).toBe('采用哪个方案？');
  } finally {
    cleanup();
  }
});

test('confirm sets decided and preserves the audit trail', () => {
  const { service, cleanup } = setup();
  try {
    const record = draft(service);
    const confirmed = service.confirm(record.id, {
      projectDir: 'C:/repo',
      rationale: '方案 A 更稳',
      consequences: '放弃方案 B',
    });
    expect(confirmed.status).toBe('decided');
    expect(confirmed.decidedBy).toBe('user');
    expect(confirmed.rationale).toBe('方案 A 更稳');
    expect(confirmed.history.map((entry) => entry.action)).toEqual(['drafted', 'confirmed']);
  } finally {
    cleanup();
  }
});

test('shelve requires a review date', () => {
  const { service, cleanup } = setup();
  try {
    const record = draft(service);
    expect(() => service.shelve(record.id, { projectDir: 'C:/repo', reviewAt: '' }))
      .toThrow(DecisionRecordError);
    expect(() => service.shelve(record.id, { projectDir: 'C:/repo', reviewAt: 'not-a-date' }))
      .toThrow(DecisionRecordError);
  } finally {
    cleanup();
  }
});

test('reopen returns a shelved record to draft', () => {
  const { service, cleanup } = setup();
  try {
    const record = draft(service);
    service.shelve(record.id, {
      projectDir: 'C:/repo',
      reviewAt: '2026-12-01T00:00:00.000Z',
      note: '等下一版',
    });
    const reopened = service.reopen(record.id, { projectDir: 'C:/repo', note: '新证据' });
    expect(reopened.status).toBe('draft');
    expect(reopened.decidedBy).toBeNull();
    expect(reopened.decidedAt).toBeNull();
    expect(reopened.history.map((entry) => entry.action)).toEqual(['drafted', 'shelved', 'reopened']);
  } finally {
    cleanup();
  }
});

test('list filters by goal and sorts by updatedAt', () => {
  const { service, cleanup } = setup();
  try {
    const first = draft(service, { question: 'first' });
    draft(service, { goalId: 'g2', question: 'second' });
    service.confirm(first.id, { projectDir: 'C:/repo', rationale: 'later' });

    const g1 = service.list('C:/repo', 'g1');
    expect(g1).toHaveLength(1);
    expect(g1[0].question).toBe('first');
    expect(service.list('C:/repo')).toHaveLength(2);
    expect(service.list('C:/repo')[0].question).toBe('first');
  } finally {
    cleanup();
  }
});

test('records survive a second service instance', () => {
  const { root, service, cleanup } = setup();
  try {
    draft(service);
    const restarted = new DecisionRecordService({ mafwDir: () => root });
    expect(restarted.list('C:/repo')).toHaveLength(1);
  } finally {
    cleanup();
  }
});

test('mafwDir lookup tolerates non-canonical registered keys', () => {
  const entries = new Map([
    ['C:\\Repo\\', { mafwDir: 'C:/repo/.mafw' }],
    ['C:\\Other', { mafwDir: 'C:/other/.mafw' }],
  ]);
  const canonical = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  expect(findMafwDirForProject(entries, 'C:/repo', canonical)).toBe('C:/repo/.mafw');
  expect(findMafwDirForProject(entries, 'c:/other/', canonical)).toBe('C:/other/.mafw');
  expect(findMafwDirForProject(entries, 'C:/missing', canonical)).toBeNull();
});
