import { MANAGER_IDENTITY_SYSTEM_PROMPT } from '../../src/skills/manager-identity';

describe('MANAGER_IDENTITY_SYSTEM_PROMPT (wayfinding charter conventions)', () => {
  it('establishes the charter map sections: decisions index, fog, out of scope', () => {
    expect(MANAGER_IDENTITY_SYSTEM_PROMPT).toContain('Decisions so far');
    expect(MANAGER_IDENTITY_SYSTEM_PROMPT).toContain('Not yet specified');
    expect(MANAGER_IDENTITY_SYSTEM_PROMPT).toContain('Out of scope');
  });

  it('instructs decisions live in harmonic memory, charter/state only hold pointers', () => {
    expect(MANAGER_IDENTITY_SYSTEM_PROMPT).toMatch(/mafw_add_memory/);
    expect(MANAGER_IDENTITY_SYSTEM_PROMPT).toMatch(/指针/);
  });

  it('instructs refer-by-name over bare ids in human-facing lists', () => {
    expect(MANAGER_IDENTITY_SYSTEM_PROMPT).toMatch(/按名引用|标题/);
  });
});
