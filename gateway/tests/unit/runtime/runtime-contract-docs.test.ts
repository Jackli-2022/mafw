import { readFileSync } from 'fs';
import { join } from 'path';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';
import { MAFW_RUNTIME_EVENT_NAMES } from '../../../src/runtime/mafw-vocabulary';

const CODE_REFS = new Set(['events.ts', 'events.make', 'events.check']);

describe('runtime plugin authoring docs', () => {
  const doc = readFileSync(join(__dirname, '..', '..', '..', '..', '.opencode', 'skills', 'runtime-plugin-authoring', 'SKILL.md'), 'utf-8');

  it('points authors at the coverage manifest', () => {
    expect(doc).toContain('覆盖清单（Coverage Manifest）');
    expect(doc).toContain('packages/gateway-sdk/contract/runtime-contract.json');
  });

  it('only references known contract surface ids (events/code refs exempt)', () => {
    const ids = new Set(buildRuntimeContractManifest().surfaces.map((s) => s.id));
    const events = new Set(MAFW_RUNTIME_EVENT_NAMES);
    const referenced = [...doc.matchAll(/`((?:plugin|session|branch|process|provider|prompt|events|tools|approval|identity|discovery|mcp|cognition|media|usage)\.[a-z0-9.]+)`/g)].map((m) => m[1]);
    const missing = [...new Set(referenced)].filter((id) => !ids.has(id) && !events.has(id) && !CODE_REFS.has(id));
    expect(missing).toEqual([]);
  });
});
