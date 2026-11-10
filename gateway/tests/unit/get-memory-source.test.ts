import { handleGetMemory } from '../../src/mcp/handlers/get-memory';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function setup(withArchive: boolean, opts: { sourceTraceIds?: string[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getmem-src-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const now = new Date().toISOString();
  const unit: HarmonicUnit = {
    id: 'mem_1_abcdef',
    type: 'semantic',
    primary_abstraction: 'k8s note',
    cue_anchors: ['kubernetes'],
    memory_value: 'full value',
    energy: 0.8,
    created_at: now,
    updated_at: now,
    source_session_id: 's1',
    ...(opts.sourceTraceIds ? { source_trace_ids: opts.sourceTraceIds } : {}),
  } as HarmonicUnit;
  const store = new HarmonicUnitFileStore(dir, index);
  await store.write(unit);
  const services: any = { memory: { harmonicIndex: index }, mafwDir: dir };
  if (withArchive) {
    services.searchArchive = (_sid: string, _anchors: string[], _k: number) => ([
      { source: 'user_input', content: 'raw kubernetes question' },
    ] as any);
  }
  return { dir, services };
}

const trace = (id: string, content: string) => ({
  turn: { trace_id: id, session_id: 's1', turn_seq: 3, created_at: 1, archived_at: 2, encoding_salience: 0.5, legacy_ambiguous: 0 },
  rows: [{ session_id: 's1', turn_id: 3, trace_id: id, observation_key: `t1o_${id}`, source: 'user_input', content, failure: 0, created_at: 1 }],
  archived: true,
});

describe('handleGetMemory source reconstruction', () => {
  test('有 searchArchive 时附 source.evidence', async () => {
    const { dir, services } = await setup(true);
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.source.evidence).toContain('raw kubernetes question');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('无 searchArchive 时不附 source', async () => {
    const { dir, services } = await setup(false);
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    const body = JSON.parse(res.content[0].text);
    expect(body.source).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('exact source_trace_ids win over C0 and return trace pointers', async () => {
    const { dir, services } = await setup(true, { sourceTraceIds: ['t1t_a', 't1t_b'] });
    const searchArchive = jest.fn(() => {
      throw new Error('C0 must not run');
    });
    services.searchArchive = searchArchive;
    services.readTrace = (id: string) => (id === 't1t_a' ? trace(id, 'exact raw evidence A') : null);
    const propagate = jest.fn();
    services.propagateT1Activation = propagate;
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    const body = JSON.parse(res.content[0].text);
    expect(body.source.traces).toEqual([
      { traceId: 't1t_a', sessionId: 's1', turnId: 3, archived: true, excerpt: 'exact raw evidence A' },
    ]);
    expect(body.source.evidence).toBeUndefined();
    expect(searchArchive).not.toHaveBeenCalled();
    expect(propagate).toHaveBeenCalledWith(['t1t_a']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('legacy units do not propagate activation', async () => {
    const { dir, services } = await setup(true);
    const propagate = jest.fn();
    services.propagateT1Activation = propagate;
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    expect(JSON.parse(res.content[0].text).source.evidence).toContain('raw kubernetes question');
    expect(propagate).not.toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('propagation failure never fails the read', async () => {
    const { dir, services } = await setup(false, { sourceTraceIds: ['t1t_a'] });
    services.readTrace = (id: string) => trace(id, 'raw');
    services.propagateT1Activation = () => {
      throw new Error('state db down');
    };
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    expect(JSON.parse(res.content[0].text).success).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('unresolvable exact ids fall back to C0', async () => {
    const { dir, services } = await setup(true, { sourceTraceIds: ['t1t_missing'] });
    services.readTrace = () => null;
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    const body = JSON.parse(res.content[0].text);
    expect(body.source.traces).toBeUndefined();
    expect(body.source.evidence).toContain('raw kubernetes question');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
