import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildGoalCharter,
  createGoalIntake,
  GoalConflictError,
  makePodGoalId,
  type GoalIntakeDeps,
} from '../../../src/core/goal/goal-intake';

describe('goal intake', () => {
  let dir: string;
  let events: any[];

  const deps = (): GoalIntakeDeps => ({
    resolveProject: () => ({ projectDir: dir, mafwDir: path.join(dir, '.mafw') }),
    now: () => '2026-11-02T01:02:03.000Z',
    emitGoalCreated: (event) => events.push(event),
  });

  const base = {
    title: 'Fix Pod',
    objective: 'Make status truthful',
    acceptance: ['tests pass'],
    boundaries: ['no parallel work'],
    taskType: 'feature' as const,
    planReview: 'manual' as const,
    authorization: { source: 'desktop' as const, requestMode: 'explicit' as const },
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-goal-intake-'));
    events = [];
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('composer and MCP create the same request shape with authorization', () => {
    const a = createGoalIntake({ ...base, goalId: 'g-desktop', authorization: base.authorization }, deps());
    const b = createGoalIntake({
      ...base,
      goalId: 'g-lead',
      authorization: { source: 'lead', requestMode: 'explicit' },
    }, deps());

    expect(JSON.parse(fs.readFileSync(a.requestPath, 'utf8'))).toMatchObject({
      version: '2',
      goalId: 'g-desktop',
      title: 'Fix Pod',
      acceptance: ['tests pass'],
      boundaries: ['no parallel work'],
      planReview: 'manual',
      authorization: { source: 'desktop', requestMode: 'explicit' },
    });
    expect(JSON.parse(fs.readFileSync(b.requestPath, 'utf8')).authorization.source).toBe('lead');
    expect(fs.readFileSync(a.charterPath, 'utf8')).toContain('Make status truthful');
    expect(events.map((e) => e.goalId)).toEqual(['g-desktop', 'g-lead']);
  });

  test('MCP may supply an explicit charter without an objective', () => {
    const result = createGoalIntake({
      ...base, goalId: 'g-charter', objective: undefined, charter: '# Prewritten',
    }, deps());
    expect(fs.readFileSync(result.charterPath, 'utf8')).toBe('# Prewritten');
  });

  test('invalid task type leaves no partial files', () => {
    expect(() => createGoalIntake({ ...base, goalId: 'g-bad', taskType: 'nope' as any }, deps()))
      .toThrow(/invalid taskType/);
    expect(fs.existsSync(path.join(dir, '.mafw', 'goals', 'g-bad.md'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.mafw', 'requests', 'g-bad.json'))).toBe(false);
  });

  test('duplicate goal leaves the existing files untouched', () => {
    const first = createGoalIntake({ ...base, goalId: 'g-dup' }, deps());
    const before = fs.readFileSync(first.charterPath, 'utf8');
    expect(() => createGoalIntake({ ...base, goalId: 'g-dup', title: 'Changed' }, deps()))
      .toThrow(GoalConflictError);
    expect(fs.readFileSync(first.charterPath, 'utf8')).toBe(before);
  });

  test('autoStart false leaves starting to the caller', () => {
    createGoalIntake({ ...base, goalId: 'g-deferred', autoStart: false }, deps());
    expect(events).toHaveLength(0);
  });

  test('goal ids are stable for a given timestamp and random source', () => {
    expect(makePodGoalId('2026-11-02T01:02:03.000Z', () => 0.5)).toBe('goal-20261102-010203-800000');
  });

  test('charter contains acceptance and boundaries', () => {
    const charter = buildGoalCharter({
      title: 'Fix Pod', objective: 'Truthful',
      acceptance: ['status is honest'], boundaries: ['no parallel'],
    });
    expect(charter).toContain('# Fix Pod');
    expect(charter).toContain('status is honest');
    expect(charter).toContain('no parallel');
  });
});
