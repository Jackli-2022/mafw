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
    description: "Search memory units using BM25 (×energy) with optional iterative expansion. If results are insufficient and canExpand=true, call again with the returned state to expand via shared cue anchors. Stop when memories suffice; max 2 expansion rounds (3 calls total).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        topK: { type: "number", description: "Maximum results", default: 20 },
        memoryType: { type: "string", enum: ["episodic", "semantic", "procedural", "global"], description: "Optional filter" },
        policy: { type: "string", enum: ["guided", "oneshot"], default: "guided", description: "Retrieval strategy (reserved)" },
        retriever: { type: "string", enum: ["bm25", "hybrid", "token", "guided"], description: "Retrieval engine: bm25 (default), hybrid = BM25 + embedding RRF fusion (requires memory.embedding.provider), guided = multi-hop query expansion, token = legacy substring" },
        state: { type: "string", description: "Iteration state from a previous call; pass to continue expanding" },
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
        goalId: { type: "string", description: "Optional goal identifier" },
        loopNum: { type: "number", description: "Optional current loop number" },
        options: { type: "array", items: { type: "string" }, description: "Optional answer choices" },
        priority: { type: "string", enum: ["normal", "high"], description: "Question priority", default: "normal" },
      },
      required: ["question"],
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
    description: "Save a memory unit to the harmonic memory system. Agent calls this to persist reusable experiences, solutions, patterns, and insights for future retrieval. Before writing preference/fact memories, search for similar existing memories first — if one already covers the same fact, use mafw_supersede_memory instead.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory content text to remember" },
        memoryType: { type: "string", enum: ["semantic", "episodic", "procedural", "global"], description: "Memory type" },
        cueAnchors: { type: "array", items: { type: "string" }, description: "Tags/keywords for retrieval (max 8)" },
        primaryAbstraction: { type: "string", description: "6-8 word summary (auto-generated from content if omitted)" },
        supersedes: { type: "array", items: { type: "string" }, description: "IDs of existing memories this new memory replaces/updates. The old memories will be marked superseded (energy halved, search penalty applied)." },
      },
      required: ["content", "memoryType"],
    },
  },
  {
    name: "mafw_supersede_memory",
    description: "Mark existing memories as superseded (outdated/contradicted) without writing a new replacement. Use when the user explicitly retracts a fact or preference. For the common case of 'new memory replaces old', use mafw_add_memory with the supersedes field instead.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Memory IDs to mark as superseded" },
        reason: { type: "string", description: "Why these memories are superseded (for audit trail)" },
      },
      required: ["ids"],
    },
  },
  {
    name: "mafw_pin_memory",
    description: "Pin or unpin an existing memory to/from the disclosure layer. Pinned memories are injected into the system prompt every turn as <user-profile>. Use for user identity/profile and long-term preferences; unpin when a pinned preference becomes stale.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory unit id (mem_...)" },
        pinned: { type: "boolean", description: "true to pin, false to unpin" },
      },
      required: ["id", "pinned"],
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
  {
    name: "mafw_merge_memory",
    description: "Merge memories from another worktree into the current project. Extracts unique high-value memories, detects conflicts, and writes fusion log.",
    inputSchema: {
      type: "object",
      properties: {
        sourceWorktree: { type: "string", description: "Path to the source worktree root directory" },
        resolveStrategy: { type: "string", enum: ["manual", "higher_energy", "newer"], default: "manual", description: "Conflict resolution strategy" },
      },
      required: ["sourceWorktree"],
    },
  },
  {
    name: "mafw_resolve_merge",
    description: "Resolve merge conflict. Actions: merge (combine values), link (cross-reference), abstract (create parent node)",
    inputSchema: {
      type: "object",
      properties: {
        conflictingId: { type: "string", description: "ID of existing conflicting memory" },
        newAbstraction: { type: "string", description: "Primary abstraction of new memory" },
        action: { type: "string", enum: ["merge", "link", "abstract"], description: "Resolution action" },
      },
      required: ["conflictingId", "newAbstraction", "action"],
    },
  },
  // ── Manager tools ──
  {
    name: "mafw_set_goal",
    description: "Create a new MAFW goal (Manager tool — must confirm with user first)",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Unique goal identifier" },
        title: { type: "string", description: "Human-readable goal title" },
        charter: { type: "string", description: "Goal charter in markdown" },
        source: { type: "string", description: "Source", default: "manager" },
        boundaries: { type: "array", items: { type: "string" } },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"], default: "medium" },
        maxLoops: { type: "number", default: 5 },
      },
      required: ["goalId", "title", "charter"],
    },
  },
  {
    name: "mafw_get_goal_status",
    description: "Get goal state/progress/verdict from checkpoint",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "mafw_list_goals",
    description: "List all active goals with their phase and verdict",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mafw_answer_question",
    description: "Answer a pending loop question on behalf of the user",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
        questionId: { type: "string" },
        answer: { type: "string" },
        action: { type: "string", enum: ["answer", "cancel", "redirect"], default: "answer" },
      },
      required: ["goalId", "questionId", "answer"],
    },
  },
  {
    name: "mafw_get_evidence",
    description: "Read review report / evidence for a goal",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "mafw_cancel_goal",
    description: "Cancel a goal (requires user confirmation)",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "mafw_list_pending_questions",
    description: "List all currently pending loop questions",
    inputSchema: { type: "object", properties: {} },
  },
  // ── Tier 1: Read-only automation tools ──
  {
    name: "mafw_list_automation_rules",
    description: "List all automation rules with next trigger times and recent execution records",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mafw_get_automation_rule",
    description: "Get detailed information about a specific automation rule",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Automation rule ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "mafw_list_triage_items",
    description: "List pending triage items, optionally filtered by status",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["PENDING_CONFIRMATION", "CONFIRMED", "REJECTED"], description: "Filter by status (default: PENDING_CONFIRMATION)" },
      },
    },
  },
  {
    name: "mafw_get_triage_item",
    description: "Get detailed information about a specific triage item including findings and LLM suggestions",
    inputSchema: {
      type: "object",
      properties: {
        triage_id: { type: "string", description: "Triage item ID" },
      },
      required: ["triage_id"],
    },
  },
  {
    name: "mafw_get_automation_history",
    description: "Get audit history for automation rules from the ledger",
    inputSchema: {
      type: "object",
      properties: {
        rule_id: { type: "string", description: "Optional rule ID filter" },
        limit: { type: "number", description: "Maximum entries to return", default: 20 },
      },
    },
  },
  // ── Tier 2: Safe action automation tools ──
  {
    name: "mafw_run_automation",
    description: "Run a scan-type automation rule. Force auto_confirm=false — results always go to PENDING_CONFIRMATION for your review",
    inputSchema: {
      type: "object",
      properties: {
        rule_id: { type: "string", description: "Automation rule ID to execute" },
      },
      required: ["rule_id"],
    },
  },
  {
    name: "mafw_validate_rule",
    description: "Dry-run validation of an automation rule: checks cron expression syntax, timezone validity, and previews next 5 trigger times. Does NOT persist anything",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Proposed rule identifier" },
        trigger: {
          type: "object",
          description: "Trigger configuration",
          properties: {
            type: { type: "string", enum: ["cron"], description: "Trigger type (only cron supported)" },
            schedule: { type: "string", description: "Cron expression (e.g. '0 2 * * *')" },
            timezone: { type: "string", description: "IANA timezone (e.g. 'Asia/Shanghai')", default: "UTC" },
          },
          required: ["schedule"],
        },
        skill: { type: "string", description: "Skill to execute" },
        action: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["memory:distill", "memory:decay", "memory:review", "memory:prune"], description: "Memory action type" },
          },
        },
        onResult: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["triage", "goal"] },
            auto_confirm: { type: "boolean" },
            template: { type: "string" },
          },
        },
        goal_defaults: {
          type: "object",
          properties: {
            maxLoops: { type: "number" },
          },
        },
      },
      required: ["id", "trigger"],
    },
  },
  // ── Tier 3: Draft/Suggest automation tools ──
  {
    name: "mafw_propose_triage_decision",
    description: "Attach your analysis and suggestion to a triage item. Item REMAINS PENDING_CONFIRMATION — the user sees your suggestion when they review triage items and can accept or override it",
    inputSchema: {
      type: "object",
      properties: {
        triage_id: { type: "string", description: "Triage item ID" },
        suggestion: { type: "string", enum: ["confirm", "reject"], description: "Your recommended action" },
        reason: { type: "string", description: "Detailed reasoning for your suggestion" },
        priority: { type: "string", enum: ["high", "medium", "low"], description: "Suggested priority", default: "medium" },
      },
      required: ["triage_id", "suggestion", "reason"],
    },
  },
  {
    name: "mafw_draft_automation_rule",
    description: "Validate and save a new automation rule draft with enabled=false. The user must manually enable it in the dashboard or config file. Overwrites existing disabled drafts but rejects overwriting enabled rules",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Unique rule identifier" },
        trigger: {
          type: "object",
          description: "Trigger configuration",
          properties: {
            type: { type: "string", enum: ["cron"], description: "Trigger type (only cron supported)" },
            schedule: { type: "string", description: "Cron expression (e.g. '0 */6 * * *')" },
            timezone: { type: "string", description: "IANA timezone", default: "UTC" },
          },
          required: ["schedule"],
        },
        skill: { type: "string", description: "Skill to execute" },
        action: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["memory:distill", "memory:decay", "memory:review", "memory:prune"] },
          },
        },
        onResult: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["triage", "goal"] },
            auto_confirm: { type: "boolean" },
            template: { type: "string" },
          },
        },
        goal_defaults: {
          type: "object",
          properties: {
            maxLoops: { type: "number" },
          },
        },
      },
      required: ["id", "trigger"],
    },
  },
  // ── Desktop GUI automation tools ──
  {
    name: "mafw_desktop_screenshot",
    description: "Take a screenshot of the MAFW Desktop GUI. Optionally capture a specific region by CSS selector. The PNG is saved to .mafw/screenshots/ and the file path is returned. Use this to verify visual output.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Optional CSS selector to capture a specific region (e.g. '.mafw-content')" },
      },
    },
  },
  {
    name: "mafw_desktop_navigate",
    description: "Switch to a specific tab in the MAFW Desktop GUI. Valid tabs: chat, goals, memory, approvals, triage, automation",
    inputSchema: {
      type: "object",
      properties: {
        tab: { type: "string", enum: ["chat", "goals", "memory", "approvals", "triage", "automation"], description: "Target tab" },
      },
      required: ["tab"],
    },
  },
  {
    name: "mafw_desktop_get_ui_state",
    description: "Get a structured snapshot of the current Desktop UI: active tab, visible elements with bounding boxes, scroll position, and window dimensions. Use before interacting to confirm element exists.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mafw_desktop_click",
    description: "Click an element in the Desktop GUI identified by CSS selector. Returns the clicked element's tag, text, and bounding box. Use after get_ui_state to verify the target.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the element to click (e.g. '.mafw-tab:nth-child(3)', '#submit-btn')" },
      },
      required: ["selector"],
    },
  },
  {
    name: "mafw_desktop_type",
    description: "Type text into an input field or textarea in the Desktop GUI. Only works on INPUT, TEXTAREA, or contentEditable elements.",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector for the input element" },
        text: { type: "string", description: "Text to type" },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "mafw_desktop_scroll",
    description: "Scroll the Desktop GUI window in a direction. Useful to bring elements into view.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction" },
        amount: { type: "number", description: "Scroll amount in pixels (default: 200)" },
      },
      required: ["direction"],
    },
  },
  {
    name: "mafw_restart_agent",
    description: "Restart the agent runtime (opencode serve). This will interrupt any in-flight prompts. Only works when the runtime supports agent process management (agentProcessApi=true).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mafw_new_topic",
    description: "Start a new manager topic: create a fresh manager session; the current conversation is archived to history (still searchable via memory). ONLY call when the user explicitly asks to start a new topic (e.g. 另开话题/开个新话题). Never propose or trigger it on your own.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string", description: "Optional reason for starting the new topic" } },
    },
  },
  {
    name: "mafw_btw",
    description: "Answer a one-off side question in a throwaway session (by the way). Use when the user asks a tangent unrelated to the current goal work and answering inline would pollute the main thread. Returns the answer text; the side session is discarded afterwards.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "The side question to answer" } },
      required: ["question"],
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
import { handleSupersedeMemory } from "./handlers/supersede-memory";
import { handlePinMemory } from "./handlers/pin-memory";
import { handleCommitHeuristic } from "./handlers/commit-heuristic";
import { handleGetAxioms } from "./handlers/get-axioms";
import { handleMergeMemory } from "./handlers/merge-memory";
import { handleResolveMerge } from "./handlers/resolve-merge";
import { handleListAutomationRules } from "./handlers/list-automation-rules";
import { handleGetAutomationRule } from "./handlers/get-automation-rule";
import { handleListTriageItems } from "./handlers/list-triage-items";
import { handleGetTriageItem } from "./handlers/get-triage-item";
import { handleGetAutomationHistory } from "./handlers/get-automation-history";
import { handleRunAutomation } from "./handlers/run-automation";
import { handleValidateRule } from "./handlers/validate-rule";
import { handleProposeTriageDecision } from "./handlers/propose-triage-decision";
import { handleDraftAutomationRule } from "./handlers/draft-automation-rule";
import { handleDesktopScreenshot } from "./handlers/desktop-screenshot";
import { handleDesktopNavigate } from "./handlers/desktop-navigate";
import { handleDesktopGetState } from "./handlers/desktop-get-state";
import { handleDesktopClick } from "./handlers/desktop-click";
import { handleDesktopType } from "./handlers/desktop-type";
import { handleDesktopScroll } from "./handlers/desktop-scroll";
import { handleRestartAgent } from "./handlers/restart-agent";
import { handleNewTopic } from "./handlers/new-topic";
import { handleBtw } from "./handlers/btw";
import { handleManagerSetGoal } from "./handlers/manager-set-goal";
import { handleManagerGetGoalStatus } from "./handlers/manager-get-goal-status";
import { handleManagerListGoals } from "./handlers/manager-list-goals";
import { handleManagerAnswerQuestion } from "./handlers/manager-answer-question";
import { handleManagerGetEvidence } from "./handlers/manager-get-evidence";
import { handleManagerCancelGoal } from "./handlers/manager-cancel-goal";
import { handleManagerListPendingQuestions } from "./handlers/manager-list-pending-questions";

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
      mafw_supersede_memory: handleSupersedeMemory,
      mafw_pin_memory: handlePinMemory,
      mafw_commit_heuristic: handleCommitHeuristic,
      mafw_get_axioms: handleGetAxioms,
      mafw_merge_memory: handleMergeMemory,
      mafw_resolve_merge: handleResolveMerge,
      mafw_list_automation_rules: handleListAutomationRules,
      mafw_get_automation_rule: handleGetAutomationRule,
      mafw_list_triage_items: handleListTriageItems,
      mafw_get_triage_item: handleGetTriageItem,
      mafw_get_automation_history: handleGetAutomationHistory,
      mafw_run_automation: handleRunAutomation,
      mafw_validate_rule: handleValidateRule,
      mafw_propose_triage_decision: handleProposeTriageDecision,
      mafw_draft_automation_rule: handleDraftAutomationRule,
      mafw_desktop_screenshot: handleDesktopScreenshot,
      mafw_desktop_navigate: handleDesktopNavigate,
      mafw_desktop_get_ui_state: handleDesktopGetState,
      mafw_desktop_click: handleDesktopClick,
      mafw_desktop_type: handleDesktopType,
      mafw_desktop_scroll: handleDesktopScroll,
      mafw_restart_agent: handleRestartAgent,
      mafw_new_topic: handleNewTopic,
      mafw_btw: handleBtw,
      mafw_set_goal: handleManagerSetGoal,
      mafw_get_goal_status: handleManagerGetGoalStatus,
      mafw_list_goals: handleManagerListGoals,
      mafw_answer_question: handleManagerAnswerQuestion,
      mafw_get_evidence: handleManagerGetEvidence,
      mafw_cancel_goal: handleManagerCancelGoal,
      mafw_list_pending_questions: handleManagerListPendingQuestions,
    },
  };
}
