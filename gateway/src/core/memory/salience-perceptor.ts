export function calculateSalience(text: string): number {
  if (!text) return 1.0;
  const HIGH = [/error|crash|fail|丢失|数据损坏|宕机|critical|emergency|严重/i];
  const LOW = [/info|success|完成|正常|debug|trace|verbose/i];
  if (HIGH.some(p => p.test(text))) return 1.5;
  if (LOW.some(p => p.test(text))) return 0.5;
  return 1.0;
}

/** Map an explicit importance score (1-10) to salience, bridging the regex
 *  three-tier scale (0.5 / 1.0 / 1.5). Out-of-range or missing → 1.0. */
export function importanceToSalience(importance: number | undefined): number {
  if (typeof importance !== 'number' || !Number.isFinite(importance)) return 1.0;
  if (importance < 1 || importance > 10) return 1.0;
  return 0.5 + ((importance - 1) / 9);
}
