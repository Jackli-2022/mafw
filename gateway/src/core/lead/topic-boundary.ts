export type BoundaryTrigger = 'explicit' | 'semantic' | 'idle' | 'goal_closed' | 'keyword';

export interface BoundarySignal {
  text: string;
  previousUserText?: string;
  lastActiveAt?: string;
  now: string;
  goalActive: boolean;
  goalJustClosed?: boolean;
}

export interface BoundaryProposal {
  trigger: BoundaryTrigger;
  confidence: number;
  reason: string;
}

const EXPLICIT_RE = /换个话题|另外|先到这|换个方向|new topic/i;
const CLOSED_RE = /好了|完成了|结束|done/i;
const STOPWORDS = new Set(['the', 'is', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'with']);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.replace(/[\u3400-\u9fff]/g, ' ').split(/[\s,，。！？!?.;；:：、]+/)) {
    if (word.length >= 2 && !STOPWORDS.has(word)) out.add(word);
  }
  const cjk = lower.match(/[\u3400-\u9fff]+/g) ?? [];
  for (const run of cjk) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return out;
}

/**
 * Conservative boundary proposal. While a Goal is active we never propose;
 * semantic/keyword signals stay below the propose threshold on purpose.
 */
export function detectBoundary(signal: BoundarySignal): BoundaryProposal | null {
  if (signal.goalActive) return null;
  const text = signal.text.trim();
  if (!text) return null;

  if (signal.goalJustClosed && CLOSED_RE.test(text)) {
    return { trigger: 'goal_closed', confidence: 0.8, reason: '当前 Goal 已结束' };
  }
  if (EXPLICIT_RE.test(text)) {
    return { trigger: 'explicit', confidence: 0.9, reason: '检测到显式换话题措辞' };
  }
  if (signal.lastActiveAt) {
    const elapsed = Date.parse(signal.now) - Date.parse(signal.lastActiveAt);
    if (Number.isFinite(elapsed) && elapsed >= 30 * 60_000) {
      return { trigger: 'idle', confidence: 0.6, reason: '距离上一条消息超过 30 分钟' };
    }
  }
  if (signal.previousUserText) {
    const current = tokens(text);
    const previous = tokens(signal.previousUserText);
    if (current.size > 0 && previous.size > 0) {
      const overlap = [...current].filter((token) => previous.has(token)).length;
      const ratio = overlap / Math.min(current.size, previous.size);
      if (ratio < 0.2) {
        return { trigger: 'semantic', confidence: 0.4, reason: '与上一轮话题词重叠较低' };
      }
    }
  }
  return null;
}
