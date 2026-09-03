import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SdkSessionResource } from '../../src/resources/sdk-session';

describe('SdkSessionResource.updateMetadata', () => {
  let dir: string;
  let res: SdkSessionResource;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sdk-session-'));
    res = new SdkSessionResource(undefined, dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('replaces metadata and persists to disk', async () => {
    await res.registerExternal('ses_a', 'C:/proj', { mafw: { role: 'manager', pinned: true, exemptFromTrim: true } });
    const updated = await res.updateMetadata('ses_a', { mafw: { role: 'manager-archived' } });
    expect(updated?.metadata).toEqual({ mafw: { role: 'manager-archived' } });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', 'ses_a.json'), 'utf-8'));
    expect(onDisk.metadata).toEqual({ mafw: { role: 'manager-archived' } });
  });

  it('returns null for unknown session', async () => {
    expect(await res.updateMetadata('ses_missing', { a: 1 })).toBeNull();
  });
});
