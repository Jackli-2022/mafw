import { snapshotBeforeWrite, fileHistorySnapshotUrl } from '../src/utils/file-history';

describe('snapshotBeforeWrite（写前文件历史）', () => {
  test('POST sessionID/directory/paths 到 gateway', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const realFetch = global.fetch;
    global.fetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), body: JSON.parse(init?.body ?? '{}') });
      return { ok: true, status: 200 } as any;
    }) as any;
    try {
      const ok = await snapshotBeforeWrite({
        sessionID: 'ses_1',
        directory: '/proj',
        paths: ['/proj/a.txt'],
      });
      expect(ok).toBe(true);
      expect(calls[0].url).toBe(fileHistorySnapshotUrl());
      expect(calls[0].body).toEqual({
        sessionID: 'ses_1',
        directory: '/proj',
        paths: ['/proj/a.txt'],
        reason: 'tool:before',
      });
    } finally {
      global.fetch = realFetch;
    }
  });

  test('失败 fail-open（返回 false，不抛）', async () => {
    const realFetch = global.fetch;
    global.fetch = (async () => { throw new Error('down'); }) as any;
    try {
      expect(await snapshotBeforeWrite({ sessionID: 's', directory: '/p', paths: ['/p/a'] })).toBe(false);
    } finally {
      global.fetch = realFetch;
    }
  });
});
