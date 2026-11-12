import type { Services, ToolHandler } from '../../types';
import type { DecisionDraftInput, DecisionRecord } from '../../core/decision/decision-record';
import { DecisionRecordError } from '../../core/decision/decision-record-service';

export interface DecisionDraftToolDeps {
  draft(input: DecisionDraftInput): DecisionRecord;
  projectDir(): string | null;
}

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

function ok(record: DecisionRecord): ToolResult {
  const payload = { success: true, record };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function fail(error: unknown): ToolResult {
  const status = error instanceof DecisionRecordError
    ? error.status
    : typeof (error as any)?.status === 'number' ? (error as any).status : undefined;
  const payload = {
    success: false,
    ...(status ? { status } : {}),
    error: String((error as any)?.message ?? error),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: true,
    structuredContent: payload,
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pickInput(args: Record<string, unknown>): Omit<DecisionDraftInput, 'projectDir'> {
  return {
    goalId: text(args.goalId) || null,
    revision: typeof args.revision === 'number' ? args.revision : null,
    kind: args.kind as DecisionDraftInput['kind'],
    question: text(args.question),
    ...(args.options !== undefined ? { options: args.options as DecisionDraftInput['options'] } : {}),
    ...(args.evidence !== undefined ? { evidence: args.evidence as DecisionDraftInput['evidence'] } : {}),
    rationale: text(args.rationale) || null,
    consequences: text(args.consequences) || null,
    reviewAt: text(args.reviewAt) || null,
  };
}

export function createDecisionDraftTool(deps: DecisionDraftToolDeps) {
  return {
    execute(args: Record<string, unknown>): ToolResult {
      try {
        const projectDir = text(args.projectDir) || deps.projectDir();
        if (!projectDir) {
          return fail(new DecisionRecordError(503, 'projectDir is required'));
        }
        return ok(deps.draft({ ...pickInput(args), projectDir }));
      } catch (error) {
        return fail(error);
      }
    },
  };
}

/** MCP handler: drafts only. Confirmation/shelving stay in human routes. */
export const handleDecisionDraft: ToolHandler = async (args, services: Services) => {
  const records = services.decisionRecords;
  if (!records?.draft) {
    return fail(new DecisionRecordError(503, 'decision records are unavailable'));
  }
  const tool = createDecisionDraftTool({
    draft: (input) => records.draft(input),
    projectDir: () => services.projectDir?.() ?? null,
  });
  return tool.execute(args);
};
