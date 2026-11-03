import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveGoalRef } from '../../../src/core/goal/goal-identity';

function workspace(): { root: string; a: string; b: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-goal-identity-'));
  const a = path.join(root, 'project-a');
  const b = path.join(root, 'project-b');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  return { root, a, b };
}

function writeRequest(projectDir: string, goalId: string): void {
  const dir = path.join(projectDir, '.mafw', 'goals', goalId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ goalId }), 'utf-8');
}

describe('resolveGoalRef', () => {
  test('resolves a goal inside its explicit canonical project', () => {
    const { a, b } = workspace();
    writeRequest(a, 'goal-a');

    expect(resolveGoalRef([a, b], 'goal-a')).toEqual({
      ok: true,
      ref: { projectDir: fs.realpathSync(a), goalId: 'goal-a' },
      mafwDir: path.join(fs.realpathSync(a), '.mafw'),
    });
  });

  test('returns ambiguous when two registered projects contain the same goalId', () => {
    const { a, b } = workspace();
    writeRequest(a, 'shared');
    writeRequest(b, 'shared');

    const result = resolveGoalRef([b, a], 'shared');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ambiguity');
    expect(result.reason).toBe('ambiguous');
    expect(result.candidates).toEqual([
      fs.realpathSync(a),
      fs.realpathSync(b),
    ].sort());
  });

  test('explicit projectDir narrows an otherwise ambiguous goal', () => {
    const { a, b } = workspace();
    writeRequest(a, 'shared');
    writeRequest(b, 'shared');

    expect(resolveGoalRef([a, b], 'shared', { projectDir: b })).toMatchObject({
      ok: true,
      ref: { projectDir: fs.realpathSync(b), goalId: 'shared' },
    });
  });

  test('does not fall back to the first project when no request belongs to it', () => {
    const { a, b } = workspace();

    expect(resolveGoalRef([a, b], 'missing')).toEqual({
      ok: false,
      reason: 'not_found',
      candidates: [],
    });
  });

  test('canonical-equivalent duplicate registrations are one project, not ambiguity', () => {
    const { a } = workspace();
    writeRequest(a, 'goal-a');

    expect(resolveGoalRef([a, a], 'goal-a')).toMatchObject({
      ok: true,
      ref: { projectDir: fs.realpathSync(a), goalId: 'goal-a' },
    });
    expect(resolveGoalRef([a, `${a}${path.sep}.`], 'goal-a')).toMatchObject({ ok: true });
  });
});
