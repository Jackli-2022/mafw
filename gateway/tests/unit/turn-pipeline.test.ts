import { TurnPipeline, TOOL_EXTRACTION_SYSTEM } from '../../src/recall/turn-pipeline';

describe('TOOL_EXTRACTION_SYSTEM (propose–probe–commit)', () => {
  it('instructs the curator to verify candidate memories against the environment before writing', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toMatch(/verify/i);
    expect(TOOL_EXTRACTION_SYSTEM).toMatch(/read\/grep\/glob/);
  });

  it('bounds the probing budget per candidate memory', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toMatch(/at most 3|up to 3|≤\s*3/i);
  });

  it('distinguishes instance answers from reusable procedures', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toMatch(/reusable/i);
    expect(TOOL_EXTRACTION_SYSTEM).toMatch(/instance|incidental/i);
  });

  it('establishes the verified:YYYY-MM-DD cue anchor convention', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toContain('verified:YYYY-MM-DD');
  });

  it('treats environment evidence as authoritative over the transcript', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toMatch(/environment.*(wins|authoritative|contradict)|contradict.*environment/i);
  });

  it('warns that a passing grade does not validate intermediate assumptions', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toMatch(/grade|verdict|outcome/i);
  });
});

describe('TurnPipeline grade signal (D)', () => {
  function makePipeline(gradeFor?: (sessionID: string) => string | null) {
    const prompts: string[] = [];
    const fakeDb: any = {
      listTurns: () => [
        {
          session_id: 's1',
          turn_id: 1,
          count: 3,
          has_user_input: 1,
          response_count: 2,
          last_ts: Math.floor(Date.now() / 1000),
        },
      ],
      readTurn: () => [{ source: 'user_input', content: 'fix the flaky test' }],
      logNoop: () => {},
      archiveTurn: () => {},
    };
    const fakeIndex: any = { getIndex: () => ({ entries: [] }) };
    const worker: any = {
      prompt: async (message: string) => {
        prompts.push(message);
        return '[EXTRACTED: 0]';
      },
    };
    const pipeline = new TurnPipeline({
      t1db: fakeDb,
      index: fakeIndex,
      workerFor: () => worker,
      staleMs: 60000,
      ...(gradeFor ? { gradeFor } : {}),
    });
    return { pipeline, prompts };
  }

  it('appends the outcome-feedback block to the worker prompt when a grade exists', async () => {
    const { pipeline, prompts } = makePipeline(() => 'Goal 003-x verdict=FAILED (thumbs_down=2)');
    await pipeline.runOnce();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('verdict=FAILED');
    expect(prompts[0]).toMatch(/outcome|feedback/i);
  });

  it('omits the outcome-feedback block when no grade exists', async () => {
    const { pipeline, prompts } = makePipeline(() => null);
    await pipeline.runOnce();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain('verdict=');
  });

  it('works without a gradeFor dependency', async () => {
    const { pipeline, prompts } = makePipeline(undefined);
    await pipeline.runOnce();
    expect(prompts).toHaveLength(1);
  });
});
