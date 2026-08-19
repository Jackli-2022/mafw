import { log } from '../utils/logger';
/**
 * Run Plan Tool —Prompt 鎷兼帴 + LLM 璋冪敤
 *
 * 鑱岃矗锛?
 *   1. 璇诲彇 Goal Charter銆丩essons銆丳arametric Deltas
 *   2. 鎷兼帴瀹屾暣 Plan Prompt
 *   3. 璋冪敤 LLM
 *   4. 瑙ｆ瀽鍥炲涓虹粨鏋勫寲 Plan
 *
 * 琚?mafw-plan/entry.ts 璋冪敤銆?
 */

import { Delta } from '../types/parametric';

export interface PlanContext {
  goal: string;
  lessons: string[];
  deltas: Delta[];
  handoff: any | null;
  loopNum: number;
}

export interface PlanResult {
  waves: any[];
  tasks: any[];
}

/**
 * 鎷兼帴 Plan Prompt
 */
export function buildPlanPrompt(context: PlanContext): string {
  const { goal, lessons, deltas, handoff, loopNum } = context;

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
        prompt += `- constraint: ${(delta as any).rule}\n`;
      } else if (delta.type === 'prompt') {
        prompt += `- prompt: ${(delta as any).prompt_delta}\n`;
      } else if (delta.type === 'pattern') {
        prompt += `- pattern: ${(delta as any).pattern_template}\n`;
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

/**
 * 瑙ｆ瀽 LLM 鍥炲涓?Plan
 */
export function parsePlanResponse(content: string): PlanResult {
  try {
    // 灏濊瘯鐩存帴瑙ｆ瀽 JSON
    return JSON.parse(content);
  } catch {
    // 灏濊瘯浠?markdown 浠ｇ爜鍧椾腑鎻愬彇
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    // fallback: 杩斿洖绌虹粨鏋?
    log.warn('[run-plan] Failed to parse LLM response, using fallback');
    return { waves: [], tasks: [] };
  }
}

/**
 * 鏍煎紡鍖?Task 涓?Markdown
 */
export function formatTaskMarkdown(task: any): string {
  return `# Task: ${task.id}\n\n${task.description}\n\n## Affected Files\n\n${(task.affected_files || []).map((f: string) => `- ${f}`).join('\n')}\n\n## Acceptance Criteria\n\n${(task.acceptance_criteria || []).map((c: string) => `- [ ] ${c}`).join('\n')}\n`;
}



