import { readFileSync } from 'fs';
import { join } from 'path';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { MAFW_RUNTIME_EVENT_NAMES } from '../../../src/runtime/mafw-vocabulary';

const GUIDE = join(__dirname, '..', '..', '..', '..', 'docs', 'guides', 'runtime-plugin-authoring.md');
const CODE_REFS = new Set(['events.ts', 'events.make', 'events.check']);

describe('runtime plugin agent guide', () => {
  const doc = readFileSync(GUIDE, 'utf-8');

  it('points at the machine-readable contract and coverage endpoint', () => {
    expect(doc).toContain('packages/gateway-sdk/contract/runtime-contract.json');
    expect(doc).toContain('GET /api/runtime/contract');
    expect(doc).toContain('active.coverage');
  });

  it('uses the four preset ids', () => {
    for (const id of ['core', 'conversation', 'autonomous', 'desktop']) {
      expect(doc).toContain(id);
    }
  });

  it('only references known contract surface ids (events/code refs exempt)', () => {
    const ids = new Set(buildRuntimeContractManifest().surfaces.map((s) => s.id));
    const events = new Set(MAFW_RUNTIME_EVENT_NAMES);
    const referenced = [...doc.matchAll(/`((?:plugin|session|branch|process|provider|prompt|events|tools|approval|identity|discovery|mcp|cognition|media|usage)\.[a-z0-9.]+)`/g)].map((m) => m[1]);
    const missing = [...new Set(referenced)].filter((id) => !ids.has(id) && !events.has(id) && !CODE_REFS.has(id));
    expect(missing).toEqual([]);
  });
});
