/**
 * T2-2 续跑简报（纯函数）。
 *
 * 暂停语义：abort 后从消息窗口抽取「暂停点」快照——最后一条真实 user 请求、
 * 最后一条 assistant 文本尾、锚点消息 id、队列项数。续跑提示由服务端合成，
 * 用户消息前缀 [MAFW 续跑] 用于在后续暂停时跳过合成消息（防止简报自引用）。
 */
import { createdOf, roleOf } from '../diff/turn-diff';

export const RESUME_PREFIX = '[MAFW 续跑]';

export interface ResumeBrief {
  lastUserText: string;
  lastAssistantTail: string;
  anchorMessageID: string;
  queuedCount: number;
}

const USER_MAX = 600;
const ASSISTANT_MAX = 1200;

function partsOf(message: any): any[] {
  return Array.isArray(message?.parts) ? message.parts : [];
}

function textOf(message: any): string {
  return partsOf(message)
    .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
    .map((p: any) => p.text as string)
    .join('\n')
    .trim();
}

function normalize(messages: any[]): any[] {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      // 兼容两种形态：{info, parts} 信封（session.messages）与裸消息。
      const info = item.info && typeof item.info === 'object' ? item.info : item;
      const parts = Array.isArray(item.parts)
        ? item.parts
        : Array.isArray(info.parts) ? info.parts : [];
      return { m: { ...info, parts }, index };
    })
    .sort((x, y) => createdOf(x.m) - createdOf(y.m) || x.index - y.index)
    .map((x) => x.m);
}

/** 没有真实 user 消息（或全部是合成续跑提示）→ null。 */
export function buildResumeBrief(messages: any[], queuedCount: number): ResumeBrief | null {
  const norm = normalize(messages);

  let lastUser: any = null;
  for (let i = norm.length - 1; i >= 0; i--) {
    if (roleOf(norm[i]) !== 'user') continue;
    const text = textOf(norm[i]);
    if (!text || text.startsWith(RESUME_PREFIX)) continue;
    lastUser = norm[i];
    break;
  }
  if (!lastUser) return null;

  let lastAssistantTail = '';
  for (let i = norm.length - 1; i >= 0; i--) {
    if (roleOf(norm[i]) !== 'assistant') continue;
    const text = textOf(norm[i]);
    if (text) { lastAssistantTail = text.slice(-ASSISTANT_MAX); break; }
  }

  return {
    lastUserText: textOf(lastUser).slice(0, USER_MAX),
    lastAssistantTail,
    anchorMessageID: String(lastUser.id),
    queuedCount: Number.isFinite(queuedCount) ? queuedCount : 0,
  };
}

/** 恢复时发送的合成续跑提示（普通 user 消息；可审计，brief 构建会跳过）。 */
export function composeResumePrompt(brief: ResumeBrief): string {
  const lines = [
    `${RESUME_PREFIX} 你在上一回合被用户暂停，现在恢复继续。`,
    '',
    `暂停前用户请求（截断）：${brief.lastUserText}`,
  ];
  if (brief.lastAssistantTail) {
    lines.push('', `暂停前你的最后输出（截断）：${brief.lastAssistantTail}`);
  }
  lines.push(
    '',
    '请从断点继续完成任务；不要重复已完成的步骤；已产生的工具结果保留在历史中。',
    '如上下文不足，先简要说明你的判断，再继续。',
  );
  return lines.join('\n');
}
