import { Annotation } from "@langchain/langgraph";

export const LoopState = Annotation.Root({
  goalId: Annotation<string>({
    value: (a, b) => b ?? a,
  }),
  projectDir: Annotation<string>({
    value: (a, b) => b ?? a,
  }),
  mafwDir: Annotation<string>({
    value: (a, b) => b ?? a,
  }),

  round: Annotation<number>({
    value: (a, b) => b ?? a ?? 0,
    default: () => 1,
  }),
  maxRounds: Annotation<number>({
    value: (a, b) => b ?? a ?? 0,
    default: () => 3,
  }),

  wavePlanPath: Annotation<string | null>({
    value: (a, b) => b ?? a,
    default: () => null,
  }),

  receiptPath: Annotation<string | null>({
    value: (a, b) => b ?? a,
    default: () => null,
  }),

  reviewVerdict: Annotation<"PASS" | "FAIL" | "ERROR">({
    value: (a, b) => b ?? a,
    default: () => "FAIL" as const,
  }),
  reviewReportPath: Annotation<string | null>({
    value: (a, b) => b ?? a,
    default: () => null,
  }),
  reviewFeedback: Annotation<string>({
    value: (a, b) => b ?? a,
    default: () => "",
  }),

  lastError: Annotation<string | null>({
    value: (a, b) => b ?? a,
    default: () => null,
  }),

  phase: Annotation<string | null>({
    value: (a, b) => b ?? a,
    default: () => null,
  }),
});

export type LoopStateType = typeof LoopState.State;
