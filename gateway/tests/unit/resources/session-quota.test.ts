/**
 * E4-7 会话配额（spec §4.7）。配额在 runtime 调用之前检查：
 * 拒绝的请求不得留下「SDK 已建会话但本地没记录」或反之的半状态。
 */
import { QuotaExceededError, QuotaService } from '../../../src/resources/quotas';
import { SdkSessionResource } from '../../../src/runtime/sdk-session';
import * as path from 'path';

type Limits = { projects: number; sessions: number; sessionRecordsPerProject: number };

function quotas(over: Partial<Limits> = {}): QuotaService {
  return new QuotaService({
    limits: (): Limits => ({ projects: 0, sessions: 0, sessionRecordsPerProject: 0, ...over }),
  });
}

function resource(limits: QuotaService): SdkSessionResource {
  // No client + no mafwDir: local-only records, no disk writes.
  return new SdkSessionResource(undefined, undefined, { quotas: limits });
}

describe('SdkSessionResource: session quotas', () => {
  it('rejects the second create when sessions limit is 1 and leaves the first intact', async () => {
    const sessions = resource(quotas({ sessions: 1 }));
    const first = await sessions.create('/proj/a');
    expect(first.id).toBeTruthy();

    await expect(sessions.create('/proj/a')).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await sessions.list()).toHaveLength(1);
    expect(await sessions.get(first.id)).toEqual(first);
  });

  it('errors carry the sessions resource, limit and current count', async () => {
    const sessions = resource(quotas({ sessions: 1 }));
    await sessions.create('/proj/a');
    let err: any;
    try {
      await sessions.create('/proj/b');
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe('quota_exceeded');
    expect(err.resource).toBe('sessions');
    expect(err.limit).toBe(1);
    expect(err.current).toBe(1);
  });

  it('enforces per-directory records independently of other directories', async () => {
    const sessions = resource(quotas({ sessionRecordsPerProject: 1 }));
    await sessions.create('/proj/a');
    await sessions.create('/proj/b');
    await expect(sessions.create('/proj/a')).rejects.toBeInstanceOf(QuotaExceededError);

    let err: any;
    try {
      await sessions.create('/proj/a');
    } catch (e) {
      err = e;
    }
    expect(err.resource).toBe('sessionRecordsPerProject');
    expect(err.limit).toBe(1);
    expect(err.current).toBe(1);
    expect(sessions.countByDirectory('/proj/b')).toBe(1);
  });

  it('counts by directory via count()/countByDirectory()', async () => {
    const sessions = resource();
    await sessions.create('/proj/a');
    await sessions.create('/proj/a');
    await sessions.create('/proj/b');
    expect(sessions.count()).toBe(3);
    expect(sessions.countByDirectory('/proj/a')).toBe(2);
    expect(sessions.countByDirectory('/proj/unknown')).toBe(0);
  });

  it('treats limits 0 as unlimited', async () => {
    const sessions = resource(quotas({ sessions: 0, sessionRecordsPerProject: 0 }));
    for (let i = 0; i < 25; i++) await sessions.create('/proj/a');
    expect(sessions.count()).toBe(25);
  });

  it('registerExternal charges new ids but allows replacing an existing id', async () => {
    const sessions = resource(quotas({ sessions: 1 }));
    await sessions.registerExternal('ext-1', '/proj/a');
    // Replace: same id already present → not a new slot.
    await expect(sessions.registerExternal('ext-1', '/proj/a')).resolves.toMatchObject({ id: 'ext-1' });
    // New id → quota applies.
    await expect(sessions.registerExternal('ext-2', '/proj/b')).rejects.toBeInstanceOf(QuotaExceededError);
    expect(sessions.count()).toBe(1);
  });

  it('registerExternal enforces the per-directory record quota for new ids', async () => {
    const sessions = resource(quotas({ sessionRecordsPerProject: 1 }));
    await sessions.registerExternal('ext-1', '/proj/a');
    await expect(sessions.registerExternal('ext-2', '/proj/a')).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('shares one per-directory bucket across trailing separators', async () => {
    const sessions = resource(quotas({ sessionRecordsPerProject: 1 }));
    const dir = path.resolve(__dirname, 'proj-trailing');
    await sessions.create(dir);
    await expect(sessions.create(dir + path.sep)).rejects.toBeInstanceOf(QuotaExceededError);
    expect(sessions.countByDirectory(dir + path.sep)).toBe(1);
    expect(sessions.countByDirectory(dir)).toBe(1);
  });

  it('normalizes Windows directory casing for the per-directory bucket', async () => {
    if (process.platform !== 'win32') return;
    const sessions = resource(quotas({ sessionRecordsPerProject: 1 }));
    const dir = path.resolve(__dirname, 'proj-case');
    await sessions.create(dir.toLowerCase());
    await expect(sessions.create(dir.toUpperCase())).rejects.toBeInstanceOf(QuotaExceededError);
    expect(sessions.countByDirectory(dir.toUpperCase())).toBe(1);
  });

  it('rejects BEFORE calling the runtime (no SDK session without a local record)', async () => {
    const client = {
      session: {
        create: jest.fn(async () => ({ id: 'sdk-1', projectID: 'p', title: 't' })),
        delete: jest.fn(async () => undefined),
      },
    };
    const sessions = new SdkSessionResource(client as any, undefined, { quotas: quotas({ sessions: 1 }) });
    await sessions.create('/proj/a');
    expect(client.session.create).toHaveBeenCalledTimes(1);

    await expect(sessions.create('/proj/b')).rejects.toBeInstanceOf(QuotaExceededError);
    expect(client.session.create).toHaveBeenCalledTimes(1);
    expect(sessions.count()).toBe(1);
  });
});
