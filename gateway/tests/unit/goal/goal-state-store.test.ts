import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { GoalStateStore } from '../../../src/core/goal/goal-state-store';
import { statePathFor, type GoalStateV3 } from '../../../src/core/goal/state-v3';

function legacy(): GoalStateV3 {
  return {
    version: '3', goalId: 'g1', revision: 1, projectDir: 'p', mafwDir: 'm',
    phase: 'PLANNING', round: 1, loop: 1, maxRounds: 3, reviewVerdict: null,
    reviewReportPath: null, reviewFeedback: '', wavePlanPath: null, receiptPath: null,
    lastError: null, nodeSession: null, pendingQuestion: null, userResponse: null,
    sameSigCount: 0, stateVersion: 0, nextNode: 'plan', nextAction: 'RUNNING_plan',
    artifacts: {}, currentWave: 0, totalWaves: null, sessions: {},
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
}

test('imports a legacy state file on first load and then serves it from sqlite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-state-'));
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(statePathFor(dir, 'g1'), JSON.stringify(legacy()));
  const store = new GoalStateStore(new Database(':memory:'));
  expect(store.load(dir, 'g1')?.phase).toBe('PLANNING');
  fs.rmSync(statePathFor(dir, 'g1'));
  expect(store.load(dir, 'g1')?.goalId).toBe('g1');
});

test('save writes sqlite first and mirrors the json file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-state-'));
  const store = new GoalStateStore(new Database(':memory:'));
  store.save(dir, 'g1', { ...legacy(), phase: 'EXECUTING' });
  expect(JSON.parse(fs.readFileSync(statePathFor(dir, 'g1'), 'utf-8')).phase).toBe('EXECUTING');
  expect(store.list().map((s) => s.goalId)).toEqual(['g1']);
});

test('archives a revision once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-state-'));
  const store = new GoalStateStore(new Database(':memory:'));
  store.save(dir, 'g1', legacy());
  store.archiveRevision(dir, 'g1', 1);
  store.archiveRevision(dir, 'g1', 1);
  expect(store.list()).toHaveLength(1);
  expect(fs.existsSync(path.join(dir, 'state', 'revisions', 'g1', 'rev-1.json'))).toBe(true);
});

test('successive patches merge against the latest stored state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-state-'));
  const store = new GoalStateStore(new Database(':memory:'));
  store.save(dir, 'g1', { ...legacy(), phase: 'PLANNING' });
  store.save(dir, 'g1', { ...store.load(dir, 'g1')!, phase: 'EXECUTING' });
  store.save(dir, 'g1', { ...store.load(dir, 'g1')!, round: 2, loop: 2 });
  expect(store.load(dir, 'g1')).toMatchObject({ phase: 'EXECUTING', round: 2 });
});
