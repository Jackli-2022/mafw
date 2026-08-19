import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { L5Store, L5Axiom, L5Heuristic } from '../../gateway/src/core/memory/l5-store';

describe('L5Store', () => {
  const tmpDir = path.join(os.tmpdir(), 'mafw-l5-test-' + Date.now());
  const store = new L5Store(tmpDir);

  beforeEach(() => {
    // Clean test dir
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('loadAxioms returns empty array for fresh store', () => {
    const axioms = store.loadAxioms();
    expect(axioms).toEqual([]);
  });

  test('addAxiom persists and returns axiom with id', () => {
    const axiom = store.addAxiom('All payments must be idempotent', 'manual');
    expect(axiom.id).toBeTruthy();
    expect(axiom.content).toBe('All payments must be idempotent');
    expect(axiom.source).toBe('manual');
    expect(axiom.energy).toBe(0.8);
    const loaded = store.loadAxioms();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('All payments must be idempotent');
  });

  test('addHeuristic persists heuristic', () => {
    const h = store.addHeuristic('Deploy: build → migrate → smoke', ['deploy', 'migration'], ['goal_001']);
    expect(h.id).toBeTruthy();
    expect(h.pattern).toBe('Deploy: build → migrate → smoke');
    expect(h.success_rate).toBe(0.9);
    const loaded = store.loadHeuristics();
    expect(loaded).toHaveLength(1);
  });

  test('getTop returns topK axioms and heuristics by energy', () => {
    store.addAxiom('Low energy axiom', 'manual');
    store.addAxiom('High energy axiom', 'distilled');
    const highAxiom = store.addAxiom('Critical axiom', 'manual');
    // Manually bump energy by re-adding via internal file edit
    const axioms = store.loadAxioms();
    const target = axioms.find(a => a.content === 'Critical axiom')!;
    target.energy = 1.0;
    const axiomsPath = path.join(tmpDir, 'axioms.json');
    fs.writeFileSync(axiomsPath, JSON.stringify(axioms, null, 2));

    const top = store.getTop(2);
    expect(top.axioms).toHaveLength(2);
    expect(top.axioms[0].energy).toBeGreaterThanOrEqual(top.axioms[1].energy);
  });

  test('addAxiom with same content does not duplicate', () => {
    store.addAxiom('Unique axiom', 'manual');
    store.addAxiom('Unique axiom', 'manual');
    const axioms = store.loadAxioms();
    expect(axioms).toHaveLength(1);
  });
});
