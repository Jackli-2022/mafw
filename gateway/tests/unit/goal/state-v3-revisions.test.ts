import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  archiveGoalStateForRevision,
  effectiveRevision,
  ensureGoalState,
  loadGoalState,
  revisionStatePathFor,
  statePathFor,
  writeGoalState,
} from '../../../src/core/goal/state-v3';

describe('state-v3 goal revisions', () => {
  let mafwDir: string;

  beforeEach(() => {
    mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-state-revisions-'));
  });

  afterEach(() => {
    fs.rmSync(mafwDir, { recursive: true, force: true });
  });

  const init = (revision?: number) => ensureGoalState(mafwDir, 'g1', {
    revision,
    projectDir: '/proj/a',
    maxRounds: 3,
  });

  const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));

  test('a legacy v3 state without revision normalizes to revision 1', () => {
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'state', 'g1.json'),
      JSON.stringify({ goalId: 'g1', phase: 'PLANNING', round: 2, loop: 2, nextAction: 'RUNNING_execute' }),
      'utf-8',
    );

    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(1);
    expect(effectiveRevision({})).toBe(1);
    expect(effectiveRevision({ revision: 0 })).toBe(1);
    expect(effectiveRevision({ revision: 3 })).toBe(3);
  });

  test('ensureGoalState defaults to revision 1 and keeps the active state file', () => {
    const state = init();

    expect(state.revision).toBe(1);
    expect(fs.existsSync(statePathFor(mafwDir, 'g1'))).toBe(true);
    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(1);
    expect(loadGoalState(mafwDir, 'g1')?.nextAction).toBe('RUNNING_plan');
  });

  test('archiveGoalStateForRevision snapshots the active revision', () => {
    init(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED', phase: 'COMPLETED' });

    const archivedPath = archiveGoalStateForRevision(mafwDir, 'g1', 1);

    expect(archivedPath).toBe(revisionStatePathFor(mafwDir, 'g1', 1));
    expect(archivedPath && fs.existsSync(archivedPath)).toBe(true);
    expect(readJson(archivedPath!)).toMatchObject({
      goalId: 'g1',
      revision: 1,
      nextAction: 'COMPLETED',
      phase: 'COMPLETED',
    });
  });

  test('archive defaults to the active revision and never rewrites an existing snapshot', () => {
    init(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED' });

    expect(archiveGoalStateForRevision(mafwDir, 'g1')).toBe(revisionStatePathFor(mafwDir, 'g1', 1));

    writeGoalState(mafwDir, 'g1', { nextAction: 'FAILED', lastError: 'late rewrite' });
    archiveGoalStateForRevision(mafwDir, 'g1', 1);

    expect(readJson(revisionStatePathFor(mafwDir, 'g1', 1))).toMatchObject({
      revision: 1,
      nextAction: 'COMPLETED',
      lastError: null,
    });
  });

  test('archive returns null when the goal has no active state', () => {
    expect(archiveGoalStateForRevision(mafwDir, 'missing', 1)).toBeNull();
  });

  test('opening revision 2 archives revision 1 and reinitializes the active state', () => {
    init(1);
    writeGoalState(mafwDir, 'g1', {
      phase: 'COMPLETED',
      nextAction: 'COMPLETED',
      round: 2,
      reviewVerdict: 'PASS',
      artifacts: { plan: 'waves.json' },
    });

    const next = ensureGoalState(mafwDir, 'g1', {
      revision: 2,
      projectDir: '/proj/a',
      maxRounds: 3,
    });

    expect(next.revision).toBe(2);
    expect(next.phase).toBe('PLANNING');
    expect(next.nextAction).toBe('RUNNING_plan');
    expect(next.round).toBe(1);
    expect(next.loop).toBe(1);
    expect(next.reviewVerdict).toBeNull();
    expect(next.artifacts).toEqual({});
    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(2);

    const archivePath = revisionStatePathFor(mafwDir, 'g1', 1);
    const archived = fs.readFileSync(archivePath, 'utf-8');
    expect(JSON.parse(archived)).toMatchObject({
      revision: 1,
      nextAction: 'COMPLETED',
      reviewVerdict: 'PASS',
    });
    // Active state stays at the legacy-compatible path; the archive is separate.
    expect(fs.existsSync(statePathFor(mafwDir, 'g1'))).toBe(true);

    // Revision 2 progress never touches the revision 1 snapshot.
    writeGoalState(mafwDir, 'g1', { nextAction: 'RUNNING_execute', round: 2 });
    expect(fs.readFileSync(archivePath, 'utf-8')).toBe(archived);
  });

  test('ensureGoalState is idempotent for the active revision and never downgrades', () => {
    init(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'RUNNING_execute', round: 2 });

    expect(ensureGoalState(mafwDir, 'g1', { revision: 1, projectDir: '/proj/a', maxRounds: 3 }))
      .toMatchObject({ revision: 1, nextAction: 'RUNNING_execute', round: 2 });
    expect(ensureGoalState(mafwDir, 'g1', { projectDir: '/proj/a', maxRounds: 3 }))
      .toMatchObject({ revision: 1, nextAction: 'RUNNING_execute' });

    const second = ensureGoalState(mafwDir, 'g1', { revision: 2, projectDir: '/proj/a', maxRounds: 3 });
    expect(second.revision).toBe(2);
    expect(second.nextAction).toBe('RUNNING_plan');

    const downgrade = ensureGoalState(mafwDir, 'g1', { revision: 1, projectDir: '/proj/a', maxRounds: 3 });
    expect(downgrade.revision).toBe(2);
    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(2);
  });

  test('each new revision appends its snapshot without touching earlier archives', () => {
    init(1);
    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED', reviewVerdict: 'PASS' });
    ensureGoalState(mafwDir, 'g1', { revision: 2, projectDir: '/proj/a', maxRounds: 3 });
    const rev1 = fs.readFileSync(revisionStatePathFor(mafwDir, 'g1', 1), 'utf-8');

    writeGoalState(mafwDir, 'g1', { nextAction: 'COMPLETED', reviewVerdict: 'FAIL' });
    ensureGoalState(mafwDir, 'g1', { revision: 3, projectDir: '/proj/a', maxRounds: 3 });

    expect(fs.existsSync(revisionStatePathFor(mafwDir, 'g1', 1))).toBe(true);
    expect(fs.existsSync(revisionStatePathFor(mafwDir, 'g1', 2))).toBe(true);
    expect(fs.readFileSync(revisionStatePathFor(mafwDir, 'g1', 1), 'utf-8')).toBe(rev1);
    expect(readJson(revisionStatePathFor(mafwDir, 'g1', 2))).toMatchObject({
      revision: 2,
      nextAction: 'COMPLETED',
      reviewVerdict: 'FAIL',
    });
    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(3);
  });
});
