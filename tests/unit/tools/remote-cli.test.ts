import { exec } from 'child_process';
import { RemoteCliConnector } from '../../../gateway/src/core/tools/remote-cli';

jest.mock('child_process', () => ({
  exec: jest.fn()
}));

const execMock = exec as unknown as jest.Mock;

beforeEach(() => {
  execMock.mockReset();
});

function mockExecSuccess(stdout = '', stderr = '') {
  execMock.mockImplementation((_cmd: string, callback: any) => {
    callback(null, { stdout, stderr });
  });
}

function mockExecFailure(message = 'command failed', code = 1) {
  execMock.mockImplementation((_cmd: string, callback: any) => {
    const err: any = new Error(message);
    err.code = code;
    err.stderr = '';
    callback(err, { stdout: '', stderr: '' });
  });
}

test('sync returns output on success', async () => {
  mockExecSuccess('synced');
  const cli = new RemoteCliConnector();
  const result = await cli.sync({ localDir: '/local', remoteHost: 'host', remoteDir: '/remote' });
  expect(result.success).toBe(true);
  expect(result.output).toContain('synced');
});

test('sync returns error output on failure', async () => {
  mockExecFailure('host down');
  const cli = new RemoteCliConnector();
  const result = await cli.sync({ localDir: '/local', remoteHost: 'host', remoteDir: '/remote' });
  expect(result.success).toBe(false);
  expect(result.output).toContain('host down');
});

test('run returns exit code 0 on success', async () => {
  mockExecSuccess('tests passed');
  const cli = new RemoteCliConnector();
  const result = await cli.run({ host: 'host', command: 'npm test', cwd: '/app' });
  expect(result.success).toBe(true);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain('tests passed');
});

test('run returns non-zero exit code on failure', async () => {
  mockExecFailure('tests failed', 2);
  const cli = new RemoteCliConnector();
  const result = await cli.run({ host: 'host', command: 'npm test', cwd: '/app' });
  expect(result.success).toBe(false);
  expect(result.exitCode).toBe(2);
});

test('fetch returns remote file content', async () => {
  mockExecSuccess('coverage: 85%');
  const cli = new RemoteCliConnector();
  const result = await cli.fetch({ host: 'host', remotePath: '/app/coverage.txt' });
  expect(result.success).toBe(true);
  expect(result.content).toContain('coverage');
});

test('fetchTestResults parses coverage and errors', async () => {
  mockExecSuccess('coverage: 92.5%\nerrors: 3');
  const cli = new RemoteCliConnector();
  const result = await cli.fetchTestResults({ host: 'host', resultPath: '/app/results.txt' });
  expect(result.coverage).toBe(92.5);
  expect(result.errors).toBe(3);
});

test('fetchTestResults returns zeros on fetch failure', async () => {
  mockExecFailure('not found');
  const cli = new RemoteCliConnector();
  const result = await cli.fetchTestResults({ host: 'host', resultPath: '/app/missing.txt' });
  expect(result.coverage).toBe(0);
  expect(result.errors).toBe(0);
});

test('run handles special characters in command via mock', async () => {
  mockExecSuccess('ok');
  const cli = new RemoteCliConnector();
  const result = await cli.run({ host: 'host', command: 'echo "hello; world"', cwd: '/app' });
  expect(result.success).toBe(true);
});
