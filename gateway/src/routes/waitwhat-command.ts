// /waitwhat command (UI-driven, via /api/mafw-commands/run): the user signals
// "that last reply didn't land" and the agent re-pitches its own last message
// in simplified language, using the project's CONTEXT.md glossary when one
// exists. Inspired by mattpocock/skills wait-what (MIT).
//
// The re-pitch is prompted INTO THE SAME session so every connected client
// (desktop / TUI / opencode) sees the answer inline via the event stream.

export interface WaitwhatMessage {
  info?: { role?: string };
  parts?: Array<{ type?: string; text?: string }>;
}

export interface WaitwhatDeps {
  listMessages(sessionID: string): Promise<WaitwhatMessage[]>;
  promptAsync(sessionID: string, text: string): Promise<void>;
}

export interface WaitwhatResult {
  ok: boolean;
  error?: string;
}

export function buildWaitwhatPrompt(original: string): string {
  return [
    '[/waitwhat] 用户没看懂你上一条回复。请把它重述一遍：',
    '1. 先用一两句补上"我们在做什么、刚才说到哪"的上下文定位；',
    '2. 然后用简明语言重述：短句、一次一个概念、避免嵌套行话（STE100 简化技术英语的风格）；',
    '3. 如果项目根目录有 CONTEXT.md，先读它并用其中的项目术语（ubiquitous language）来表达；',
    '4. 只是重述，不要新增内容、不引入新话题。',
    '',
    '—— 需要重述的上一条回复原文 ——',
    original,
  ].join('\n');
}

/**
 * Re-pitch the last assistant message of the session. Returns ok:false with
 * an error string (without prompting) when there is nothing to re-pitch.
 */
export async function runWaitwhat(sessionID: string, deps: WaitwhatDeps): Promise<WaitwhatResult> {
  const messages = await deps.listMessages(sessionID);
  const lastAssistant = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((m) => m?.info?.role === 'assistant');
  const original = (lastAssistant?.parts || [])
    .filter((p) => p?.type === 'text' && typeof p?.text === 'string')
    .map((p) => p.text!)
    .join('\n')
    .trim();
  if (!original) {
    return { ok: false, error: 'no assistant message to re-pitch' };
  }
  await deps.promptAsync(sessionID, buildWaitwhatPrompt(original));
  return { ok: true };
}
