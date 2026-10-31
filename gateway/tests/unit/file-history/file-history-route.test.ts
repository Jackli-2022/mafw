import * as http from 'http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileHistoryService } from '../../../src/core/file-history/file-history-service';
import { handleFileHistoryRoutes } from '../../../src/routes/file-history';

async function startServer(
  service: FileHistoryService,
  isLoopback = true,
  resolveDirectory?: (sessionID: string) => Promise<string | null>,
) {
  const server = http.createServer(async (req, res) => {
    const handled = await handleFileHistoryRoutes(req, res, { service: () => service, isLoopback, resolveDirectory });
    if (!handled) { res.writeHead(404); res.end('{}'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

describe('file-history routes', () => {
  let root: string;
  let project: string;
  let svc: FileHistoryService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mafw-fh-route-'));
    project = join(root, 'proj');
    mkdirSync(project, { recursive: true });
    svc = new FileHistoryService(join(root, 'history'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('snapshot → list → restore 闭环', async () => {
    const file = join(project, 'deck.pptx');
    writeFileSync(file, Buffer.from([1, 2, 3]));
    const { server, base } = await startServer(svc);
    try {
      const snap = await fetch(`${base}/api/file-history/snapshot`, {
        method: 'POST',
        body: JSON.stringify({ sessionID: 'ses_1', directory: project, paths: ['deck.pptx'], reason: 'tool:write' }),
      });
      expect(snap.status).toBe(200);
      const snapBody: any = await snap.json();
      expect(snapBody.entries).toHaveLength(1);
      const entryId = snapBody.entries[0].id;

      writeFileSync(file, Buffer.from([9, 9]));
      const list = await fetch(`${base}/api/file-history?sessionID=ses_1&rel=deck.pptx`);
      expect(list.status).toBe(200);
      expect(((await list.json()) as any).entries).toHaveLength(1);

      const restore = await fetch(`${base}/api/file-history/restore`, {
        method: 'POST',
        body: JSON.stringify({ sessionID: 'ses_1', entryId }),
      });
      expect(restore.status).toBe(200);
      expect(readFileSync(file).equals(Buffer.from([1, 2, 3]))).toBe(true);
    } finally {
      server.close();
    }
  });

  it('绝对路径（session 目录内）可快照；目录外拒绝', async () => {
    const file = join(project, 'abs.pptx');
    writeFileSync(file, 'x');
    const outside = join(root, 'outside.pptx');
    writeFileSync(outside, 'y');
    const { server, base } = await startServer(svc);
    try {
      const ok = await fetch(`${base}/api/file-history/snapshot`, {
        method: 'POST',
        body: JSON.stringify({ sessionID: 'ses_1', directory: project, paths: [file] }),
      });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as any).entries).toHaveLength(1);
      const bad = await fetch(`${base}/api/file-history/snapshot`, {
        method: 'POST',
        body: JSON.stringify({ sessionID: 'ses_1', directory: project, paths: [outside] }),
      });
      expect(bad.status).toBe(200);
      expect(((await bad.json()) as any).entries).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it('directory 缺省时按 sessionID 解析（office 技能只传 sessionID）', async () => {
    const file = join(project, 'deck.pptx');
    writeFileSync(file, 'x');
    const { server, base } = await startServer(svc, true, async (sid) => (sid === 'ses_1' ? project : null));
    try {
      const snap = await fetch(`${base}/api/file-history/snapshot`, {
        method: 'POST',
        body: JSON.stringify({ sessionID: 'ses_1', paths: ['deck.pptx'] }),
      });
      expect(snap.status).toBe(200);
      expect(((await snap.json()) as any).entries).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('参数校验 + 非 loopback 拒绝', async () => {
    const { server, base } = await startServer(svc);
    try {
      const bad = await fetch(`${base}/api/file-history/snapshot`, { method: 'POST', body: JSON.stringify({}) });
      expect(bad.status).toBe(400);
      const badList = await fetch(`${base}/api/file-history`);
      expect(badList.status).toBe(400);
    } finally {
      server.close();
    }
    const denied = await startServer(svc, false);
    try {
      const res = await fetch(`${denied.base}/api/file-history?sessionID=x`);
      expect(res.status).toBe(403);
    } finally {
      denied.server.close();
    }
  });
});
