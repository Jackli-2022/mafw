// G5 (over-generalization guard, OEP/SAVOR) + G3 (confidence preservation,
// Manufactured Confidence): the distillation prompts are the only place where
// hedged/tentative wording can be upgraded into confident universal rules —
// the constraints must live in the prompts themselves.
import { REFLECT_SYSTEM, TENTATIVE_SYSTEM } from '../../../src/recall/reflection';
import { AXIOM_SYSTEM } from '../../../src/memory/axiom-distill';

describe('G5: reflection prompt anti-overgeneralization', () => {
  it('REFLECT_SYSTEM requires insights to stay scoped to observed contexts', () => {
    expect(REFLECT_SYSTEM).toMatch(/scope/i);
    expect(REFLECT_SYSTEM).toMatch(/single|one-off/i);
    expect(REFLECT_SYSTEM).toMatch(/universal/i);
  });

  it('AXIOM_SYSTEM forbids widening scope beyond source insights', () => {
    expect(AXIOM_SYSTEM).toMatch(/never widen scope/i);
    expect(AXIOM_SYSTEM).toMatch(/qualifier/i);
  });
});

describe('G3: confidence/evidence-level preservation', () => {
  it('REFLECT_SYSTEM requires preserving hedging language', () => {
    expect(REFLECT_SYSTEM).toMatch(/hedg/i);
    expect(REFLECT_SYSTEM).toMatch(/evidence level/i);
  });

  it('TENTATIVE_SYSTEM preserves tentative wording when validating', () => {
    expect(TENTATIVE_SYSTEM).toMatch(/hedg|tentative wording/i);
  });
});
