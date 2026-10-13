// auto 模式安全判定（纯函数）：只读/搜索类工具直接 safe；写类工具按危险正则
// 匹配命令文本；其余 safe。spec §6.1 —— 单一真相源，desktop/TUI 不再自判。
// 工具类别经 tool-classes.ts 并集单表（跨 runtime 名字归一，v2026-10-13）。
import { toolClassOf, isReadOnlyClass } from '../../runtime/tool-classes';

export interface ApprovalCandidate {
  toolName: string;
  patterns: string[];
  metadata?: { args?: unknown; risk?: string; [k: string]: unknown };
}

export type SafetyVerdict = 'safe' | 'dangerous';

/** 只读工具判定（read-only 档放行依据；导出供 policy-service 消费）。 */
export function isReadOnlyTool(toolName: string): boolean {
  return isReadOnlyClass(toolClassOf(toolName));
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

/** shell 工具 input 的命令文本 key 候选链（opencode/pi=command；防新 runtime 换 key 失明）。 */
const COMMAND_KEYS = ['command', 'cmd', 'script', 'text'];

export function commandTextOf(candidate: ApprovalCandidate): string {
  const args = candidate.metadata?.args;
  if (typeof args === 'string') return args;
  if (args && typeof args === 'object') {
    for (const k of COMMAND_KEYS) {
      const v = (args as any)[k];
      if (typeof v === 'string' && v) return v;
    }
  }
  return candidate.patterns.join(' ');
}

export function classifySafety(candidate: ApprovalCandidate): SafetyVerdict {
  if (isReadOnlyTool(candidate.toolName)) return 'safe';
  const text = commandTextOf(candidate);
  return DANGER_COMMAND_RE.some((re) => re.test(text)) ? 'dangerous' : 'safe';
}
