export interface Observation {
  type: 'observation';
  tool: string;
  args: string;
  output: string;
  timestamp: string;
  summary: string;
}

export interface CaptureResult {
  observation?: Observation;
}

export async function captureObservation(ctx: {
  toolName: string;
  output: string;
  args?: string;
}): Promise<CaptureResult> {
  const outputLength = ctx.output?.length || 0;
  const summary = outputLength > 200
    ? ctx.output.substring(0, 100) + '...' + ctx.output.substring(outputLength - 100)
    : ctx.output;

  console.log(`[hook:observation] ${ctx.toolName}: ${outputLength} chars`);

  return {
    observation: {
      type: 'observation',
      tool: ctx.toolName,
      args: ctx.args || '',
      output: ctx.output || '',
      timestamp: new Date().toISOString(),
      summary
    }
  };
}
