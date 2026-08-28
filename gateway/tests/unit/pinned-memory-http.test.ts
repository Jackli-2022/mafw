/**
 * Tests for pinned memory HTTP endpoints:
 * - POST /api/memory/pin  (toggle pinned flag)
 * - POST /api/memory/add  (create with pinned parameter)
 * - GET  /api/recall/pinned (retrieve pinned profile)
 */
import * as http from 'http';

// ---- Shared helpers -------------------------------------------------------

function postJson(server: http.Server, path: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(server: http.Server, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    http.get({ hostname: '127.0.0.1', port: addr.port, path }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    }).on('error', reject);
  });
}

// ---- Mock store (in-memory, mirrors HarmonicUnitFileStore interface) -------

interface MockUnit {
  id: string;
  type: string;
  primary_abstraction: string;
  cue_anchors: string[];
  memory_value: string;
  energy: number;
  salience?: number;
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  superseded_by?: string;
  filePath?: string;
}

class MockStore {
  private units = new Map<string, MockUnit>();
  private nextId = 1;

  getIndex() {
    return {
      entries: Array.from(this.units.values()).map((u) => ({
        id: u.id,
        type: u.type,
        primary_abstraction: u.primary_abstraction,
        cue_anchors: u.cue_anchors,
        energy: u.energy,
        salience: u.salience,
        pinned: u.pinned,
        superseded_by: u.superseded_by,
        filePath: u.filePath,
        created_at: u.created_at,
      })),
    };
  }

  async read(id: string): Promise<MockUnit | null> {
    return this.units.get(id) ?? null;
  }

  setPinned(id: string, pinned: boolean): boolean {
    const u = this.units.get(id);
    if (!u) return false;
    u.pinned = pinned;
    u.updated_at = new Date().toISOString();
    return true;
  }

  async write(unit: MockUnit): Promise<void> {
    if (!unit.id) unit.id = `mem_${this.nextId++}`;
    this.units.set(unit.id, { ...unit, filePath: `.okf/${unit.id}.okf` });
  }

  markSuperseded(id: string, by: string): boolean {
    const u = this.units.get(id);
    if (!u) return false;
    u.superseded_by = by;
    return true;
  }
}

// ---- Server factory --------------------------------------------------------

function createServer(store: MockStore) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // POST /api/memory/pin
    if (url.pathname === '/api/memory/pin' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk.toString();
      try {
        const data = JSON.parse(body);
        const id = String(data?.id || '');
        if (!id) { res.writeHead(400); res.end(JSON.stringify({ success: false, error: 'id required' })); return; }
        const pinned = data?.pinned === true;
        const ok = store.setPinned(id, pinned);
        if (!ok) { res.writeHead(404); res.end(JSON.stringify({ success: false, error: `memory not found: ${id}` })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id, pinned }));
      } catch (err: any) {
        res.writeHead(500); res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // POST /api/memory/add (with pinned parameter)
    if (url.pathname === '/api/memory/add' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk.toString();
      try {
        const data = JSON.parse(body);
        const content = String(data?.content || '').trim();
        const memoryType = String(data?.memoryType || 'semantic');
        if (!content || !['episodic', 'semantic', 'procedural', 'global'].includes(memoryType)) {
          res.writeHead(400); res.end(JSON.stringify({ success: false, error: 'content and valid memoryType required' })); return;
        }
        const now = new Date().toISOString();
        const unit: MockUnit = {
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: memoryType,
          primary_abstraction: String(data?.primaryAbstraction || content).slice(0, 200),
          cue_anchors: Array.isArray(data?.cueAnchors) ? data.cueAnchors.slice(0, 8).map(String) : [],
          memory_value: content.slice(0, 4000),
          energy: 0.8,
          salience: typeof data?.importance === 'number' ? data.importance / 10 : 0.5,
          created_at: now,
          updated_at: now,
          pinned: data?.pinned === true || undefined,
        };
        await store.write(unit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: unit.id }));
      } catch (err: any) {
        res.writeHead(500); res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // GET /api/recall/pinned
    if (url.pathname === '/api/recall/pinned' && req.method === 'GET') {
      try {
        const pinned = store.getIndex().entries
          .filter((e) => e.pinned && !e.superseded_by)
          .sort((a, b) => (b.energy ?? 0) * (b.salience ?? 1) - (a.energy ?? 0) * (a.salience ?? 1));
        const units: MockUnit[] = [];
        for (const e of pinned) {
          const u = await store.read(e.id);
          if (u) units.push(u);
        }
        const { formatPinnedProfile } = require('../../src/recall/inject-format');
        const { profile, used } = formatPinnedProfile(units);
        const entries = units.slice(0, used).map((u) => ({
          id: u.id, type: u.type, primary_abstraction: u.primary_abstraction,
          memory_value: u.memory_value, energy: u.energy, salience: u.salience, created_at: u.created_at,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ profile, entries, budget: { max: 20, maxChars: 2000, used } }));
      } catch (err: any) {
        res.writeHead(500); res.end(JSON.stringify({ profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } }));
      }
      return;
    }

    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  });
}

// ---- Tests ----------------------------------------------------------------

describe('POST /api/memory/pin', () => {
  let server: http.Server;
  let store: MockStore;

  beforeEach(async () => {
    store = new MockStore();
    // Seed two memories
    await store.write({
      id: 'mem_1', type: 'semantic', primary_abstraction: '偏好中文',
      cue_anchors: ['中文'], memory_value: '用户偏好中文回复', energy: 0.8,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    await store.write({
      id: 'mem_2', type: 'episodic', primary_abstraction: '会议记录',
      cue_anchors: ['会议'], memory_value: '周一开了站会', energy: 0.6,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    server = createServer(store);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  afterEach((done) => { server?.close(done); });

  it('pin=true sets pinned on existing memory', async () => {
    const res = await postJson(server, '/api/memory/pin', { id: 'mem_1', pinned: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 'mem_1', pinned: true });
    const entry = store.getIndex().entries.find((e) => e.id === 'mem_1');
    expect(entry?.pinned).toBe(true);
  });

  it('pin=false unpins a pinned memory', async () => {
    store.setPinned('mem_1', true);
    const res = await postJson(server, '/api/memory/pin', { id: 'mem_1', pinned: false });
    expect(res.status).toBe(200);
    expect(res.body.pinned).toBe(false);
    expect(store.getIndex().entries.find((e) => e.id === 'mem_1')?.pinned).toBe(false);
  });

  it('returns 404 for unknown id', async () => {
    const res = await postJson(server, '/api/memory/pin', { id: 'mem_nope', pinned: true });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  it('returns 400 when id is missing', async () => {
    const res = await postJson(server, '/api/memory/pin', { pinned: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('id required');
  });

  it('non-boolean pinned value defaults to false', async () => {
    const res = await postJson(server, '/api/memory/pin', { id: 'mem_1', pinned: 'yes' });
    expect(res.status).toBe(200);
    expect(res.body.pinned).toBe(false);
  });
});

describe('POST /api/memory/add with pinned parameter', () => {
  let server: http.Server;
  let store: MockStore;

  beforeEach(async () => {
    store = new MockStore();
    server = createServer(store);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  afterEach((done) => { server?.close(done); });

  it('pinned: true creates a pinned memory', async () => {
    const res = await postJson(server, '/api/memory/add', {
      content: '用户偏好暗色主题',
      memoryType: 'semantic',
      pinned: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
    const entry = store.getIndex().entries.find((e) => e.id === res.body.id);
    expect(entry?.pinned).toBe(true);
  });

  it('pinned omitted creates unpinned memory', async () => {
    const res = await postJson(server, '/api/memory/add', {
      content: '每周五开回顾会',
      memoryType: 'procedural',
    });
    expect(res.status).toBe(200);
    const entry = store.getIndex().entries.find((e) => e.id === res.body.id);
    expect(entry?.pinned).toBeFalsy();
  });

  it('pinned: false explicitly creates unpinned memory', async () => {
    const res = await postJson(server, '/api/memory/add', {
      content: '项目使用 monorepo 结构',
      memoryType: 'semantic',
      pinned: false,
    });
    expect(res.status).toBe(200);
    const entry = store.getIndex().entries.find((e) => e.id === res.body.id);
    expect(entry?.pinned).toBeFalsy();
  });

  it('returns 400 for missing content', async () => {
    const res = await postJson(server, '/api/memory/add', { memoryType: 'semantic', pinned: true });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid memoryType', async () => {
    const res = await postJson(server, '/api/memory/add', {
      content: 'test', memoryType: 'invalid', pinned: true,
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/recall/pinned (integration)', () => {
  let server: http.Server;
  let store: MockStore;

  beforeEach(async () => {
    store = new MockStore();
    const now = new Date().toISOString();
    await store.write({
      id: 'mem_pinned_a', type: 'semantic', primary_abstraction: '偏好中文',
      cue_anchors: ['中文'], memory_value: '用户偏好中文回复', energy: 0.9, salience: 0.8,
      created_at: now, updated_at: now, pinned: true,
    });
    await store.write({
      id: 'mem_pinned_b', type: 'global', primary_abstraction: '语言规则',
      cue_anchors: ['语言'], memory_value: '始终用简体中文', energy: 0.7, salience: 0.6,
      created_at: now, updated_at: now, pinned: true,
    });
    await store.write({
      id: 'mem_unpinned', type: 'semantic', primary_abstraction: '临时记录',
      cue_anchors: [], memory_value: '昨天调试了端口问题', energy: 0.5,
      created_at: now, updated_at: now, pinned: false,
    });
    await store.write({
      id: 'mem_superseded', type: 'semantic', primary_abstraction: '旧偏好',
      cue_anchors: [], memory_value: '偏好英文', energy: 0.4,
      created_at: now, updated_at: now, pinned: true, superseded_by: 'mem_pinned_a',
    });
    server = createServer(store);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  afterEach((done) => { server?.close(done); });

  it('returns only pinned && !superseded entries, sorted by energy×salience', async () => {
    const res = await getJson(server, '/api/recall/pinned');
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: any) => e.id)).toEqual(['mem_pinned_a', 'mem_pinned_b']);
    expect(res.body.profile).toContain('用户偏好中文回复');
    expect(res.body.profile).toContain('始终用简体中文');
    expect(res.body.budget.used).toBe(2);
  });

  it('excludes superseded pinned entries', async () => {
    const res = await getJson(server, '/api/recall/pinned');
    const ids = res.body.entries.map((e: any) => e.id);
    expect(ids).not.toContain('mem_superseded');
  });

  it('excludes unpinned entries', async () => {
    const res = await getJson(server, '/api/recall/pinned');
    const ids = res.body.entries.map((e: any) => e.id);
    expect(ids).not.toContain('mem_unpinned');
  });

  it('returns null profile when no pinned entries exist', async () => {
    // Unpin all
    store.setPinned('mem_pinned_a', false);
    store.setPinned('mem_pinned_b', false);
    const res = await getJson(server, '/api/recall/pinned');
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
    expect(res.body.budget.used).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it('enforces budget cap (max 20 entries)', async () => {
    // Seed 25 pinned entries
    for (let i = 0; i < 25; i++) {
      await store.write({
        id: `mem_bulk_${i}`, type: 'semantic', primary_abstraction: `条目${i}`,
        cue_anchors: [], memory_value: `记忆内容${i}`, energy: 0.5,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), pinned: true,
      });
    }
    const res = await getJson(server, '/api/recall/pinned');
    expect(res.body.entries.length).toBeLessThanOrEqual(20);
    expect(res.body.budget.used).toBeLessThanOrEqual(20);
  });
});
