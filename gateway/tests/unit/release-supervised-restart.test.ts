import * as fs from 'fs';
import * as path from 'path';
import { executePendingRestart, MANAGED_RESTART_EXIT_CODE } from '../../src/self-update';

type ExitSignal = Error & { code: number };

function exitSignal(code: number): ExitSignal {
  return Object.assign(new Error(`exit:${code}`), { code });
}

describe('executePendingRestart', () => {
  test('managed restart exits for supervisor without spawning a takeover child', async () => {
    const calls: string[] = [];
    let stopped = false;

    await expect(executePendingRestart({
      managed: true,
      build: () => {
        calls.push('build');
        return { ok: true };
      },
      writeRestartInfo: () => {
        calls.push('restart-info');
      },
      spawnTakeoverChild: () => {
        calls.push('spawn');
        return { exitCode: 0 };
      },
      sleep: async () => {
        calls.push('sleep');
      },
      stop: async () => {
        stopped = true;
        calls.push('stop');
      },
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw exitSignal(code);
      }) as never,
    })).rejects.toMatchObject({ code: MANAGED_RESTART_EXIT_CODE });

    expect(calls).toEqual(['restart-info', 'stop', `exit:${MANAGED_RESTART_EXIT_CODE}`]);
    expect(stopped).toBe(true);
  });

  test('an aborted restart does not disable the token watcher', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/self-update.ts'),
      'utf8',
    );
    const start = source.indexOf('await executePendingRestart({');
    const end = source.indexOf('}, TOKEN_POLL_MS)', start);
    const tail = source.slice(start, end > start ? end : undefined);
    expect(tail).not.toMatch(/running\s*=\s*false/);
  });

  test('source checkout restart keeps build plus takeover behavior', async () => {
    const calls: string[] = [];
    let child: { exitCode: number | null } | null = null;

    await expect(executePendingRestart({
      managed: false,
      build: () => {
        calls.push('build');
        return { ok: true };
      },
      writeRestartInfo: () => {
        calls.push('restart-info');
      },
      spawnTakeoverChild: () => {
        calls.push('spawn');
        child = { exitCode: null };
        return child;
      },
      sleep: async () => {
        calls.push('sleep');
        if (child) child.exitCode = null;
      },
      stop: async () => {
        calls.push('stop');
      },
      exit: ((code: number) => {
        calls.push(`exit:${code}`);
        throw exitSignal(code);
      }) as never,
    })).rejects.toMatchObject({ code: 0 });

    expect(calls).toEqual(['build', 'restart-info', 'spawn', 'sleep', 'stop', 'exit:0']);
  });
});
