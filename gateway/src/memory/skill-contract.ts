/**
 * Skill contract extraction (Skill v1 / 6A).
 *
 * A playbook is only promotable when it states when to use it, stable steps,
 * and its observed scope. Everything else (inputs/outputs/tools/permissions/
 * success/failure) is parsed when present and otherwise rendered as an
 * explicit "待补充" section for the human reviewer — never silently invented.
 */
export interface SkillContract {
  triggers: string[];
  negativeTriggers: string[];
  inputs: string[];
  outputs: string[];
  steps: string[];
  tools: string[];
  permissions: string[];
  successCriteria: string[];
  failureHandling: string[];
  scope: string[];
}

type Field = keyof SkillContract;

const FIELD_ALIASES: Record<Field, string[]> = {
  triggers: ['triggers', 'trigger', 'when to use', '触发', '触发词', '何时使用'],
  negativeTriggers: ['negative triggers', 'negative trigger', 'when not to use', 'do not use', '负向触发', '不适用'],
  inputs: ['inputs', 'input', '输入'],
  outputs: ['outputs', 'output', '输出'],
  steps: ['steps', 'step', 'procedure', 'playbook', '步骤', '流程'],
  tools: ['tools', 'tool', '工具'],
  permissions: ['permissions', 'permission', '权限'],
  successCriteria: ['success criteria', 'success', '成功判据', '验收标准'],
  failureHandling: ['failure handling', 'failure', '失败处理', '异常处理'],
  scope: ['scope', '适用范围', '适用场景'],
};

const ALIAS_TO_FIELD = new Map<string, Field>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<[Field, string[]]>) {
  for (const alias of aliases) ALIAS_TO_FIELD.set(alias.toLowerCase(), field);
}

function normLabel(label: string): string {
  return label
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/[:：]\s*$/, '')
    .trim()
    .toLowerCase();
}

function fieldForLabel(label: string): Field | null {
  return ALIAS_TO_FIELD.get(normLabel(label)) ?? null;
}

function pushUnique(out: string[], value: string, cap = 20): void {
  const v = value.trim();
  if (!v || out.includes(v) || out.length >= cap) return;
  out.push(v);
}

function splitValues(text: string): string[] {
  return text.split(/[，,、]/).map((s) => s.trim()).filter(Boolean);
}

export function extractSkillContract(unit: {
  memory_value: string;
  cue_anchors?: string[];
  source_session_id?: string;
}): SkillContract {
  const contract: SkillContract = {
    triggers: [],
    negativeTriggers: [],
    inputs: [],
    outputs: [],
    steps: [],
    tools: [],
    permissions: [],
    successCriteria: [],
    failureHandling: [],
    scope: [],
  };
  const body = unit.memory_value || '';
  const lines = body.split(/\r?\n/);
  const usedLines = new Set<number>();
  let current: Field | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const heading = /^#{1,6}\s+(.+)$/.exec(trimmed) ?? /^\*\*(.+?)\*\*:?\s*$/.exec(trimmed);
    if (heading) {
      current = fieldForLabel(heading[1]);
      if (current) usedLines.add(i);
      continue;
    }

    const inline = /^(?:[-*]\s*)?\*{0,2}([^:：]{1,40})\*{0,2}\s*[:：]\s*(.+)$/.exec(trimmed);
    if (inline) {
      const field = fieldForLabel(inline[1]);
      if (field) {
        usedLines.add(i);
        for (const v of splitValues(inline[2])) pushUnique(contract[field], v);
        current = field;
        continue;
      }
    }

    if (!current) continue;
    usedLines.add(i);
    const bullet = /^(?:[-*]|\d+[.)、])\s+(.+)$/.exec(trimmed);
    const value = bullet ? bullet[1] : trimmed;
    if (current === 'steps') pushUnique(contract.steps, value);
    else for (const v of splitValues(value)) pushUnique(contract[current], v);
  }

  // Steps fallback: numbered/imported bullet lines outside contract sections.
  if (contract.steps.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      if (usedLines.has(i)) continue;
      const m = /^\s*(?:\d+[.)、]|[-*])\s+(.+)$/.exec(lines[i]);
      if (m) pushUnique(contract.steps, m[1], 40);
    }
  }

  // Triggers/negative triggers fallback from cue anchors.
  const anchors = unit.cue_anchors ?? [];
  if (contract.triggers.length === 0) {
    for (const a of anchors) {
      if (typeof a !== 'string' || !a.trim() || a.includes(':')) continue;
      pushUnique(contract.triggers, a, 8);
    }
  }
  if (contract.negativeTriggers.length === 0) {
    for (const a of anchors) {
      if (typeof a !== 'string') continue;
      const m = /^(?:not|negative):(.+)$/.exec(a.trim());
      if (m) pushUnique(contract.negativeTriggers, m[1], 8);
    }
  }

  // Scope fallback: the session the memory was observed in.
  if (contract.scope.length === 0 && unit.source_session_id) {
    pushUnique(contract.scope, `session:${unit.source_session_id}`, 4);
  }

  return contract;
}

export function validateSkillContract(c: SkillContract): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!c.triggers || c.triggers.length === 0) errors.push('missing triggers');
  if (!c.steps || c.steps.length < 2) errors.push('missing stable steps (need >=2)');
  if (!c.scope || c.scope.length === 0) errors.push('missing scope');
  return { valid: errors.length === 0, errors };
}
