import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backgroundJobEvent,
  backgroundJobFromSynthetic,
  backgroundJobStatusOfShell,
  backgroundJobStatusOfSubagent,
  isTerminalBackgroundStatus,
  jobFromRuntimeShell,
  jobFromSubagent,
  runtimeShellRowFromSynthetic,
  shellRowFromJob,
  sortBackgroundJobs,
  subagentRowFromJob,
  type BackgroundSubagentRow,
  type RuntimeShellRow,
} from './index.ts';

const shell = (row: Partial<RuntimeShellRow> = {}): RuntimeShellRow => ({
  id: 'sh_1',
  sessionID: 'ses_parent',
  ...row,
});

test('isTerminalBackgroundStatus: active, waiting, unknown are not terminal', () => {
  assert.equal(isTerminalBackgroundStatus('running'), false);
  assert.equal(isTerminalBackgroundStatus('input_required'), false);
  assert.equal(isTerminalBackgroundStatus('waiting'), false);
  assert.equal(isTerminalBackgroundStatus('unknown'), false);
  assert.equal(isTerminalBackgroundStatus('completed'), true);
  assert.equal(isTerminalBackgroundStatus('failed'), true);
  assert.equal(isTerminalBackgroundStatus('cancelled'), true);
});

test('backgroundJobStatusOfShell maps native shell statuses; missing stays unknown', () => {
  assert.equal(backgroundJobStatusOfShell('running'), 'running');
  assert.equal(backgroundJobStatusOfShell('started'), 'running');
  assert.equal(backgroundJobStatusOfShell(undefined), 'unknown');
  assert.equal(backgroundJobStatusOfShell('weird'), 'unknown');
  assert.equal(backgroundJobStatusOfShell('exited', 0), 'completed');
  assert.equal(backgroundJobStatusOfShell('exited', 2), 'failed');
  assert.equal(backgroundJobStatusOfShell('timeout'), 'failed');
  assert.equal(backgroundJobStatusOfShell('killed'), 'cancelled');
});

test('backgroundJobStatusOfSubagent maps authoritative subagent statuses', () => {
  assert.equal(backgroundJobStatusOfSubagent('completed'), 'completed');
  assert.equal(backgroundJobStatusOfSubagent('failed'), 'failed');
  assert.equal(backgroundJobStatusOfSubagent('aborted'), 'cancelled');
  assert.equal(backgroundJobStatusOfSubagent('running'), 'running');
  assert.equal(backgroundJobStatusOfSubagent('input_required'), 'running');
  assert.equal(backgroundJobStatusOfSubagent('waiting'), 'waiting');
  assert.equal(backgroundJobStatusOfSubagent('unknown'), 'unknown');
  assert.equal(backgroundJobStatusOfSubagent(undefined, false), 'unknown');
  assert.equal(backgroundJobStatusOfSubagent(undefined, true), 'completed');
});

test('jobFromSubagent uses the child session as its stable id', () => {
  const info = jobFromSubagent({ id: 'ses_child', parentID: 'ses_parent', title: 'explore' });
  assert.deepEqual(info, {
    id: 'ses_child',
    source: 'subagent',
    kind: 'subagent',
    status: 'unknown',
    sessionID: 'ses_parent',
    title: 'explore',
    childSessionID: 'ses_child',
  });
});

test('jobFromSubagent maps canonical lifecycle and preserves observation', () => {
  const waiting = jobFromSubagent({
    id: 'ses_waiting',
    parentID: 'ses_parent',
    lifecycle: {
      phase: 'waiting',
      observedAt: 10,
      lastActivityAt: 9,
      waitingOn: ['children'],
      epoch: 'e1',
      authority: 'runtime',
    },
  });
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.observedAt, 10);
  assert.equal(waiting.lastActivityAt, 9);
  assert.deepEqual(waiting.waitingOn, ['children']);

  const settled = jobFromSubagent({
    id: 'ses_done',
    parentID: 'ses_parent',
    lifecycle: {
      phase: 'settled',
      outcome: 'completed',
      observedAt: 20,
      terminalAt: 19,
      epoch: 'e1',
      authority: 'runtime',
    },
  });
  assert.equal(settled.status, 'completed');
  assert.equal(settled.time?.completed, 19);

  const unknown = jobFromSubagent({
    id: 'ses_legacy',
    parentID: 'ses_parent',
    lifecycle: {
      phase: 'unknown',
      reason: 'legacy-no-idle',
      observedAt: 30,
      lastActivityAt: 5,
      epoch: 'e1',
      authority: 'adapter',
    },
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.lastActivityAt, 5);
});

test('jobFromSubagent keeps explicit owner session over parentID', () => {
  const info = jobFromSubagent({ id: 'ses_child', parentID: 'ses_parent' }, 'ses_owner');
  assert.equal(info.sessionID, 'ses_owner');
});

test('jobFromRuntimeShell keeps the native shell id and maps status', () => {
  const job = jobFromRuntimeShell(shell({ id: 'sh_9', command: 'npm test', status: 'killed' }));
  assert.deepEqual(job, {
    id: 'sh_9',
    source: 'runtime-shell',
    kind: 'shell',
    status: 'cancelled',
    sessionID: 'ses_parent',
    runtimeShellID: 'sh_9',
    title: 'npm test',
    command: 'npm test',
  });
});

test('shellRowFromJob round-trips a shell job without changing status', () => {
  const job = jobFromRuntimeShell(shell({ id: 'sh_1', status: 'exited', exitCode: 0, time: { created: 1, updated: 2 } }));
  const row = shellRowFromJob(job);
  assert.deepEqual(row, {
    id: 'sh_1',
    sessionID: 'ses_parent',
    status: 'exited',
    exitCode: 0,
    time: { created: 1, updated: 2 },
  });
  assert.equal(jobFromRuntimeShell(row).status, job.status);
});

test('subagentRowFromJob round-trips a subagent job without changing status', () => {
  const job = jobFromSubagent({ id: 'ses_c', parentID: 'ses_parent', status: 'aborted' });
  const row = subagentRowFromJob(job);
  assert.equal(row.status, 'aborted');
  assert.equal(jobFromSubagent(row).status, 'cancelled');
});

test('subagentRowFromJob preserves unknown observation fields', () => {
  const job = jobFromSubagent({
    id: 'ses_legacy',
    parentID: 'ses_parent',
    lifecycle: {
      phase: 'unknown', reason: 'legacy-no-idle', observedAt: 10,
      lastActivityAt: 5, epoch: 'e1', authority: 'adapter',
    },
  });
  const row = subagentRowFromJob(job);
  assert.equal(row.lifecycle?.phase, 'unknown');
  assert.equal(row.lifecycle?.lastActivityAt, 5);
  assert.equal(jobFromSubagent(row).status, 'unknown');
});

test('runtimeShellRowFromSynthetic normalises shell metadata (legacy + normalized)', () => {
  assert.deepEqual(runtimeShellRowFromSynthetic('ses_1', { source: 'shell', shellID: 'sh_1', command: 'pwd' }, 42), {
    id: 'sh_1',
    sessionID: 'ses_1',
    status: 'running',
    command: 'pwd',
    time: { updated: 42 },
  });
  assert.equal(
    runtimeShellRowFromSynthetic('ses_1', { source: 'shell', shellID: 'sh_1', status: 'completed', exitCode: 0 })?.status,
    'exited',
  );
  assert.equal(runtimeShellRowFromSynthetic('ses_1', { source: 'shell', jobID: 'sh_2', exit: 2 })?.status, 'exited');
  assert.equal(runtimeShellRowFromSynthetic('ses_1', { source: 'shell', jobID: 'sh_3', state: 'cancelled' })?.status, 'killed');
  assert.equal(runtimeShellRowFromSynthetic('ses_1', { source: 'shell', jobID: 'sh_4', timeout: true })?.status, 'timeout');
  assert.equal(runtimeShellRowFromSynthetic('ses_1', { source: 'subagent', childID: 'ses_c' }), null);
  assert.equal(runtimeShellRowFromSynthetic('ses_1', {}), null);
});

test('backgroundJobFromSynthetic derives a shell job from a synthetic lifecycle message', () => {
  assert.deepEqual(
    backgroundJobFromSynthetic('ses_1', {
      source: 'shell',
      shellID: 'sh_1',
      status: 'completed',
      exitCode: 0,
      command: 'pwd',
    }, 42),
    {
      id: 'sh_1',
      source: 'runtime-shell',
      kind: 'shell',
      status: 'completed',
      sessionID: 'ses_1',
      runtimeShellID: 'sh_1',
      title: 'pwd',
      command: 'pwd',
      exitCode: 0,
      time: { updated: 42, completed: 42 },
    },
  );
});

test('backgroundJobFromSynthetic derives a subagent job and rejects non-lifecycle metadata', () => {
  const job = backgroundJobFromSynthetic('ses_1', { source: 'subagent', childID: 'ses_c', description: 'explore' }, 7);
  assert.deepEqual(job, {
    id: 'ses_c',
    source: 'subagent',
    kind: 'subagent',
    status: 'completed',
    sessionID: 'ses_1',
    childSessionID: 'ses_c',
    title: 'explore',
    time: { updated: 7, completed: 7 },
  });
  assert.equal(backgroundJobFromSynthetic('ses_1', { source: 'subagent', state: 'error', childID: 'ses_c' })?.status, 'failed');
  assert.equal(backgroundJobFromSynthetic('ses_1', { source: 'subagent', status: 'cancelled', childID: 'ses_c' })?.status, 'cancelled');
  assert.equal(backgroundJobFromSynthetic('ses_1', { source: 'subagent' }), null);
  assert.equal(backgroundJobFromSynthetic(undefined, { source: 'shell', shellID: 'sh_1' }), null);
  assert.equal(backgroundJobFromSynthetic('ses_1', null), null);
});

test('backgroundJobEvent wraps a job into the canonical background.job.updated envelope', () => {
  const job = jobFromRuntimeShell(shell({ id: 'sh_1' }));
  const evt = backgroundJobEvent(job, { directory: 'C:/work' });
  assert.equal(evt.payload.type, 'background.job.updated');
  assert.deepEqual(evt.payload.properties.job, job);
  assert.equal(evt.sessionID, 'ses_parent');
  assert.equal(evt.directory, 'C:/work');
});

test('sortBackgroundJobs puts active jobs first, then newest updated, with id tie-break', () => {
  const sorted = sortBackgroundJobs([
    jobFromRuntimeShell(shell({ id: 'sh_done_old', status: 'killed', time: { updated: 10 } })),
    jobFromRuntimeShell(shell({ id: 'sh_done_new', status: 'killed', time: { updated: 30 } })),
    jobFromRuntimeShell(shell({ id: 'sh_active', status: 'running', time: { updated: 5 } })),
    jobFromRuntimeShell(shell({ id: 'sh_tie_b', status: 'killed', time: { updated: 20 } })),
    jobFromRuntimeShell(shell({ id: 'sh_tie_a', status: 'killed', time: { updated: 20 } })),
  ]).map((job) => job.id);
  assert.deepEqual(sorted, ['sh_active', 'sh_done_new', 'sh_tie_a', 'sh_tie_b', 'sh_done_old']);
});

test('subagentRowFromJob type is exported for merge callers', () => {
  const row: BackgroundSubagentRow = { id: 'ses_c' };
  assert.equal(row.id, 'ses_c');
});
