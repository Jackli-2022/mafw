// gateway/src/core/goal/goal-eval.ts
// GoalEval 的纯类型与校验层（spec §7.1 / §7.2）。
//
// 不变量：
// - GoalEval 是独立于实现的产品级验收契约，和 waves 计划同属一个 PlanPackage；
// - 每条条件必须写清「要什么证据」与「怎么验」（evidence / method 非空）；
// - 条件 id 唯一，mapping 只能引用真实存在的条件 id；
// - 至少一条 `required` 条件——否则 Reviewer 在无要求时也能 PASS（spec §7.2）。
//
// 这里只做纯数据校验，不读写文件、不调用 LLM。

export interface GoalEvalCondition {
  id: string;
  statement: string;
  required: boolean;
  evidence: string;
  method: string;
}

/** 条件 → 验证载体（waves task / Spike probe / artifact）的映射。 */
export interface GoalEvalMappingEntry {
  tasks?: string[];
  probes?: string[];
  artifacts?: string[];
}

export interface GoalEval {
  outcome: string;
  conditions: GoalEvalCondition[];
  failureConditions: string[];
  constraints: string[];
  nonGoals: string[];
  mapping: Record<string, GoalEvalMappingEntry>;
}

const MAPPING_FIELDS = ['tasks', 'probes', 'artifacts'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown, field: string, context?: string): string[] {
  const message = `goal eval ${field} must be an array of strings${context ? `: ${context}` : ''}`;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(message);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(message);
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeCondition(raw: unknown): GoalEvalCondition {
  if (!isPlainObject(raw)) throw new Error('goal eval condition must be an object');
  const id = clean(raw.id);
  if (!id) throw new Error('goal eval condition id is required');
  const statement = clean(raw.statement);
  if (!statement) throw new Error(`goal eval condition statement is required: ${id}`);
  if (typeof raw.required !== 'boolean') {
    throw new Error(`goal eval condition required must be boolean: ${id}`);
  }
  const evidence = clean(raw.evidence);
  if (!evidence) throw new Error(`goal eval condition evidence is required: ${id}`);
  const method = clean(raw.method);
  if (!method) throw new Error(`goal eval condition method is required: ${id}`);
  return { id, statement, required: raw.required, evidence, method };
}

function normalizeMapping(
  raw: unknown,
  conditionIds: readonly string[],
): Record<string, GoalEvalMappingEntry> {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) throw new Error('goal eval mapping must be an object');
  const known = new Set(conditionIds);
  // 按条件顺序重建，保证同一输入永远同一键顺序（对 hash 也稳定）。
  const mapping: Record<string, GoalEvalMappingEntry> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) throw new Error(`goal eval mapping references unknown condition: ${key}`);
    if (!isPlainObject(value)) throw new Error(`goal eval mapping entry must be an object: ${key}`);
    const entry: GoalEvalMappingEntry = {};
    for (const field of MAPPING_FIELDS) {
      if (value[field] === undefined || value[field] === null) continue;
      const items = stringList(value[field], `mapping ${field}`, key);
      if (items.length === 0) continue;
      entry[field] = items;
    }
    mapping[key] = entry;
  }
  const ordered: Record<string, GoalEvalMappingEntry> = {};
  for (const id of conditionIds) {
    const entry = mapping[id];
    if (entry) ordered[id] = entry;
  }
  return ordered;
}

/**
 * 校验并规范化 GoalEval（非法输入抛错，合法输入返回新对象，绝不改入参）。
 * 既用于计划产出时的把关，也用于读取既有产物时的容错入口（调用方自行 try/catch）。
 */
export function validateGoalEval(input: unknown): GoalEval {
  if (!isPlainObject(input)) throw new Error('goal eval must be an object');

  const outcome = clean(input.outcome);
  if (!outcome) throw new Error('goal eval requires an outcome');

  const rawConditions = input.conditions;
  if (!Array.isArray(rawConditions) || rawConditions.length === 0) {
    throw new Error('goal eval requires at least one condition');
  }
  const conditions: GoalEvalCondition[] = [];
  const seen = new Set<string>();
  rawConditions.forEach((raw) => {
    const condition = normalizeCondition(raw);
    if (seen.has(condition.id)) throw new Error(`duplicate goal eval condition id: ${condition.id}`);
    seen.add(condition.id);
    conditions.push(condition);
  });
  if (!conditions.some((condition) => condition.required)) {
    throw new Error('goal eval requires at least one required condition');
  }

  return {
    outcome,
    conditions,
    failureConditions: stringList(input.failureConditions, 'failureConditions'),
    constraints: stringList(input.constraints, 'constraints'),
    nonGoals: stringList(input.nonGoals, 'nonGoals'),
    mapping: normalizeMapping(input.mapping, conditions.map((condition) => condition.id)),
  };
}

/** 必达条件的 id（Reviewer rubric 的覆盖下限，Task 8 消费）。 */
export function requiredConditionIds(evalInput: GoalEval): string[] {
  return evalInput.conditions.filter((condition) => condition.required).map((condition) => condition.id);
}
