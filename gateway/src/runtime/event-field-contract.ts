/**
 * 事件字段契约 —— skill 文档 3.1 契约表的可执行版。
 *
 * 只做"缺字段会静默失效"的检查（消费方判 none / 无 step / 无 delta），
 * 不做类型白名单校验（那是 isKnownEventType 的职责）。返回 warnings 数组，
 * 空数组 = 无警告；供试衣间端点与 ctx.events.check 共用。
 */
import { isKnownEventType } from './event-telemetry';

type RawEvt = { type?: string; payload?: any; properties?: any; sessionID?: string };

const sidOf = (e: RawEvt): string | undefined =>
  e.properties?.sessionID || e.properties?.part?.sessionID || e.properties?.info?.sessionID ||
  e.payload?.properties?.sessionID || e.payload?.sessionID || e.sessionID;

export function checkEventFields(evt: RawEvt | null | undefined): string[] {
  if (!evt || typeof evt !== 'object') return ['event must be a non-empty object'];
  const type: string = evt.payload?.type || evt.type || '';
  const props: any = evt.payload?.properties || evt.properties || {};
  if (!type) return ["missing 'type' — events without type are dropped as malformed"];
  const warnings: string[] = [];

  if (!isKnownEventType(type)) {
    warnings.push(
      `unknown type '${type}' — desktop renders nothing for it; map to a canonical type ` +
      `(see @mafw/sdk RUNTIME_EVENT_TYPES) or use the 'plugin:<name>:<event>' namespace`,
    );
  }

  const sid = sidOf(evt);
  switch (type) {
    case 'turn.started':
    case 'turn.completed':
    case 'turn.failed':
    case 'turn.aborted':
    case 'session.compacting':
    case 'session.compacted':
      if (!sid) warnings.push(`'${type}' without sessionID — goal driver / compaction flush / trajectory turn aggregation will not trigger`);
      break;
    case 'part.delta':
      if (!props?.delta) warnings.push("part.delta without properties.delta — streaming render shows nothing");
      break;
    case 'part.complete':
      if (!props?.part) warnings.push('part.complete without properties.part — no completed part snapshot');
      break;
    case 'part.updated': {
      const part = props?.part;
      if (!part || typeof part !== 'object') {
        warnings.push("part.updated without properties.part — no step/delta/toolCommand extraction, desktop shows nothing");
        break;
      }
      if (!sid) warnings.push('part.updated without sessionID (part.sessionID or properties.sessionID)');
      if (part.type === 'text' && !part.text && !props?.delta) {
        warnings.push("text part without part.text or properties.delta — streaming render shows nothing");
      }
      if (part.type === 'tool' && !part.state?.input?.command && !part.state?.output && !part.state?.error) {
        warnings.push("tool part without state.input/output/error — tool card renders empty");
      }
      break;
    }
    case 'message.updated': {
      // Task 14：canonical 载荷只有 properties.message；旧 wire info 是违例
      // （升级前持久帧另经 event-log-migrate 一次性迁移，不在出口兼容）。
      const message = props?.message;
      if (!message) {
        warnings.push(
          props?.info
            ? 'message.updated carries legacy properties.info — canonical payload is properties.message'
            : 'message.updated without properties.message — no message skeleton on desktop, no step settlement',
        );
      } else if (!message.id) {
        warnings.push('message.updated without message.id — desktop cannot dedupe message skeleton');
      }
      break;
    }
    case 'session.created':
    case 'session.updated': {
      const info = props?.info;
      if (!info || !info.id) {
        warnings.push(`'${type}' without properties.info.id — desktop Rail planner yields 'none' (list will not sync)`);
      } else if (!info.title) {
        warnings.push(`'${type}' without info.title — desktop tab title stays stale`);
      }
      break;
    }
    case 'session.deleted':
      if (!sid) warnings.push('session.deleted without sessionID — desktop cannot remove it from the list');
      break;
    case 'permission.asked':
    case 'question.asked':
      if (!props?.requestId && !props?.id) warnings.push(`'${type}' without requestId — desktop cannot correlate the flow card`);
      if (type === 'permission.asked' && !props?.toolName && !props?.permission?.tool) {
        warnings.push('permission.asked without toolName — approval card shows generic label');
      }
      if (!sid) warnings.push(`'${type}' without sessionID — card cannot be attached to a session`);
      break;
    case 'background.job.updated': {
      // Task 3：job 快照是唯一载荷（id/source/status/sessionID 是消费方最低要求）
      const job = props?.job;
      if (!job || typeof job !== 'object') {
        warnings.push('background.job.updated without properties.job — background dock cannot update the row');
        break;
      }
      if (!job.id) warnings.push('background.job.updated without job.id — consumer cannot dedupe the row');
      if (!job.sessionID) warnings.push('background.job.updated without job.sessionID — row cannot be attached to a session');
      break;
    }
    case 'pod.event': {
      // 事件层：只有路由字段（完整事件由 pod.events.list 拉取）。
      if (!props?.podId || !props?.eventId || !props?.severity) {
        warnings.push('pod.event without podId/eventId/severity — desktop cannot refresh the inbox or trigger a presence poll');
      }
      break;
    }
    default:
      break;
  }
  return warnings;
}
