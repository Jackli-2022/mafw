import {
  buildRecallInstructionsResponse,
  handleRecallInstructions,
} from '../../../src/routes/recall-instructions';
import { INSTRUCTION_KEYS, InstructionBlocks } from '../../../src/recall/instruction-blocks';

const blocks: InstructionBlocks = {
  memoryGuide: '<memory-guide>G</memory-guide>',
  userProfile: '<user-profile>P</user-profile>',
  agentPriors: '<agent-priors>A</agent-priors>',
  revision: 'r1',
};

describe('buildRecallInstructionsResponse', () => {
  it('managed true -> no blocks', () => {
    const r = buildRecallInstructionsResponse(blocks, { managed: true, missing: [], staleKeys: [] });
    expect(r).toMatchObject({ managed: true, missing: [], staleKeys: [], blocks: {} });
  });

  it('missing profile -> only the profile block', () => {
    const r = buildRecallInstructionsResponse(blocks, {
      managed: false,
      missing: [INSTRUCTION_KEYS.userProfile],
      staleKeys: [],
    });
    expect(r.blocks).toEqual({ userProfile: '<user-profile>P</user-profile>' });
    expect(r.missing).toEqual([INSTRUCTION_KEYS.userProfile]);
  });

  it('stale present -> managed true, staleKeys, no fallback blocks', () => {
    const r = buildRecallInstructionsResponse(blocks, {
      managed: true,
      missing: [],
      staleKeys: [INSTRUCTION_KEYS.userProfile],
    });
    expect(r.managed).toBe(true);
    expect(r.staleKeys).toEqual([INSTRUCTION_KEYS.userProfile]);
    expect(r.blocks).toEqual({});
  });

  it('no sync -> all non-null blocks', () => {
    const r = buildRecallInstructionsResponse(blocks, null);
    expect(r.managed).toBe(false);
    expect(r.blocks).toEqual({
      memoryGuide: '<memory-guide>G</memory-guide>',
      userProfile: '<user-profile>P</user-profile>',
      agentPriors: '<agent-priors>A</agent-priors>',
    });
  });

  it('a missing block with a render error is omitted', () => {
    const r = buildRecallInstructionsResponse(
      { ...blocks, userProfile: null, errors: { userProfile: 'disk' } },
      { managed: false, missing: [INSTRUCTION_KEYS.userProfile], staleKeys: [] },
    );
    expect(r.blocks).toEqual({});
  });
});

describe('handleRecallInstructions', () => {
  it('writes a JSON response and returns true for the route', async () => {
    const writes: string[] = [];
    const res: any = {
      writeHead: jest.fn(),
      end: jest.fn((body: string) => writes.push(body)),
    };
    const handled = await handleRecallInstructions(
      { method: 'GET' } as any,
      res,
      '/api/recall/instructions?sessionID=s1',
      {
        getBlocks: async () => blocks,
        getSync: () => ({
          inspect: async () => ({ managed: true, missing: [], staleKeys: [] }),
        }),
      },
    );
    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    expect(JSON.parse(writes[0])).toMatchObject({ managed: true, revision: 'r1', blocks: {} });
  });

  it('returns false for a non-matching path', async () => {
    const res: any = { writeHead: jest.fn(), end: jest.fn() };
    await expect(handleRecallInstructions({ method: 'GET' } as any, res, '/api/health', {
      getBlocks: async () => blocks,
      getSync: () => null,
    })).resolves.toBe(false);
  });
});
