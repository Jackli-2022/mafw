import { Delta } from '../types/parametric';

/**
 * Build the prompt for the Plan Agent.
 * Library version - shared by skill entries and other consumers.
 */
export function buildPlanPrompt(options: {
  goal: string;
  lessons: any[];
  deltas: Delta[];
  handoff: { summary: string } | null;
  loopNum: number;
}): string {
  const { goal, lessons, deltas, handoff, loopNum } = options;

  let prompt = `# Plan Agent —Loop ${loopNum}\n\n`;
  prompt += `## Goal Charter\n\n${goal}\n\n`;

  if (handoff) {
    prompt += `## Handoff from Loop ${loopNum - 1}\n\n${handoff.summary}\n\n`;
  }

  if (lessons.length > 0) {
    prompt += `## Lessons Learned (L2)\n\n`;
    for (const lesson of lessons) {
      prompt += `- ${lesson}\n`;
    }
    prompt += '\n';
  }

  if (deltas.length > 0) {
    prompt += `## Parametric Constraints (L3)\n\n`;
    for (const delta of deltas) {
      if (delta.type === 'constraint') {
        prompt += `- ${delta.type}: ${(delta as any).rule}\n`;
      } else if (delta.type === 'prompt') {
        prompt += `- ${delta.type}: ${(delta as any).prompt_delta}\n`;
      } else if (delta.type === 'pattern') {
        prompt += `- ${delta.type}: ${(delta as any).pattern_template}\n`;
      }
    }
    prompt += '\n';
  }

  prompt += `## Instructions\n\n`;
  prompt += `Generate a detailed execution plan with waves and tasks.\n`;
  prompt += `Output format: JSON with "waves" and "tasks" arrays.\n`;
  prompt += `Each task must have: id, description, affected_files, acceptance_criteria.\n`;

  return prompt;
}
