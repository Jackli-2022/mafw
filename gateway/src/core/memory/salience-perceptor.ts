export function calculateSalience(text: string): number {
  if (!text) return 1.0;
  const HIGH = [/error|crash|fail|丢失|数据损坏|宕机|critical|emergency|严重/i];
  const LOW = [/info|success|完成|正常|debug|trace|verbose/i];
  if (HIGH.some(p => p.test(text))) return 1.5;
  if (LOW.some(p => p.test(text))) return 0.5;
  return 1.0;
}
