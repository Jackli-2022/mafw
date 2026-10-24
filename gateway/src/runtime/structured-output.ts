import { validateJsonSchema } from './json-schema';

export interface OutputSchemaSpec {
  name?: string;
  schema: Record<string, any>;
  /** 同步 prompt 失败后的整回合重试次数；0-3。 */
  retryCount?: number;
}

export interface StructuredState {
  spec: OutputSchemaSpec;
  submitted?: unknown;
  errors?: string[];
  updatedAt: number;
}

export interface StructuredSubmitResult {
  ok: boolean;
  errors: string[];
}

const MAX_ERRORS = 20;
const MAX_ERROR_LENGTH = 300;

function compactErrors(errors: string[]): string[] {
  return errors.slice(0, MAX_ERRORS).map((e) => e.length > MAX_ERROR_LENGTH ? `${e.slice(0, MAX_ERROR_LENGTH)}…` : e);
}

/** 进程内 per-session 结构化输出现状（schema + 最近一次有效交卷）。 */
export class StructuredOutputService {
  private states = new Map<string, StructuredState>();

  register(sessionID: string, spec: OutputSchemaSpec): void {
    if (!sessionID) return;
    const retryCount = Math.max(0, Math.min(3, Math.floor(spec.retryCount ?? 0)));
    this.states.set(sessionID, {
      spec: { ...spec, retryCount },
      updatedAt: Date.now(),
    });
  }

  submit(sessionID: string, data: unknown): StructuredSubmitResult {
    const state = this.states.get(sessionID);
    if (!state) return { ok: false, errors: ['no active output schema'] };
    const validation = validateJsonSchema(state.spec.schema, data);
    if (validation.length > 0) {
      const errors = compactErrors(validation.map((e) => `${e.path}: ${e.message}`));
      state.errors = errors;
      state.updatedAt = Date.now();
      return { ok: false, errors };
    }
    state.submitted = data;
    state.errors = [];
    state.updatedAt = Date.now();
    return { ok: true, errors: [] };
  }

  get(sessionID: string): StructuredState | undefined {
    return this.states.get(sessionID);
  }

  submitted(sessionID: string): unknown | undefined {
    return this.states.get(sessionID)?.submitted;
  }

  spec(sessionID: string): OutputSchemaSpec | undefined {
    return this.states.get(sessionID)?.spec;
  }

  clear(sessionID: string): void {
    this.states.delete(sessionID);
  }

  size(): number {
    return this.states.size;
  }
}

export const structuredOutput = new StructuredOutputService();

/** prompt 尾部注入的交卷指令（schema 是模型看到的唯一真值）。 */
export function structuredInstruction(spec: OutputSchemaSpec): string {
  return [
    '[MAFW STRUCTURED OUTPUT]',
    'You must finish this turn by calling mafw_submit_result with a `data` object that conforms to this JSON Schema.',
    'If validation fails, fix the data and call again. Do not rely on prose as the result.',
    `Schema: ${JSON.stringify(spec.schema)}`,
  ].join('\n');
}
