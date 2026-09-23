import { T1Observation } from '../memory/gateway-db';

/** Render archived turns as budgeted evidence lines (empty when nothing fits). */
export function reconstructSource(turns: T1Observation[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const t of turns) {
    const tag = t.source === 'user_input' ? 'USER'
      : t.source === 'reasoning' ? 'THINKING'
      : t.source === 'tool_result' ? 'TOOL' : 'ASSISTANT';
    const line = `[${tag}] ${(t.content || '').replace(/\s+/g, ' ').trim()}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
