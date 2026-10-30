/**
 * 事件契约：从现有词汇/字段契约投影，不新增第四张并行表。
 *
 * - type：MAFW_RUNTIME_EVENT_NAMES
 * - family：按前缀派生
 * - requiredFields：与 event-field-contract.ts 的检查分支对齐
 * - consumers：desktop/tui/gateway 的稳定字符串（展示用）
 */
import { MAFW_RUNTIME_EVENT_NAMES } from './mafw-vocabulary';
import type { ContractEvent, EventFamily } from './contract-manifest-types';

const TERMINAL = new Set(['turn.completed', 'turn.failed', 'turn.aborted']);

const GATEWAY_PRODUCED = new Set([
  'usage.updated', 'queue.updated', 'session.config', 'session.checkpoint', 'run.updated',
  'task.updated', 'pod.updated', 'trajectory.event', 'trajectory.turn', 'permission_mode', 'session.commands',
]);

function familyOf(type: string): EventFamily {
  if (type.startsWith('turn.')) return 'lifecycle';
  if (type === 'session.compacting' || type === 'session.compacted') return 'compaction';
  if (type === 'session.created' || type === 'session.updated' || type === 'session.deleted') return 'lifecycle';
  if (type.startsWith('message.') || type.startsWith('part.')) return 'message';
  if (type.startsWith('permission')) return 'approval';
  if (type.startsWith('question.')) return 'question';
  if (type.startsWith('usage.')) return 'usage';
  return 'state';
}

function requiredFieldsOf(type: string): string[] {
  switch (type) {
    case 'turn.started':
    case 'turn.completed':
    case 'turn.failed':
    case 'turn.aborted':
    case 'session.compacting':
    case 'session.compacted':
    case 'session.deleted':
      return ['sessionID'];
    case 'part.updated':
    case 'part.complete':
      return ['part'];
    case 'part.delta':
      return ['delta'];
    case 'message.updated':
      return ['message'];
    case 'session.created':
    case 'session.updated':
      return ['info.id'];
    case 'permission.asked':
    case 'question.asked':
      return ['requestId', 'sessionID'];
    default:
      return [];
  }
}

function consumersOf(type: string): string[] {
  if (type.startsWith('turn.')) return ['goal driver', 'memory drain', 'desktop', 'tui'];
  if (type.startsWith('part.') || type.startsWith('message.')) return ['desktop', 'tui', 'trajectory'];
  if (type.startsWith('permission') || type.startsWith('question.')) return ['desktop', 'tui'];
  if (type.startsWith('usage.')) return ['UsageDock'];
  if (type.startsWith('trajectory.')) return ['desktop'];
  return ['desktop'];
}

function conformanceOf(type: string): string[] | undefined {
  if (type === 'turn.completed' || type === 'turn.failed' || type === 'turn.aborted') return ['chat-roundtrip'];
  if (type === 'part.updated' || type === 'part.delta') return ['chat-roundtrip'];
  if (type === 'permission.asked' || type === 'question.asked') return ['chat-roundtrip'];
  return undefined;
}

export function buildEventsSection(): ContractEvent[] {
  return MAFW_RUNTIME_EVENT_NAMES.map((type) => ({
    type,
    family: familyOf(type),
    ...(TERMINAL.has(type) ? { terminal: true } : {}),
    requiredFields: requiredFieldsOf(type),
    producers: GATEWAY_PRODUCED.has(type) ? ['gateway'] : ['runtime'],
    consumers: consumersOf(type),
    ...(conformanceOf(type) ? { conformance: conformanceOf(type) } : {}),
  }));
}

export const CONTRACT_EVENTS: ContractEvent[] = buildEventsSection();
