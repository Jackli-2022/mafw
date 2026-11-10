import { observationsToTranscript, TOOL_EXTRACTION_SYSTEM } from '../../../src/recall/turn-pipeline';

function obs(source: string, content: string, traceId?: string) {
  return { session_id: 's1', turn_id: 1, source, content, failure: 0, trace_id: traceId } as any;
}

describe('extraction transcript T1 provenance markers', () => {
  test('prefixes each observation with its permanent trace id', () => {
    const text = observationsToTranscript([
      obs('user_input', 'deploy failed', 't1t_a'),
      obs('tool_result', 'ECONNRESET', 't1t_a'),
    ]);
    expect(text).toContain('[trace:t1t_a][USER] deploy failed');
    expect(text).toContain('[trace:t1t_a][TOOL] ECONNRESET');
  });

  test('legacy rows without a trace id keep the old line shape', () => {
    const text = observationsToTranscript([obs('user_input', 'legacy row')]);
    expect(text).toContain('[USER] legacy row');
    expect(text).not.toContain('[trace:');
  });

  test('curator prompt asks for exact sourceTraceIds', () => {
    expect(TOOL_EXTRACTION_SYSTEM).toContain('sourceTraceIds');
    expect(TOOL_EXTRACTION_SYSTEM).toContain('[trace:');
  });
});
