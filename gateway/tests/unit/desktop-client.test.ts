import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { DesktopClient } from '../../src/desktop-client';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-client-'));
  return path.join(dir, 'desktop-automation.json');
}

/** 最小桌面自动化 HTTP 桩：记录请求，回 JSON */
function stubServer(): Promise<{ server: http.Server; port: number; requests: { url: string; auth: string }[] }> {
  const requests: { url: string; auth: string }[] = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url || '', auth: String(req.headers.authorization || '') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ filePath: '/tmp/x.png', width: 1, height: 1 }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, requests });
    });
  });
}

function close(server: http.Server): void {
  server.close();
  server.closeAllConnections();
}

function writeInfo(file: string, info: { port: number; secret: string }): void {
  fs.writeFileSync(file, JSON.stringify(info), 'utf-8');
}

function bumpMtime(file: string): void {
  const st = fs.statSync(file);
  const future = new Date(st.mtimeMs + 100);
  fs.utimesSync(file, future, future);
}

describe('DesktopClient — 端口文件自愈', () => {
  test('tryLoad：文件不存在返回 null', () => {
    expect(DesktopClient.tryLoad([tmpFile()])).toBeNull();
  });

  test('带 Bearer 鉴权请求正确的 endpoint', async () => {
    const file = tmpFile();
    const { server, port, requests } = await stubServer();
    writeInfo(file, { port, secret: 's3cret' });
    const client = DesktopClient.tryLoad([file])!;
    const r = await client.screenshot();
    expect(r.filePath).toBe('/tmp/x.png');
    expect(requests[0].url).toBe('/screenshot');
    expect(requests[0].auth).toBe('Bearer s3cret');
    close(server);
  });

  test('desktop 重启换端口（文件 mtime 变化）后自动跟随新端口', async () => {
    const file = tmpFile();
    const a = await stubServer();
    const b = await stubServer();
    writeInfo(file, { port: a.port, secret: 'k1' });
    const client = DesktopClient.tryLoad([file])!;
    await client.screenshot();
    expect(a.requests.length).toBe(1);

    // 模拟 desktop 重启：旧服务停、新服务起、文件重写为新端口
    close(a.server);
    writeInfo(file, { port: b.port, secret: 'k2' });
    bumpMtime(file);

    const r = await client.screenshot();
    expect(r.filePath).toBe('/tmp/x.png');
    expect(b.requests.length).toBe(1);
    expect(b.requests[0].auth).toBe('Bearer k2');
    close(b.server);
  });

  test('fail-open：文件损坏时沿用旧端口继续工作', async () => {
    const file = tmpFile();
    const a = await stubServer();
    writeInfo(file, { port: a.port, secret: 'k1' });
    const client = DesktopClient.tryLoad([file])!;
    await client.screenshot();

    fs.writeFileSync(file, '{ broken json', 'utf-8');
    bumpMtime(file);

    const r = await client.screenshot();
    expect(r.filePath).toBe('/tmp/x.png');
    expect(a.requests.length).toBe(2);
    close(a.server);
  });
});
