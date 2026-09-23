import { T1Observation } from '../memory/gateway-db';

/** Render archived turns as budgeted evidence lines (empty only when maxChars too small). */
export function reconstructSource(turns: T1Observation[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const t of turns) {
    if (used >= maxChars) break;
    const tag = t.source === 'user_input' ? 'USER'
      : t.source === 'reasoning' ? 'THINKING'
      : t.source === 'tool_result' ? 'TOOL' : 'ASSISTANT';
    const text = `[${tag}] ${(t.content || '').replace(/\s+/g, ' ').trim()}`;
    const remaining = maxChars - used;
    const line = text.length > remaining ? `${text.slice(0, Math.max(0, remaining - 1))}…` : text;
    lines.push(line);
    used += line.length + 1;
  }
  const out = lines.join('\n');
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}
