import { ToolDefinition, ToolHandler } from "../types";

export interface ToolRegistry {
  definitions: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

const DEFINITIONS: ToolDefinition[] = [
  {
    name: "mafw_create_goal",
    description: "Create a new MAFW goal with charter and request files",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Unique goal identifier (e.g. 003-foo)" },
        title: { type: "string", description: "Human-readable goal title" },
        charter: { type: "string", description: "Goal charter content in markdown" },
        source: { type: "string", description: "Source of the goal request", default: "user" },
        metrics: {
          type: "object",
          description: "Success metrics key-value pairs",
          additionalProperties: { type: "object", properties: { target: { type: "number" }, unit: { type: "string" } } }
        },
        boundaries: { type: "array", items: { type: "string" }, description: "Boundary constraints" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Goal priority", default: "medium" },
        maxLoops: { type: "number", description: "Maximum loop iterations", default: 5 },
      },
      required: ["goalId", "title", "charter"],
    },
  },
  {
    name: "mafw_update_state",
    description: "Update the state file for a goal",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        patch: { type: "object", description: "Partial state fields to update" },
      },
      required: ["goalId", "patch"],
    },
  },
  {
    name: "mafw_search_hybrid",
    description: "Search memory units using BM25 + vector hybrid retrieval",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        topK: { type: "number", description: "Maximum results to return", default: 20 },
        memoryType: { type: "string", enum: ["episodic", "semantic", "procedural", "global"], description: "Optional memory type filter" },
      },
      required: ["query"],
    },
  },
  {
    name: "mafw_get_deltas",
    description: "Get parametric L3 deltas for a goal and agent phase",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        agentType: { type: "string", enum: ["plan", "execute", "review"], description: "Target agent type" },
        loopNum: { type: "number", description: "Current loop number" },
      },
      required: ["goalId", "agentType"],
    },
  },
  {
    name: "mafw_load_state",
    description: "Load the current state file for a goal",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "mafw_ask_user",
    description: "Ask the user a non-blocking question during execution",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Question to ask the user" },
        goalId: { type: "string", description: "Goal identifier" },
        loopNum: { type: "number", description: "Current loop number" },
        options: { type: "array", items: { type: "string" }, description: "Optional answer choices" },
        priority: { type: "string", enum: ["normal", "high"], description: "Question priority", default: "normal" },
      },
      required: ["question", "goalId", "loopNum"],
    },
  },
  {
    name: "mafw_record_feedback",
    description: "Record user feedback for alignment energy adjustment",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "Target identifier (e.g. wave-1, task-2)" },
        type: { type: "string", enum: ["thumbs_up", "thumbs_down", "correction"], description: "Feedback type" },
        goalId: { type: "string", description: "Goal identifier" },
        loopNum: { type: "number", description: "Current loop number" },
        comment: { type: "string", description: "Optional feedback comment" },
      },
      required: ["targetId", "type", "goalId", "loopNum"],
    },
  },
  {
    name: "mafw_get_model_route",
    description: "Get the recommended model route for an agent based on budget",
    inputSchema: {
      type: "object",
      properties: {
        agentType: { type: "string", enum: ["plan", "execute", "review"], description: "Agent type to route" },
        remainingBudget: { type: "number", description: "Remaining token budget" },
        totalBudget: { type: "number", description: "Total available token budget" },
      },
      required: ["agentType", "remainingBudget", "totalBudget"],
    },
  },
  {
    name: "mafw_add_memory",
    description: "Save a memory unit to the harmonic memory system. Agent calls this to persist reusable experiences, solutions, patterns, and insights for future retrieval.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory content text to remember" },
        memoryType: { type: "string", enum: ["semantic", "episodic", "procedural", "global"], description: "Memory type" },
        cueAnchors: { type: "array", items: { type: "string" }, description: "Tags/keywords for retrieval (max 8)" },
        primaryAbstraction: { type: "string", description: "6-8 word summary (auto-generated from content if omitted)" },
      },
      required: ["content", "memoryType"],
    },
  },
  {
    name: "mafw_commit_heuristic",
    description: "Commit a new L5 heuristic (global, cross-project)",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The heuristic pattern/rule" },
        triggerContext: { type: "array", items: { type: "string" }, description: "Keywords that trigger this heuristic" },
        sourceGoalIds: { type: "array", items: { type: "string" }, description: "Goal IDs that contributed to this heuristic" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "mafw_get_axioms",
    description: "Get top L5 axioms and heuristics by energy",
    inputSchema: {
      type: "object",
      properties: {
        topK: { type: "number", description: "Number of results to return", default: 10 },
      },
    },
  },
];

import { handleCreateGoal } from "./handlers/create-goal";
import { handleUpdateState } from "./handlers/update-state";
import { handleSearchHybrid } from "./handlers/search-hybrid";
import { handleGetDeltas } from "./handlers/get-deltas";
import { handleLoadState } from "./handlers/load-state";
import { handleAskUser } from "./handlers/ask-user";
import { handleRecordFeedback } from "./handlers/record-feedback";
import { handleGetModelRoute } from "./handlers/get-model-route";
import { handleAddMemory } from "./handlers/add-memory";
import { handleCommitHeuristic } from "./handlers/commit-heuristic";
import { handleGetAxioms } from "./handlers/get-axioms";

export function createToolRegistry(): ToolRegistry {
  return {
    definitions: DEFINITIONS,
    handlers: {
      mafw_create_goal: handleCreateGoal,
      mafw_update_state: handleUpdateState,
      mafw_search_hybrid: handleSearchHybrid,
      mafw_get_deltas: handleGetDeltas,
      mafw_load_state: handleLoadState,
      mafw_ask_user: handleAskUser,
      mafw_record_feedback: handleRecordFeedback,
      mafw_get_model_route: handleGetModelRoute,
      mafw_add_memory: handleAddMemory,
      mafw_commit_heuristic: handleCommitHeuristic,
      mafw_get_axioms: handleGetAxioms,
    },
  };
}
