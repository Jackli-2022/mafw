/** AskCard typed form 的纯逻辑：可见性、默认值、完整性、序列化。 */

export interface FormQuestionLike {
  id: string
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external'
  required?: boolean
  multiple?: boolean
  options?: Array<{ id: string; title: string; description?: string }>
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  when?: Array<{ key: string; op: 'eq' | 'neq'; value: string | number | boolean }>
  url?: string
}

export type AnswerMap = Record<string, string[]>

export function initialAnswers(questions: FormQuestionLike[]): AnswerMap {
  const out: AnswerMap = {}
  for (const q of questions) {
    if (q.default === undefined || q.default === null) continue
    if (q.type === 'multiselect' && Array.isArray(q.default)) {
      out[q.id] = q.default.map(String)
    } else if (q.type === 'external') {
      // 2.1 requires an explicit acknowledgement; never default to true.
    } else {
      out[q.id] = [String(q.default)]
    }
  }
  return out
}

function valueOf(answers: AnswerMap, key: string): string {
  return answers[key]?.[0] ?? ''
}

/** `when` 条件全部满足才显示；依赖字段未答按空串处理。 */
export function visibleQuestions(questions: FormQuestionLike[], answers: AnswerMap): FormQuestionLike[] {
  return questions.filter((q) => {
    if (!q.when || q.when.length === 0) return true
    return q.when.every((w) => {
      const actual = valueOf(answers, w.key)
      const expected = String(w.value)
      return w.op === 'eq' ? actual === expected : actual !== expected
    })
  })
}

function isNonEmpty(value: string | undefined): boolean {
  return (value ?? '').trim().length > 0
}

export function isQuestionComplete(q: FormQuestionLike, values: string[]): boolean {
  const value = values[0] ?? ''
  switch (q.type) {
    case 'external':
      return values.includes('true')
    case 'boolean':
      return values.length > 0
    case 'multiselect':
      return values.length > 0
    case 'number':
    case 'integer': {
      if (!isNonEmpty(value)) return false
      const n = Number(value)
      if (!Number.isFinite(n)) return false
      if (q.type === 'integer' && !Number.isInteger(n)) return false
      if (typeof q.minimum === 'number' && n < q.minimum) return false
      if (typeof q.maximum === 'number' && n > q.maximum) return false
      return true
    }
    default: {
      if (!isNonEmpty(value)) return false
      if (typeof q.minLength === 'number' && value.length < q.minLength) return false
      if (typeof q.maxLength === 'number' && value.length > q.maxLength) return false
      if (typeof q.pattern === 'string') {
        try { if (!new RegExp(q.pattern).test(value)) return false } catch { /* bad pattern: don't block */ }
      }
      return true
    }
  }
}

/** 可选字段空值算满足；external 无论 required 都必须确认。 */
export function isQuestionSatisfied(q: FormQuestionLike, values: string[]): boolean {
  if (q.type === 'external') return values.includes('true')
  if (!q.required && (values.length === 0 || !isNonEmpty(values[0]))) return true
  return isQuestionComplete(q, values)
}

/** 按 questions 原顺序输出（含 when 隐藏项的空数组），保证 gateway 字段索引对齐。 */
export function serializeAnswers(questions: FormQuestionLike[], answers: AnswerMap): string[][] {
  return questions.map((q) => answers[q.id] ?? [])
}
