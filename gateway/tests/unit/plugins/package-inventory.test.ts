import { mergePackageInventory } from '../../../src/plugins/package-inventory';
import type { PackageState } from '../../../src/plugins/package-types';

function state(over: Partial<PackageState> & { name: string }): PackageState {
  return {
    name: over.name,
    source: over.source ?? `/plugins/${over.name}/index.js`,
    status: over.status ?? 'ok',
    contributions: over.contributions ?? ['ui'],
    ...over,
  };
}

describe('mergePackageInventory', () => {
  it('passes active rows through with revision and contribution kinds', () => {
    const rows = mergePackageInventory(
      [state({ name: 'acme', version: '1.0.0', revision: 'boot:4', fingerprint: 'fp-4' })],
      [],
    );
    expect(rows).toEqual([{
      name: 'acme',
      source: '/plugins/acme/index.js',
      status: 'ok',
      enabled: true,
      contributions: ['ui'],
      version: '1.0.0',
      revision: 'boot:4',
      fingerprint: 'fp-4',
    }]);
  });

  it('passes error rows through with the host diagnostic', () => {
    const rows = mergePackageInventory(
      [state({ name: 'broken', status: 'error', error: 'activate error: boom' })],
      [],
    );
    expect(rows[0]).toEqual(expect.objectContaining({
      name: 'broken',
      status: 'error',
      enabled: true,
      error: 'activate error: boom',
    }));
  });

  it('passes pending rows through with active and pending revisions', () => {
    const rows = mergePackageInventory(
      [state({ name: 'acme', revision: 'boot:3', pendingRevision: 'boot:4' })],
      [],
    );
    expect(rows[0]).toEqual(expect.objectContaining({
      status: 'ok',
      enabled: true,
      revision: 'boot:3',
      pendingRevision: 'boot:4',
    }));
  });

  it('lets a disabled name override an active row and drops contributions', () => {
    const rows = mergePackageInventory(
      [state({
        name: 'acme',
        revision: 'boot:4',
        pendingRevision: 'boot:5',
        error: 'stale diagnostic',
        contributions: ['ui', 'actions'],
      })],
      ['acme'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      name: 'acme',
      status: 'disabled',
      enabled: false,
      contributions: [],
      // The committed/pending tokens stay visible for diagnostics.
      revision: 'boot:4',
      pendingRevision: 'boot:5',
      error: 'stale diagnostic',
    }));
  });

  it('synthesizes disabled-only rows because host state omits them', () => {
    const rows = mergePackageInventory([], ['ghost']);
    expect(rows).toEqual([{
      name: 'ghost',
      source: '',
      status: 'disabled',
      enabled: false,
      contributions: [],
    }]);
  });

  it('sorts by package name across active, error, pending, and disabled rows', () => {
    const rows = mergePackageInventory(
      [
        state({ name: 'zeta', status: 'error', error: 'x' }),
        state({ name: 'beta', revision: 'boot:2' }),
        state({ name: 'alpha', pendingRevision: 'boot:3' }),
      ],
      ['zeta', 'gamma'],
    );
    expect(rows.map((row) => row.name)).toEqual(['alpha', 'beta', 'gamma', 'zeta']);
    expect(rows.map((row) => row.status)).toEqual(['ok', 'ok', 'disabled', 'disabled']);
  });

  it('does not mutate host state or its revision tokens', () => {
    const active = state({ name: 'acme', revision: 'boot:4', contributions: ['ui'] });
    const states = [active];
    mergePackageInventory(states, ['acme']);
    expect(active).toEqual(expect.objectContaining({
      name: 'acme',
      status: 'ok',
      revision: 'boot:4',
      contributions: ['ui'],
    }));
    expect(states).toHaveLength(1);
  });
});
