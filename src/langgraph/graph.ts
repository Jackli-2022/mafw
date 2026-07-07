import { StateGraph, END } from "@langchain/langgraph";
import { LoopState } from "./loop-state";

export function routeAfterReview(state: typeof LoopState.State): string {
  if (state.reviewVerdict === "ERROR" || state.lastError) {
    return "archive_fail";
  }
  if (state.reviewVerdict === "PASS") {
    return "archive_success";
  }
  if (state.round >= state.maxRounds) {
    return "archive_max_retries";
  }
  return "plan_node";
}

export interface GraphNodes {
  planNode: any;
  executeNode: any;
  reviewNode: any;
  syncNode: any;
  archiveSuccess: any;
  archiveFail: any;
  archiveMaxRetries: any;
}

export function buildLoopGraph(nodes: GraphNodes) {
  const workflow = new StateGraph(LoopState)
    .addNode("plan_node", nodes.planNode)
    .addNode("execute_node", nodes.executeNode)
    .addNode("review_node", nodes.reviewNode)
    .addNode("sync_node", nodes.syncNode)
    .addNode("archive_success", nodes.archiveSuccess)
    .addNode("archive_fail", nodes.archiveFail)
    .addNode("archive_max_retries", nodes.archiveMaxRetries)

    .addEdge("__start__", "plan_node")
    .addEdge("plan_node", "execute_node")
    .addEdge("execute_node", "review_node")
    .addEdge("review_node", "sync_node")

    .addConditionalEdges("sync_node", routeAfterReview, {
      plan_node: "plan_node",
      archive_success: "archive_success",
      archive_fail: "archive_fail",
      archive_max_retries: "archive_max_retries",
    })

    .addEdge("archive_success", END)
    .addEdge("archive_fail", END)
    .addEdge("archive_max_retries", END);

  return workflow.compile();
}
