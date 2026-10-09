// A5 schema write-back: atomic members carry distilled_by pointers to the
// gist units distilled from them (Bartlett schema organization). NOT a
// supersede chain — members stay live; stamping bypasses the MinHash write
// pipeline (direct OKF rewrite, mirroring setPinned/setSticky).
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { formatRecallContext } from '../../../src/recall/inject-format';
import { ReflectionPipeline } from '../../../src/recall/reflection';

function makeStore(): { store: HarmonicUnitFileStore; index: HarmonicIndexManager; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a5-wb-'));
  const index = new HarmonicIndexManager(dir);
  const store = new HarmonicUnitFileStore(dir, index);
  return { store, index, dir };
}

async function writeEpisode(store: HarmonicUnitFileStore, id: string, text: string): Promise<string> {
  await store.write({
    id, type: 'episodic', primary_abstraction: text.slice(0, 40), cue_anchors: ['a5'],
    memory_value: text, energy: 0.8, created_at: '2026-10-09', updated_at: '2026-10-09',
  } as any);
  return id;
}

describe('A5 stampDistilled', () => {
  it('stamps members with the gist id (append, dedupe, cap 3) and syncs the index entry', async () => {
    const { store, index } = makeStore();
    await writeEpisode(store, 'ep1', 'observed llamacpp OOM once');
    const stamped = store.stampDistilled(['ep1'], 'gist1');
    expect(stamped).toBe(1);
    expect((await store.read('ep1') as any).distilled_by).toEqual(['gist1']);
    // entry synced
    const entry: any = index.getIndex().entries.find((e) => e.id === 'ep1');
    expect(entry.distilled_by).toEqual(['gist1']);

    // dedupe + cap
    store.stampDistilled(['ep1'], 'gist1');
    store.stampDistilled(['ep1'], 'g2');
    store.stampDistilled(['ep1'], 'g3');
    store.stampDistilled(['ep1'], 'g4');
    const unit: any = await store.read('ep1');
    expect(unit.distilled_by).toHaveLength(3);
    expect(unit.distilled_by).toContain('gist1');
    expect(unit.distilled_by).not.toContain('g4'); // cap 3 keeps the first three
  });

  it('unknown ids are skipped (fail-open), returns the actual count', () => {
    const { store } = makeStore();
    expect(store.stampDistilled(['ghost'], 'g')).toBe(0);
  });

  it('stamping does NOT trigger the MinHash merge pipeline (member stays intact)', async () => {
    const { store, index } = makeStore();
    // distinct texts — no write-time MinHash merge between the two episodes
    await writeEpisode(store, 'epA', 'llamacpp sidecar flags research note');
    await writeEpisode(store, 'epB', 'gateway watchdog restart semantics note');
    const before = index.getIndex().entries.length;
    const supersededBefore = (index.getIndex().entries.find((e) => e.id === 'epA') as any).superseded_by;
    store.stampDistilled(['epA'], 'gistX');
    const after = index.getIndex().entries.length;
    expect(after).toBe(before); // no merge/supersede happened from the stamp
    const a: any = await store.read('epA');
    expect(a.superseded_by).toBe(supersededBefore); // untouched
    expect(a.merged_from ?? undefined).toBeUndefined();
    expect(a.memory_value).toBe('llamacpp sidecar flags research note'); // content untouched
    expect(a.distilled_by).toEqual(['gistX']);
  });

  it('coexists with D1b demotion (energy lowered, pointer stamped, both visible)', async () => {
    const { store, index } = makeStore();
    await writeEpisode(store, 'epC', 'jest does not typecheck index.ts');
    const before: any = index.getIndex().entries.find((e) => e.id === 'epC');
    const e0 = before.energy;
    // simulate the same pass: demote + stamp
    index.updateEnergy('epC', -(e0 * 0.3));
    store.stampDistilled(['epC'], 'gistZ');
    const entry: any = index.getIndex().entries.find((e) => e.id === 'epC');
    expect(entry.energy).toBeCloseTo(e0 * 0.7, 5);
    expect(entry.distilled_by).toEqual(['gistZ']);
  });
});

describe('A5 read-side hint (boundary recall pointer line)', () => {
  it('a hit carrying distilled_by renders a gist hint on the pointer line', () => {
    const { pointers } = formatRecallContext(
      [
        {
          id: 'mem_1791557_abcbde', primary_abstraction: 'llamacpp OOM observed', memory_value: 'long text',
          energy: 0.5, score: 0.9, type: 'episodic', created_at: 'x',
          distilled_by: ['mem_1791557_abc123'],
        } as any,
        { id: 'mem_2', primary_abstraction: 'plain', memory_value: 'v', energy: 0.5, score: 0.8, type: 'semantic', created_at: 'x' } as any,
      ],
      {},
    );
    expect(pointers).toContain('gist');
    expect(pointers).toContain('abc123'); // tail-6 of the gist id
    // exactly one hint line — the plain entry carries none
    expect(pointers!.match(/↳ gist/g)?.length).toBe(1);
  });
});

describe('A5 reflection integration (distill → stamp)', () => {
  it('reflectSession stamps source episodes with the distilled gist id', async () => {
    const { store, index, dir } = makeStore();
    // episode bound to a session so unreflectedBySession picks it up
    await store.write({
      id: 'ep9', type: 'episodic', primary_abstraction: 'laya calibration transcript', cue_anchors: ['laya'],
      memory_value: 'calibrating laya thresholds needs real pairs jsonl', energy: 0.8,
      created_at: '2026-10-09', updated_at: '2026-10-09', source_session_id: 'sess-1',
    } as any);

    const worker = {
      prompt: async () => JSON.stringify({
        insights: [{ category: 'insight', content: 'laya thresholds need real pairs jsonl before opening gates', cue_anchors: ['laya'] }],
      }),
    };
    const cursor = {
      isReflected: () => false,
      markReflected: () => {},
      prune: () => {},
    };
    const pipeline = new ReflectionPipeline({
      index, baseDir: dir, workerFor: () => worker as any, cursor: cursor as any,
    });
    const res = await pipeline.runSession('sess-1');
    expect(res.distilled).toBeGreaterThan(0);

    const unit: any = await store.read('ep9');
    expect(Array.isArray(unit.distilled_by)).toBe(true);
    expect(unit.distilled_by.length).toBeGreaterThan(0);
  });
});
