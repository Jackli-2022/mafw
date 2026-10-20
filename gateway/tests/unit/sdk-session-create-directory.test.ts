import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SdkSessionResource } from '../../src/resources/sdk-session';

describe('SdkSessionResource.create directory', () => {
  test('creates with the given directory and records it (no "." fallback)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sdk-session-'));
    const created: any[] = [];
    const fakeClient: any = {
      session: {
        create: async (opts: any) => { created.push(opts); return { id: 'sess_1', projectID: 'p', title: 't' }; },
      },
    };
    const res = new SdkSessionResource(fakeClient, dir);
    const rec = await res.create('/proj/real');
    expect(created).toEqual([{ directory: '/proj/real' }]);
    expect(rec.directory).toBe('/proj/real');
  });

  test('local-only fallback also keeps the given directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sdk-session-'));
    const res = new SdkSessionResource(undefined, dir);
    const rec = await res.create('/proj/local');
    expect(rec.directory).toBe('/proj/local');
  });

  test('empty/undefined directory → fail-loud (no silent "." substitution)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sdk-session-'));
    const res = new SdkSessionResource(undefined, dir);
    await expect((res as any).create(undefined)).rejects.toThrow(/directory is required/);
    await expect((res as any).create('')).rejects.toThrow(/directory is required/);
  });
});
