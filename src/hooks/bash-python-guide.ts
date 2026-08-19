import * as fs from 'fs';

/**
 * bash-python-guide — 温和引导：检测 bash 里的长 Python 内联脚本，提示改用
 * mafw_python（持久内核）。仅"计算型 + 较长"的脚本触发，每会话只提示一次，
 * 避免干扰。
 */

const GUIDE_NOTE =
  '[提示] 这是一段较长的 Python 计算脚本。此类计算建议改用 mafw_python 工具（会话持久内核：变量/导入跨调用保持，' +
  'matplotlib 可直接出图）。bash 适合跑项目脚本/CLI/单行命令。';

// 会话级去重
const notifiedSessions = new Set<string>();

const PY_INLINE_RE = /(?:^|[\n$>])\s*(?:python3?|py)\s+-c\s+['"]/;
const PY_HEREDOC_RE = /(?:^|[\n$>])\s*(?:python3?|py)\s+[^\n]*<<['"]?(?:EOF|PYTHON|PY)[\s\S]{200,}/;

function isComputational(code: string): boolean {
  const keywords = [
    'import numpy', 'import pandas', 'import matplotlib', 'import math', 'import statistics',
    'sum(', 'mean(', 'max(', 'min(', 'sorted(', 'for ', 'lambda ', 'def ', '.mean()', '.sum()',
    'range(', 'percent', 'average', 'median', 'std(', '计算', '统计', '均值',
  ];
  return keywords.some((k) => code.includes(k));
}

function messageText(msg: any): string {
  const parts = Array.isArray(msg?.parts) ? msg.parts : typeof msg?.content === 'string' ? [{ type: 'text', text: msg.content }] : [];
  return parts
    .filter((p: any) => (p?.type === 'text' || p?.type === 'tool') && typeof p.text === 'string')
    .map((p: any) => p.text)
    .join('\n');
}

export function pythonGuideHook(input: any, output: any): any {
  const sessionID = input?.sessionID || '';
  if (!sessionID || notifiedSessions.has(sessionID)) return output;
  const messages = output?.messages;
  if (!Array.isArray(messages)) return output;

  for (const msg of messages) {
    const isUser = msg?.role === 'user' || msg?.info?.role === 'user';
    const isTool = (msg?.info?.role === 'tool' || msg?.role === 'tool' || msg?.info?.role === 'assistant') && /bash|execute/i.test(String(msg?.info?.name || msg?.name || ''));
    if (!isUser && !isTool) continue;
    const text = messageText(msg);
    if (!text) continue;

    const matched = PY_INLINE_RE.test(text) || PY_HEREDOC_RE.test(text);
    if (!matched) continue;

    // 提取脚本片段做"计算型"判断（截取 python 命令后的内容）
    const afterCmd = text.replace(/.*(?:python3?|py)\s+-c\s+['"]([^'"]{0,3000})['"]?.*/s, '$1');
    const scriptSample = afterCmd.length > 30 ? afterCmd : text;
    if (!isComputational(scriptSample)) continue;

    notifiedSessions.add(sessionID);
    messages.push({
      role: 'user',
      parts: [{ type: 'text', text: GUIDE_NOTE, synthetic: true }],
    });
    break;
  }
  return output;
}

/** 测试辅助：重置会话去重。 */
export function _resetPythonGuideState(): void {
  notifiedSessions.clear();
}
