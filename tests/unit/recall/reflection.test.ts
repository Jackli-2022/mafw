import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarmonicIndexManager } from '../../../gateway/src/core/memory/harmonic-index';
import { ReflectionPipeline, parseInsights, unreflectedBySession, ORPHAN_SESSION } from '../../../gateway/src/recall/reflection';
import { ReflectCursor } from '../../../gateway/src/recall/reflect-cursor';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { MemoryWorker } from '../../../gateway/src/recall/memory-worker';

describe('ReflectionPipeline (reflection → distilled memory)', () => {
  let tmpDir: string;
  let index: HarmonicIndexManager;
  let cursor: ReflectCursor;
  let fakeClient: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rf-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    index = new HarmonicIndexManager(tmpDir);
    cursor = new ReflectCursor(new GatewayDatabase(':memory:'));
    fakeClient = {
      session: {
        create: jest.fn().mockImplementation(async () => ({ data: { id: 'reflect-1' } })),
        prompt: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const mkWorker = () => new MemoryWorker(fakeClient, { directory: tmpDir });

  const seedEpisodic = (id: string, sessionID: string) => {
    index.addEntry({
      id,
      type: 'episodic',
      primary_abstraction: `episodic ${id}`,
      cue_anchors: ['x'],
      memory_value: 'v',
      energy: 0.7,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_session_id: sessionID,
    }, 'episodic');
  };

  const mkPipeline = () =>
    new ReflectionPipeline({
      index,
      baseDir: tmpDir,
      workerFor: () => mkWorker(),
      cursor,
    });

  const mockInsights = (text: string) => {
    fakeClient.session.prompt.mockResolvedValue({ data: { parts: [{ type: 'text', text }] } });
  };

  test('distills insights from unreflected episodic memories per session', async () => {
    seedEpisodic('ep-1', 's1');
    mockInsights('{"insights":[{"category":"preference","content":"user prefers pnpm over npm","cue_anchors":["pnpm"]},{"category":"failure","content":"localStorage tokens are XSS-unsafe"}]}');

    const res = await mkPipeline().runAll();

    expect(res.sessions).toBe(1);
    expect(res.reviewed).toBe(1);
    expect(res.distilled).toBe(2);
    const types = index.getIndex().entries.filter((e) => e.type !== 'episodic').map((e) => e.type);
    expect(types.sort()).toEqual(['semantic', 'semantic']);
  });

  test('incremental cursor: second run only processes newly added episodes', async () => {
    seedEpisodic('ep-1', 's1');
    mockInsights('{"insights":[{"category":"insight","content":"prefer pnpm for package management"}]}');
    await mkPipeline().runAll();

    seedEpisodic('ep-2', 's1');
    mockInsights('{"insights":[{"category":"insight","content":"cache npm artifacts in CI"}]}');
    const res = await mkPipeline().runAll();

    expect(res.reviewed).toBe(1); // only ep-2
    expect(res.distilled).toBe(1);
  });

  test('failed reflection keeps episodes unreflected (retry next run)', async () => {
    seedEpisodic('ep-1', 's1');
    fakeClient.session.prompt.mockRejectedValue(new Error('serve down'));
    const res = await mkPipeline().runAll();
    expect(res.failed).toBe(1);

    // next run retries the same episode
    mockInsights('{"insights":[{"category":"insight","content":"recovered"}]}');
    const res2 = await mkPipeline().runAll();
    expect(res2.reviewed).toBe(1);
    expect(res2.distilled).toBe(1);
  });

  test('dedups insights similar to existing semantic memory', async () => {
    seedEpisodic('ep-1', 's1');
    index.addEntry({
      id: 'mem-existing',
      type: 'semantic',
      primary_abstraction: 'user prefers pnpm over npm',
      cue_anchors: ['pnpm'],
      memory_value: 'user prefers pnpm over npm',
      energy: 0.9,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, 'semantic');
    mockInsights('{"insights":[{"category":"preference","content":"user prefers pnpm over npm","cue_anchors":["pnpm"]}]}');

    const res = await mkPipeline().runAll();
    expect(res.deduped).toBe(1);
    expect(res.distilled).toBe(0);
    // all-dedup still marks the batch reflected — the LLM processed it, and
    // re-running would only re-extract the same (deduped) insight
    expect(cursor.reflectedIds('s1').has('ep-1')).toBe(true);
  });

  test('insights carry source_session_id', async () => {
    seedEpisodic('ep-1', 's1');
    mockInsights('{"insights":[{"category":"tool-quirk","content":"CI needs frozen lockfile"}]}');
    await mkPipeline().runAll();
    const written = index.getIndex().entries.find((e) => e.type === 'procedural');
    expect(written?.source_session_id).toBe('s1');
  });

  test('runSession reflects only the requested session', async () => {
    seedEpisodic('ep-a', 'sa');
    seedEpisodic('ep-b', 'sb');
    mockInsights('{"insights":[{"category":"insight","content":"from sa"}]}');

    const res = await mkPipeline().runSession('sa');
    expect(res.reviewed).toBe(1);
    // sb untouched
    expect(cursor.reflectedIds('sb').size).toBe(0);
  });

  test('legacy episodes without source_session_id land in the orphan group', () => {
    index.addEntry({
      id: 'ep-legacy',
      type: 'episodic',
      primary_abstraction: 'old memory',
      cue_anchors: [],
      memory_value: 'v',
      energy: 0.5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, 'episodic');
    const bySession = unreflectedBySession(index, cursor, 100);
    expect(bySession.get(ORPHAN_SESSION)?.length).toBe(1);
  });
});

describe('ReflectCursor (DB-backed)', () => {
  let dbPath: string;
  let db: GatewayDatabase;
  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-rc-'));
    dbPath = path.join(tmpDir, 'gateway.db');
    db = new GatewayDatabase(dbPath);
  });
  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  test('persists marked ids across connections', () => {
    const c1 = new ReflectCursor(db);
    c1.markReflected('s1', ['a', 'b']);
    const db2 = new GatewayDatabase(dbPath);
    const c2 = new ReflectCursor(db2);
    expect(c2.reflectedIds('s1').has('a')).toBe(true);
    expect(c2.reflectedIds('s1').has('b')).toBe(true);
    db2.close();
  });

  test('missing cursor degrades to empty', () => {
    const c = new ReflectCursor(db);
    expect(c.reflectedIds('nope').size).toBe(0);
  });

  test('marking is idempotent', () => {
    const c = new ReflectCursor(db);
    c.markReflected('s1', ['a']);
    c.markReflected('s1', ['a', 'b']);
    expect(c.reflectedIds('s1').size).toBe(2);
  });

  test('prune drops ids not in the live set', () => {
    const c = new ReflectCursor(db);
    c.markReflected('s1', ['a', 'b']);
    c.prune(new Set(['b']));
    expect(c.reflectedIds('s1').has('a')).toBe(false);
    expect(c.reflectedIds('s1').has('b')).toBe(true);
  });
});

describe('parseInsights', () => {
  test('filters invalid categories and empty content', () => {
    const text = '{"insights":[{"category":"preference","content":"pnpm"},{"category":"bogus","content":"x"},{"content":"no category"}]}';
    const parsed = parseInsights(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].category).toBe('preference');
  });

  test('handles markdown-wrapped output', () => {
    const text = '```json\n{"insights":[{"category":"tool-quirk","content":"CI needs --frozen-lockfile"}]}\n```';
    expect(parseInsights(text)).toHaveLength(1);
  });

  test('rejects garbage', () => {
    expect(parseInsights('nope')).toEqual([]);
  });
});
