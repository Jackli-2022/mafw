import { renderInstructionBlocks, MEMORY_GUIDE, INSTRUCTION_KEYS } from '../../../src/recall/instruction-blocks';

describe('renderInstructionBlocks', () => {
  it('renders guide + nulls when both sources are empty; revision is 64 hex', async () => {
    const r = await renderInstructionBlocks({
      getPinnedProfile: async () => null,
      getAgentPriors: async () => null,
    });
    expect(r.memoryGuide).toBe(MEMORY_GUIDE);
    expect(r.userProfile).toBeNull();
    expect(r.agentPriors).toBeNull();
    expect(r.errors).toBeUndefined();
    expect(r.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('renders blocks and revision changes when profile changes', async () => {
    const a = await renderInstructionBlocks({
      getPinnedProfile: async () => '<user-profile>A</user-profile>',
      getAgentPriors: async () => '<agent-priors>P</agent-priors>',
    });
    const b = await renderInstructionBlocks({
      getPinnedProfile: async () => '<user-profile>B</user-profile>',
      getAgentPriors: async () => '<agent-priors>P</agent-priors>',
    });
    expect(a.userProfile).toContain('A');
    expect(a.agentPriors).toContain('P');
    expect(a.revision).not.toBe(b.revision);
  });

  it('keeps the guide and records a per-block error when profile throws', async () => {
    const r = await renderInstructionBlocks({
      getPinnedProfile: async () => { throw new Error('disk'); },
      getAgentPriors: async () => '<agent-priors>P</agent-priors>',
    });
    expect(r.memoryGuide).toBe(MEMORY_GUIDE);
    expect(r.userProfile).toBeNull();
    expect(r.errors?.userProfile).toContain('disk');
    expect(r.agentPriors).toContain('P');
  });

  it('exports the three stable keys', () => {
    expect(INSTRUCTION_KEYS).toEqual({
      memoryGuide: 'mafw.memory-guide',
      userProfile: 'mafw.user-profile',
      agentPriors: 'mafw.agent-priors',
    });
  });
});
