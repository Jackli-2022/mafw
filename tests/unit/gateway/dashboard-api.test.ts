import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { DashboardAPI } from '../../../gateway/src/dashboard/api';

const PORT = 34569;
const BASE = `http://127.0.0.1:${PORT}`;

function request(method: string, url: string, body?: any): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: parseInt(urlObj.port, 10),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('DashboardAPI', () => {
  let api: DashboardAPI;
  let server: http.Server;
  let tmpDir: string;
  let mafwDir: string;

  beforeAll(async () => {
    // Create temp project dir with mafw structure
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mafw-test-'));
    mafwDir = path.join(tmpDir, '.opencode', 'mafw');
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'requests'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'reviews'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'lessons'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'parametric'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'cost'), { recursive: true });

    // Create a sample state file
    const stateFile = {
      version: '1',
      goalId: 'test-goal',
      loop: 1,
      phase: 'PLANNING',
      lastPhase: null,
      currentWave: 0,
      totalWaves: 3,
      sessions: {},
      nextAction: 'CREATE_PLAN_SESSION',
      artifacts: {},
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(mafwDir, 'state', 'test-goal.json'), JSON.stringify(stateFile));

    // Sample cost data
    const costDir = path.join(mafwDir, 'cost');
    fs.writeFileSync(path.join(costDir, 'goal-001.json'), JSON.stringify([
      { id: 'c1', goalId: 'goal-001', loopNum: 1, waveNum: 1, toolName: 'file_edit', estimatedTokens: 0, estimatedCost: 0, timestamp: '2026-07-01T00:00:00Z' },
      { id: 'c2', goalId: 'goal-001', loopNum: 1, waveNum: 2, toolName: 'mafw_review', estimatedTokens: 1000, estimatedCost: 0.003, timestamp: '2026-07-01T00:01:00Z' },
    ], null, 2));

    api = new DashboardAPI(tmpDir);

    server = http.createServer(async (req, res) => {
      await api.handle(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(PORT, resolve);
    });
  });

  afterAll(() => {
    server?.close();
    // Clean up temp dir
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('GET /api/health returns ok', async () => {
    const res = await request('GET', `${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });

  test('GET /api/goals returns array', async () => {
    const res = await request('GET', `${BASE}/api/goals`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].goalId).toBe('test-goal');
    expect(body[0].phase).toBe('PLANNING');
  });

  test('GET /api/goals/:id returns goal detail', async () => {
    const res = await request('GET', `${BASE}/api/goals/test-goal`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.goalId).toBe('test-goal');
    expect(body.state).toBeDefined();
    expect(body.state.phase).toBe('PLANNING');
  });

  test('GET /api/goals/:id/loops returns loops', async () => {
    const res = await request('GET', `${BASE}/api/goals/test-goal/loops`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/goals/:id/loops/:loop returns session replay', async () => {
    const res = await request('GET', `${BASE}/api/goals/test-goal/loops/1`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /api/memory/:goalId returns memory object with tiers and entries', async () => {
    const res = await request('GET', `${BASE}/api/memory/test-goal`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('tiers');
    expect(body).toHaveProperty('entries');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  test('GET /api/memory/energy-distribution returns distribution', async () => {
    const res = await request('GET', `${BASE}/api/memory/energy-distribution`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('critical');
    expect(body).toHaveProperty('high');
    expect(body).toHaveProperty('medium');
    expect(body).toHaveProperty('low');
    expect(body).toHaveProperty('total');
  });

  test('GET /api/memory/search returns search results', async () => {
    const res = await request('GET', `${BASE}/api/memory/search?query=test&goalId=test-goal`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('query');
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
  });

  test('OPTIONS returns CORS headers', async () => {
    const res = await request('OPTIONS', `${BASE}/api/health`);
    expect(res.status).toBe(204);
  });

  test('unknown route returns 404', async () => {
    const res = await request('GET', `${BASE}/api/unknown`);
    expect(res.status).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Not found');
  });

  test('unknown path returns 404', async () => {
    const res = await request('GET', `${BASE}/not-exists`);
    expect(res.status).toBe(404);
  });

  describe('Costs', () => {
    test('GET /api/costs/:goalId returns cost breakdown', async () => {
      const res = await request('GET', `${BASE}/api/costs/goal-001`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.totalTokens).toBe(1000);
      expect(data.totalCost).toBe(0.003);
      expect(data.byWave).toHaveLength(2);
      expect(data.byTool).toHaveLength(2);
    });

    test('GET /api/costs/summary returns aggregate', async () => {
      const res = await request('GET', `${BASE}/api/costs/summary`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.totalGoals).toBe(1);
      expect(data.totalTokens).toBe(1000);
    });

    test('returns empty for unknown goal', async () => {
      const res = await request('GET', `${BASE}/api/costs/unknown`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.totalTokens).toBe(0);
    });
  });
});
