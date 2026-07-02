import * as http from 'http';
import { DashboardServer } from '../../../gateway/src/dashboard/server';

let server: DashboardServer;
const PORT = 34567;

function get(path: string): Promise<{ status: number; body: string; contentType?: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        body: data,
        contentType: res.headers['content-type']
      }));
    }).on('error', reject);
  });
}

beforeAll(async () => {
  server = new DashboardServer(PORT);
  await server.start();
});

afterAll(() => {
  server.stop();
});

test('dashboard / returns index.html SPA', async () => {
  const res = await get('/');
  expect(res.status).toBe(200);
  expect(res.contentType).toContain('text/html');
  expect(res.body).toContain('MAFW');
});

test('dashboard /dashboard returns index.html (SPA fallback)', async () => {
  const res = await get('/dashboard');
  expect(res.status).toBe(200);
  expect(res.contentType).toContain('text/html');
  expect(res.body).toContain('MAFW');
});

test('dashboard unknown path returns index.html (SPA fallback)', async () => {
  const res = await get('/unknown');
  expect(res.status).toBe(200);
  expect(res.contentType).toContain('text/html');
});

test('dashboard /api/health returns JSON', async () => {
  const res = await get('/api/health');
  expect(res.status).toBe(200);
  expect(res.contentType).toContain('application/json');
  const body = JSON.parse(res.body);
  expect(body.status).toBe('ok');
});
