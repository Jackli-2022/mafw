import type { EventTriggerRow } from './event-types';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 把一条 decision.* 事件渲染成 Lead 会话里的普通消息。
 *
 * 事件层只负责投递「上下文」：Lead 可以据此主动告知用户，但确认 / 搁置仍是
 * human-only（Goal 详情或 human 路由），Lead 不得替用户拍板。
 */
export function renderLeadDecisionEvent(trigger: EventTriggerRow): string {
  if (!trigger.kind.startsWith('decision.')) return '';
  const payload = trigger.payload && typeof trigger.payload === 'object'
    ? trigger.payload as Record<string, unknown>
    : {};
  const recordId = text(payload.recordId) || trigger.externalId;
  const goalId = text(payload.goalId);
  const question = text(payload.question) || trigger.externalId;
  const rationale = text(payload.rationale) || text(payload.consequences);
  const options = Array.isArray(payload.options) ? payload.options : [];

  const lines = [
    '[LEAD EVENT] 决定待确认',
    `record: ${recordId}`,
    `goal: ${goalId || '-'}`,
    `问题：${question}`,
  ];

  if (options.length > 0) {
    lines.push('选项：');
    options.forEach((option, index) => {
      const row = option && typeof option === 'object' ? option as Record<string, unknown> : {};
      const title = text(row.title) || text(row.id) || `选项 ${index + 1}`;
      const summary = text(row.summary);
      const risks = Array.isArray(row.risks)
        ? row.risks.map((risk) => text(risk)).filter(Boolean)
        : [];
      lines.push(
        `${index + 1}. ${title}`
        + (summary ? ` — ${summary}` : '')
        + (risks.length > 0 ? `（风险：${risks.join('；')}）` : ''),
      );
    });
  }

  if (rationale) lines.push(`依据：${rationale}`);
  lines.push('请在 Goal 详情确认（人类专属）；不要替用户拍板。');
  return lines.join('\n');
}

/** 只有 decision.* 事件 + Lead context 订阅才走 Lead 上下文投递。 */
export function isLeadDecisionContext(input: {
  triggers: ReadonlyArray<{ kind: string }>;
  subscriptions: ReadonlyArray<{ subscriberType: string; mode: string }>;
}): boolean {
  return input.subscriptions.some(
    (subscription) => subscription.subscriberType === 'lead' && subscription.mode === 'context',
  ) && input.triggers.some((trigger) => trigger.kind.startsWith('decision.'));
}
