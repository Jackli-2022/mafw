import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { CoactivationGraphStore } from '../../../src/graph/coactivation-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, sessionId: string): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: [],
    memory_value: abstraction, energy: 0.8, created_at: now, updated_at: now,
    source_session_id: sessionId,
  } as HarmonicUnit;
}

function build(dir: string, db: GatewayDatabase) {
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const coact = new CoactivationGraphStore(db);
  index.setCoactivationGraphStore(coact);
  return { index, coact };
}

describe('searchScored coactivation diffusion', () => {
  test('共激活项被提到无关联项之前', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-s-'));
    const db = new GatewayDatabase(path.join(dir, 'test.db'));
    const { index, coact } = build(dir, db);
    // query 命中 'target'；'linked' 与 target 同会话但词面不匹配
    index.addEntry(unit('target', 'kubernetes deployment rollout', 's1'), 'semantic');
    index.addEntry(unit('linked', 'incident postmortem notes', 's1'), 'semantic');
    index.addEntry(unit('other', 'unrelated content here', 's2'), 'semantic');
    coact.upsertUnit({ id: 'target', source_session_id: 's1', created_at: new Date().toISOString() });
    coact.upsertUnit({ id: 'linked', source_session_id: 's1', created_at: new Date().toISOString() });

    const res = index.searchScored('kubernetes deployment', 5, { graphExpand: true });
    const ids = res.map(r => r.entry.id);
    expect(ids).toContain('target');
    expect(ids).toContain('linked');
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('coactivation.enabled=false 时共激活边不生效（回退锚点边）', () => {
    const cfg = require('../../../src/config').config;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-off-'));
    const db = new GatewayDatabase(path.join(dir, 'test.db'));
    const { index, coact } = build(dir, db);
    index.addEntry(unit('target', 'kubernetes deployment rollout', 's1'), 'semantic');
    index.addEntry(unit('linked', 'incident postmortem notes', 's1'), 'semantic');
    coact.upsertUnit({ id: 'target', source_session_id: 's1', created_at: new Date().toISOString() });
    coact.upsertUnit({ id: 'linked', source_session_id: 's1', created_at: new Date().toISOString() });

    const prev = cfg.search.graph.coactivation.enabled;
    cfg.search.graph.coactivation.enabled = false;
    const res = index.searchScored('kubernetes deployment', 5, { graphExpand: true });
    expect(res.map(r => r.entry.id)).not.toContain('linked');
    cfg.search.graph.coactivation.enabled = prev;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
