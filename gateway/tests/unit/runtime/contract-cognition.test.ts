import { CONTRACT_COGNITION } from '../../../src/runtime/contract-cognition';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

const routePaths = buildRouteCatalog().map((r) => r.path);

function routeExists(token: string): boolean {
  const clean = token.replace(/\/\*$/, '/');
  return routePaths.some((p) => p === clean || p.startsWith(clean));
}

describe('contract cognition verbs', () => {
  it('every HTTP path resolves to a registered route', () => {
    for (const verb of CONTRACT_COGNITION) {
      const tokens = verb.path.split(/\s+/).filter((t) => t.startsWith('/'));
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect({ verb: verb.id, token, exists: routeExists(token) }).toMatchObject({
          verb: verb.id,
          token,
          exists: true,
        });
      }
    }
  });

  it('every verb has a positive timeout and a fail-open policy', () => {
    for (const verb of CONTRACT_COGNITION) {
      expect(verb.timeoutMs).toBeGreaterThan(0);
      expect(verb.failOpen.length).toBeGreaterThan(0);
    }
  });
});
