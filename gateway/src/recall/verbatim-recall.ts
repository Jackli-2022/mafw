// V1 verbatim dense layer: pure helpers for t1 vector keys, hit grouping,
// excerpt extraction and pointer-line rendering. Zero I/O — the side-effecting
// search factory lives here too (Task 6) but everything in this file is
// fail-open and dependency-injected.
import { hashText } from './index-scan';

export interface T1Row { session_id: string; turn_id: number; source: string; content: string }
export interface T1Hit { sessionId: string; turnId: number; cosine: number; excerpt: string }

export function t1VectorKey(sessionId: string, turnId: number, content: string): string {
  return `${sessionId}:${turnId}:${hashText(content)}`;
}

export function parseT1Key(key: string): { sessionId: string; turnId: number } | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const turnId = Number(parts[1]);
  if (!Number.isInteger(turnId) || turnId < 0 || !parts[0] || !parts[2]) return null;
  return { sessionId: parts[0], turnId };
}

export function groupT1HitsToTurns(
  hits: Array<{ id: string; cosine: number }>,
  cap = 5,
): Array<{ sessionId: string; turnId: number; cosine: number }> {
  const best = new Map<string, { sessionId: string; turnId: number; cosine: number }>();
  for (const h of hits) {
    const parsed = parseT1Key(h.id);
    if (!parsed) continue;
    const k = `${parsed.sessionId}:${parsed.turnId}`;
    const prev = best.get(k);
    if (!prev || h.cosine > prev.cosine) {
      best.set(k, { sessionId: parsed.sessionId, turnId: parsed.turnId, cosine: h.cosine });
    }
  }
  return [...best.values()].sort((a, b) => b.cosine - a.cosine).slice(0, cap);
}

export function excerptFromRows(rows: T1Row[], key: string, maxChars: number): string {
  if (!rows.length) return '';
  const parsed = parseT1Key(key);
  const match = parsed
    ? rows.find(r => r.session_id === parsed.sessionId && r.turn_id === parsed.turnId && t1VectorKey(r.session_id, r.turn_id, r.content) === key)
    : undefined;
  const text = (match ?? rows[0]).content || '';
  return text.slice(0, maxChars);
}

export function renderT1Lines(hits: T1Hit[], opts: { k: number; maxChars: number }): string {
  const lines: string[] = [];
  let used = 0;
  for (const h of hits.slice(0, opts.k)) {
    if (!h.excerpt) continue;
    const tail = h.sessionId.slice(-6);
    const text = `[t1|${tail}:${h.turnId}] ${h.excerpt.replace(/\s+/g, ' ').trim()}`;
    const remaining = opts.maxChars - used;
    if (remaining <= 0) break;
    const line = text.length > remaining ? `${text.slice(0, Math.max(0, remaining - 1))}…` : text;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
