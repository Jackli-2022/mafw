// auto 模式安全判定（纯函数）：只读白名单直接 safe；写类工具按危险正则
// 匹配命令文本；其余 safe。spec §6.1 —— 单一真相源，desktop/TUI 不再自判。

export interface ApprovalCandidate {
  toolName: string;
  patterns: string[];
  metadata?: { args?: unknown; risk?: string; [k: string]: unknown };
}

export type SafetyVerdict = 'safe' | 'dangerous';

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob', 'ls', 'find']);

/** 只读工具判定（read-only 档放行依据；导出供 policy-service 消费）。 */
export function isReadOnlyTool(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(String(toolName).toLowerCase());
}

const DANGER_COMMAND_RE: RegExp[] = [
  /\brm\s+-[a-z]*[rf]/i,                       // rm -r / -f 任意组合
  /\bgit\s+push\s+.*(--force|-f)(\s|$)/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\b(drop|truncate)\s+(table|database)\b/i,
  /\bmkfs(\.|\b)/i,
  /:\(\)\s*\{\s*:\|\s*:&\s*\}\s*;:/,           // fork bomb
  /\b(shutdown|reboot|halt)\b/i,
  /\bdd\s+[^;]*of=\/dev\//i,
  /\bformat\s+[a-z]:/i,
];

export function commandTextOf(candidate: ApprovalCandidate): string {
  const args = candidate.metadata?.args;
  if (typeof args === 'string') return args;
  if (args && typeof args === 'object' && typeof (args as any).command === 'string') {
    return (args as any).command as string;
  }
  return candidate.patterns.join(' ');
}

export function classifySafety(candidate: ApprovalCandidate): SafetyVerdict {
  if (READ_ONLY_TOOLS.has(candidate.toolName.toLowerCase())) return 'safe';
  const text = commandTextOf(candidate);
  return DANGER_COMMAND_RE.some((re) => re.test(text)) ? 'dangerous' : 'safe';
}
