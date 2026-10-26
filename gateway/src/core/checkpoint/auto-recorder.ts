/**
 * T2-1 auto-recorder —— turn.completed 后「这一刻的检查点」纯规划函数。
 *
 * 语义对齐 B3（已发布行为）：checkpoint =「回到发送 user_N 的时刻」。
 * - anchor = 本回合 user 消息（历史保留到它为止）
 * - tree   = 本回合**第一条**带有效 snapshot.start 的 assistant 的 start
 *            （pre-turn 树；多 step 回合不能用末条 end）
 *
 * immediate-delivery / queue flush 下下一个 user 可能已持久化——所以定位
 * 以「末尾最后一条 assistant」为基准反向找 user，而不是「最后一条 user」。
 */
import { createdOf, isSnapshotId, roleOf, unwrapMessage } from '../diff/turn-diff';

function normalize(messages: any[]): any[] {
  return (Array.isArray(messages) ? messages : [])
    .map(unwrapMessage)
    .filter((m) => m && typeof m === 'object')
    .map((m, index) => ({ m, index }))
    .sort((x, y) => createdOf(x.m) - createdOf(y.m) || x.index - y.index)
    .map((x) => x.m);
}

export interface AutoCheckpointPlan {
  anchorMessageID: string;
  snapshotTree: string | null;
}

export function planAutoCheckpoint(messages: any[]): AutoCheckpointPlan | null {
  const norm = normalize(messages);

  let lastAssistant = -1;
  for (let i = norm.length - 1; i >= 0; i--) {
    if (roleOf(norm[i]) === 'assistant') { lastAssistant = i; break; }
  }
  if (lastAssistant < 0) return null;

  let userIdx = -1;
  for (let i = lastAssistant - 1; i >= 0; i--) {
    if (roleOf(norm[i]) === 'user') { userIdx = i; break; }
  }
  if (userIdx < 0) return null;

  const anchor = norm[userIdx]?.id;
  if (typeof anchor !== 'string' || !anchor) return null;

  let snapshotTree: string | null = null;
  for (let i = userIdx + 1; i <= lastAssistant; i++) {
    if (roleOf(norm[i]) !== 'assistant') continue;
    const start = norm[i]?.snapshot?.start;
    if (isSnapshotId(start)) { snapshotTree = start; break; }
  }

  return { anchorMessageID: anchor, snapshotTree };
}

/** 最后一条带有效 snapshot.end 的 assistant 的 end（当前工作区树）。 */
export function latestSnapshotTree(messages: any[]): string | null {
  const norm = normalize(messages);
  for (let i = norm.length - 1; i >= 0; i--) {
    if (roleOf(norm[i]) !== 'assistant') continue;
    const end = norm[i]?.snapshot?.end;
    if (isSnapshotId(end)) return end;
  }
  return null;
}

/** 手动检查点锚点：显式 id（若在窗口内）否则最后一条已持久化消息。 */
export function manualAnchor(
  messages: any[],
  explicit?: string,
): { anchorMessageID: string } | null {
  const norm = normalize(messages);
  if (typeof explicit === 'string' && explicit && norm.some((m) => m?.id === explicit)) {
    return { anchorMessageID: explicit };
  }
  for (let i = norm.length - 1; i >= 0; i--) {
    const id = norm[i]?.id;
    if (typeof id === 'string' && id) return { anchorMessageID: id };
  }
  return null;
}

/** `git status --porcelain` → untracked 路径清单（仅 `?? ` 行；保留 git 的引号形态）。 */
export function parseUntrackedLines(porcelain: string): string[] {
  const out: string[] = [];
  for (const line of String(porcelain ?? '').split(/\r?\n/)) {
    if (!line || !line.startsWith('?? ')) continue;
    const path = line.slice(3).trim();
    if (path) out.push(path);
  }
  return out;
}
