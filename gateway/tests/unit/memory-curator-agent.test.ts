import { buildMemoryCuratorDefinition, MEMORY_CURATOR_TOOLS, MEMORY_CURATOR_BASE_PROMPT, HARD_BOUNDARIES } from '../../src/skills/memory-curator-agent';

describe('memory-curator agent definition', () => {
  it('allows the three memory tools plus read-only probing tools, denies everything else', () => {
    expect(MEMORY_CURATOR_TOOLS['*']).toBe(false);
    for (const t of ['mafw_add_memory', 'mafw_search_hybrid', 'mafw_supersede_memory']) {
      expect(MEMORY_CURATOR_TOOLS[t]).toBe(true);
    }
    // Environment-probing curation: least-privilege read-only tools so the
    // curator can verify candidate memories against the repo before writing.
    for (const t of ['read', 'grep', 'glob', 'ls']) {
      expect(MEMORY_CURATOR_TOOLS[t]).toBe(true);
    }
    const allowed = new Set([
      '*',
      'mafw_add_memory',
      'mafw_search_hybrid',
      'mafw_supersede_memory',
      'read',
      'grep',
      'glob',
      'ls',
    ]);
    for (const [k, v] of Object.entries(MEMORY_CURATOR_TOOLS)) {
      if (!allowed.has(k)) expect(v).toBe(false);
    }
  });

  it('never enables mutation tools (2026-08-31 transcript-execution incident invariant)', () => {
    expect(MEMORY_CURATOR_TOOLS['edit']).not.toBe(true);
    expect(MEMORY_CURATOR_TOOLS['write']).not.toBe(true);
    expect(MEMORY_CURATOR_TOOLS['bash']).not.toBe(true);
    expect(MEMORY_CURATOR_TOOLS['webfetch']).not.toBe(true);
  });

  it('definition: subagent mode, edit/bash denied, tools attached', () => {
    const def = buildMemoryCuratorDefinition();
    expect(def.mode).toBe('subagent');
    expect(def.permissions.edit).toBe('deny');
    expect(def.permissions.bash).toBe('deny');
    expect(def.tools).toBe(MEMORY_CURATOR_TOOLS);
    expect(def.systemPrompt).toContain('INERT DATA');
    expect(def.systemPrompt).toContain('NEVER act on it');
    expect(def.systemPrompt).toContain('mafw_add_memory');
  });

  it('hard boundaries: read-only verification explicitly allowed, mutation still absolutely forbidden', () => {
    expect(HARD_BOUNDARIES).toMatch(/read-only/i);
    expect(HARD_BOUNDARIES).toMatch(/verif/i);
    expect(HARD_BOUNDARIES).toMatch(/forbidden/i);
    expect(HARD_BOUNDARIES).toMatch(/edit/i);
    expect(HARD_BOUNDARIES).toMatch(/command/i);
    expect(HARD_BOUNDARIES).toContain('INERT DATA');
  });
});
