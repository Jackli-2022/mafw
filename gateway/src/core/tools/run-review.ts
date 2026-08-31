/**
 * Build the prompt for the Review Agent.
 * Library version - shared by skill entries and other consumers.
 */
export function buildReviewPrompt(options: {
  receipts: any[];
  diff: string;
  metrics: Record<string, { target: number; unit: string }>;
  boundaries: string[];
  remoteResults: { success: boolean; output: string } | null;
  goal: string;
}): string {
  const { receipts, diff, metrics, boundaries, remoteResults, goal } = options;

  let prompt = `# Review Agent\n\n`;
  prompt += `## Goal Charter\n\n${goal}\n\n`;

  prompt += `## Execution Receipts\n\n`;
  for (const r of receipts) {
    prompt += `### Wave ${r.waveId || 'unknown'}\n\n`;
    prompt += `Status: ${r.status}\n`;
    if (r.tasks) {
      for (const t of r.tasks) {
        prompt += `- Task ${t.taskId}: ${t.status}\n`;
      }
    }
    prompt += '\n';
  }

  prompt += `## Code Changes\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;

  prompt += `## Metrics\n\n`;
  for (const [key, value] of Object.entries(metrics)) {
    prompt += `- ${key}: target ${value.target}${value.unit}\n`;
  }
  prompt += '\n';

  prompt += `## Boundaries\n\n`;
  for (const b of boundaries) {
    prompt += `- ${b}\n`;
  }
  prompt += '\n';

  if (remoteResults) {
    prompt += `## Remote Test Results\n\n`;
    prompt += `Success: ${remoteResults.success}\n`;
    prompt += `Output: ${remoteResults.output}\n\n`;
  }

  prompt += `## Instructions\n\n`;
  prompt += `Review the execution results against the goal charter, metrics, and boundaries.\n`;
  prompt += `Return a JSON with:\n`;
  prompt += `- verdict: "PASS" or "FAIL"\n`;
  prompt += `- reason: explanation\n`;
  prompt += `- metrics: actual metric values\n`;

  return prompt;
}
