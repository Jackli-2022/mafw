import { StateGraph, END } from "@langchain/langgraph";
import { LoopState } from "./loop-state";

export function routeAfterReview(state: typeof LoopState.State): string {
  if (state.lastError) return "archive_fail";
  if (state.reviewVerdict === "PASS") return "archive_success";
  if (state.round >= state.maxRounds) return "archive_max_retries";
  if (state.pendingQuestion) return "askUser";
  return "plan";
}

export function routeAfterPlan(state: typeof LoopState.State): string {
  if (state.pendingQuestion) return "askUser";
  return "execute";
}

export interface GraphOptions {
  plan: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  askUser: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  execute: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  review: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveSuccess: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveFail: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveMaxRetries: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
}

export function buildExecutionGraph(options: GraphOptions) {
  const workflow = new StateGraph(LoopState)
    .addNode("plan", options.plan, {
      retryPolicy: { maxAttempts: 2 },
    })
    .addNode("askUser", options.askUser)
    .addNode("execute", options.execute, {
      retryPolicy: { maxAttempts: 2 },
    })
    .addNode("review", options.review, {
      retryPolicy: { maxAttempts: 2 },
    })
    .addNode("archive_success", options.archiveSuccess)
    .addNode("archive_fail", options.archiveFail)
    .addNode("archive_max_retries", options.archiveMaxRetries)

    .addEdge("__start__", "plan")
    .addConditionalEdges("plan", routeAfterPlan, {
      askUser: "askUser",
      execute: "execute",
    })
    .addEdge("askUser", "plan")
    .addEdge("execute", "review")
    .addConditionalEdges("review", routeAfterReview, {
      plan: "plan",
      askUser: "askUser",
      archive_success: "archive_success",
      archive_fail: "archive_fail",
      archive_max_retries: "archive_max_retries",
    })
    .addEdge("archive_success", END)
    .addEdge("archive_fail", END)
    .addEdge("archive_max_retries", END);

  return workflow.compile();
}
