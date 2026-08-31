import { buildMemoryCuratorDefinition, MEMORY_CURATOR_TOOLS, MEMORY_CURATOR_BASE_PROMPT } from '../../src/skills/memory-curator-agent';

describe('memory-curator agent definition', () => {
  it('denies every tool except the three memory tools', () => {
    expect(MEMORY_CURATOR_TOOLS['*']).toBe(false);
    expect(MEMORY_CURATOR_TOOLS['mafw_add_memory']).toBe(true);
    expect(MEMORY_CURATOR_TOOLS['mafw_search_hybrid']).toBe(true);
    expect(MEMORY_CURATOR_TOOLS['mafw_supersede_memory']).toBe(true);
    const others = Object.entries(MEMORY_CURATOR_TOOLS).filter(([k]) => !k.startsWith('mafw_'));
    expect(others.every(([, v]) => v === false)).toBe(true);
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
});
