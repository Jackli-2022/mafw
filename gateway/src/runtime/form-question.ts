/**
 * opencode 2.1 Form.Field → canonical question 的共享纯映射。
 *
 * adapter 的 question.list/reply 与 @2.1 事件 transform 同源，避免实时/轮询
 * 两种路径的形状漂移。字段元数据保留完整，桌面据此渲染 typed 控件。
 */

export interface FormQuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface FormQuestionWhen {
  key: string;
  op: 'eq' | 'neq';
  value: string | number | boolean;
}

export interface FormQuestion {
  id: string;
  question: string;
  header?: string;
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external';
  multiple?: boolean;
  custom?: boolean;
  required?: boolean;
  options?: FormQuestionOption[];
  default?: unknown;
  format?: string;
  placeholder?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  when?: FormQuestionWhen[];
  url?: string;
}

export interface FormQuestionEnvelope {
  id: string;
  sessionID: string;
  title: string;
  metadata?: Record<string, unknown>;
  tool?: unknown;
  form: any;
  questions: FormQuestion[];
  __fields: any[];
  mode: 'form' | 'url';
  expiresAt?: number;
}

function visibleFields(form: any): any[] {
  return Array.isArray(form?.fields) ? form.fields.filter((f: any) => f && !f.hidden) : [];
}

function optionsOf(field: any): FormQuestionOption[] | undefined {
  if (Array.isArray(field?.options)) {
    return field.options.map((o: any) => ({
      label: o.label ?? o.value,
      value: o.value ?? o.label,
      description: o.description,
    }));
  }
  if (field?.type === 'boolean') {
    return [
      { label: '是', value: 'true' },
      { label: '否', value: 'false' },
    ];
  }
  return undefined;
}

/** metadata 里可能出现的过期时间（ISO / 秒 / 毫秒）。 */
export function expiresAtOf(metadata: any): number | undefined {
  const raw = metadata?.expiresAt ?? metadata?.expires_at ?? metadata?.expires ?? metadata?.timeoutAt;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw < 1e12 ? raw * 1000 : raw;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

export function formToQuestion(form: any): FormQuestionEnvelope {
  const fields = visibleFields(form);
  const metadata = form?.metadata;
  return {
    id: form?.id,
    sessionID: form?.sessionID,
    title: form?.title,
    metadata,
    tool: metadata?.tool,
    form,
    questions: fields.map((f: any): FormQuestion => ({
      id: f.key,
      question: f.title || f.key || 'Input',
      header: f.title,
      type: f.type,
      multiple: f.type === 'multiselect',
      custom: f.type === 'string' ? f.custom !== false : undefined,
      required: f.required === true,
      options: optionsOf(f),
      default: f.default,
      format: f.format,
      placeholder: f.placeholder,
      minimum: typeof f.minimum === 'number' ? f.minimum : undefined,
      maximum: typeof f.maximum === 'number' ? f.maximum : undefined,
      minLength: typeof f.minLength === 'number' ? f.minLength : undefined,
      maxLength: typeof f.maxLength === 'number' ? f.maxLength : undefined,
      pattern: typeof f.pattern === 'string' ? f.pattern : undefined,
      when: Array.isArray(f.when) ? f.when : undefined,
      url: typeof f.url === 'string' ? f.url : undefined,
    })),
    __fields: fields,
    mode: fields.some((f: any) => f.type === 'external') ? 'url' : 'form',
    expiresAt: expiresAtOf(metadata),
  };
}

const TRUE_RE = /^(true|yes|on|1|accept|accepted|已打开|同意|是)$/i;

/** canonical answers(string[][]) → 2.1 Form.Answer（按字段类型转值）。 */
export function formAnswerOf(form: any, answers: string[][]): Record<string, unknown> {
  const fields = visibleFields(form);
  const out: Record<string, unknown> = {};
  fields.forEach((f: any, i: number) => {
    const vals = Array.isArray(answers?.[i]) ? answers[i] : [];
    if (!f?.key) return;
    switch (f.type) {
      case 'multiselect':
        out[f.key] = vals;
        break;
      case 'boolean':
        out[f.key] = TRUE_RE.test(vals[0] ?? '');
        break;
      case 'number':
      case 'integer': {
        const n = Number(vals[0]);
        out[f.key] = Number.isFinite(n) ? n : 0;
        break;
      }
      case 'external':
        // 2.1 requires a boolean acknowledgement; the URL string is rejected.
        out[f.key] = TRUE_RE.test(vals[0] ?? '');
        break;
      default:
        out[f.key] = vals[0] ?? '';
    }
  });
  return out;
}
