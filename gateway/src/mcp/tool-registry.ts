import { ToolDefinition, ToolHandler } from "../types";
import { annotationsForTool } from "../runtime/tool-classes";

export interface ToolRegistry {
  definitions: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

export const DEFINITIONS: ToolDefinition[] = [
  {
    name: "mafw_create_goal",
    description: "Create a new MAFW goal. Project Lead: the Goal is created directly in discussion (hidden Tech Lead session, ContextManifest seeded) and never auto-starts NodeDriver. Other callers write a legacy charter/request goal.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Unique goal identifier (generated for Lead-created discussion goals when omitted)" },
        title: { type: "string", description: "Human-readable goal title" },
        objective: { type: "string", description: "Objective for a Lead-created discussion goal (alternative to charter)" },
        charter: { type: "string", description: "Goal charter content in markdown" },
        source: { type: "string", description: "Source of the goal request", default: "user" },
        sessionID: { type: "string", description: "Caller session; required for Lead routing through the Tech Lead" },
        projectDir: { type: "string", description: "Registered project directory (defaults to MAFW_PROJECT_DIR/current)" },
        planReview: { type: "string", enum: ["auto", "manual"], description: "Plan approval mode (manual = human approves the plan)" },
        metrics: {
          type: "object",
          description: "Success metrics key-value pairs",
          additionalProperties: { type: "object", properties: { target: { type: "number" }, unit: { type: "string" } } }
        },
        boundaries: { type: "array", items: { type: "string" }, description: "Boundary constraints" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Goal priority", default: "medium" },
        maxLoops: { type: "number", description: "Maximum loop iterations", default: 5 },
        budget: {
          type: "object",
          description: "Turn/cost budget for the goal session (BudgetGuard hard-stop)",
          properties: { maxTurns: { type: "number" }, maxCostUsd: { type: "number" } },
        },
        taskType: { type: "string", enum: ["feature", "bugfix", "refactor", "research", "docs", "test", "other"], description: "D4b task type (optional declaration; the plan node's judgement in waves.taskType wins). Powers task-typed capability priors and counterfactual pre-mortem." },
        sourceRef: {
          type: "object",
          description: "Immutable handoff provenance (current Lead topic snapshot)",
          properties: {
            sessionID: { type: "string" },
            messageID: { type: "string" },
            snapshot: { type: "string" },
            capturedAt: { type: "string" },
            topicId: { type: "string" },
            messageRange: {
              type: "object",
              properties: { from: { type: "string" }, to: { type: "string" } },
            },
          },
        },
        handoff: {
          type: "string",
          enum: ["current-topic", "none"],
          description: "Hand off the current Lead topic; gateway builds sourceRef when omitted",
        },
        forkFromTopicId: { type: "string", description: "COW fork from an existing Lead topic (source topic id)" },
        topicId: { type: "string", description: "Source Lead topic id (optional; gateway resolves the latest when omitted)" },
      },
      required: ["title"],
    },
  },
  {
    name: "mafw_pod_goal_direction",
    description: "Record the Tech Lead direction decision for a discussion Goal. Only the Goal-bound Tech Lead session may call it. clear = direction is unambiguous (no user attention); decided = the user supplied a direction; needs_user = a real ambiguity needs the user to decide (persists attention and does NOT start planning).",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        mode: { type: "string", enum: ["clear", "needs_user", "decided"], description: "Direction outcome" },
        goalMode: { type: "string", enum: ["quick", "standard", "standing"], description: "Execution shape chosen by the Tech Lead (quick = one-task fast path; standard = plan/review; standing = long-lived template, not supported yet)" },
        requiresApproval: { type: "boolean", description: "High-risk action needs human confirmation; quick is rejected" },
        userWords: { type: "string", description: "User words (verbatim) or the clear Tech Lead conclusion" },
        optionId: { type: "string", description: "Chosen direction option id (when options were offered)" },
        options: {
          type: "array",
          description: "Direction options for needs_user",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              summary: { type: "string" },
              risks: { type: "array", items: { type: "string" } },
            },
            required: ["id", "title"],
          },
        },
        reason: { type: "string", description: "Why the user must decide, or rationale for the decision" },
        sessionID: { type: "string", description: "Calling Tech Lead session id (MCP does not carry caller identity)" },
      },
      required: ["goalId", "mode"],
    },
  },
  {
    name: "mafw_decision_draft",
    description: "Draft a decision record for human confirmation. Never marks it decided; only the human UI can confirm or shelve. Use for direction, plan, scope, authorization, acceptance, priority, disposition, or other decisions that should survive the chat.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Related Goal id (optional for world-level decisions)" },
        revision: { type: "number", description: "Related Goal revision (optional)" },
        kind: { type: "string", enum: ["direction", "plan", "scope", "authorization", "acceptance", "priority", "disposition", "other"] },
        question: { type: "string", description: "The question being decided" },
        options: {
          type: "array",
          description: "Options considered, including maintain/no-op",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              summary: { type: "string" },
              risks: { type: "array", items: { type: "string" } },
            },
            required: ["id", "title"],
          },
        },
        evidence: {
          type: "array",
          description: "Evidence links (message / file / change / review_item / goal)",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["message", "file", "change", "review_item", "goal"] },
              ref: { type: "string" },
              label: { type: "string" },
            },
            required: ["kind", "ref"],
          },
        },
        rationale: { type: "string", description: "Proposed reason (the human may edit it before confirming)" },
        consequences: { type: "string", description: "What becomes true / what is given up" },
        reviewAt: { type: "string", description: "When the decision should be revisited (ISO date)" },
        projectDir: { type: "string", description: "Project directory (defaults to the current project)" },
      },
      required: ["kind", "question"],
    },
  },
  {
    name: "mafw_pod_goal_context",
    description: "Lead-only: set the optional and Cross-Goal context refs for the active Goal revision. The stage baseline (goal.md / request.json / direction.json / waves.json / goal-eval.json) is always included by code; every ref passed here must exist, be readable, be non-sensitive, and Cross-Goal refs must be allowlisted by the Goal request. The rendered ContextManifest is persisted with its path + hash and injected into every worker/probe prompt. Tech Lead, Builder and Reviewer cannot widen their own context.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        revision: { type: "number", description: "Goal revision (defaults to the active revision; only the active non-terminal revision can be widened)" },
        refs: {
          type: "array",
          description: "Replace the whole optional selection (empty array clears it)",
          items: {
            type: "object",
            description: "One context reference: in-Goal path, project:<path>, or <otherGoalId>/<path> (Cross-Goal needs the Goal request allowlist)",
            properties: {
              path: { type: "string" },
              scope: { type: "string", enum: ["goal", "project", "cross-goal"] },
              goalId: { type: "string" },
              revision: { type: "number" },
              label: { type: "string" },
              required: { type: "boolean" },
              crossGoal: { type: "boolean" },
            },
            required: ["path"],
          },
        },
        add: {
          type: "array",
          description: "Append optional refs (deduplicated by path); same item shape as refs",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              scope: { type: "string", enum: ["goal", "project", "cross-goal"] },
              goalId: { type: "string" },
              revision: { type: "number" },
              label: { type: "string" },
              required: { type: "boolean" },
              crossGoal: { type: "boolean" },
            },
            required: ["path"],
          },
        },
        remove: {
          type: "array",
          description: "Remove refs by path, <goalId>/<path>, or display path",
          items: { type: "string" },
        },
        sessionID: { type: "string", description: "Calling Lead session id (MCP does not carry caller identity)" },
      },
      required: ["goalId"],
    },
  },
  {
    name: "mafw_pod_review_respond",
    description: "Tech Lead-only: respond to a human review item. Marks the item 已回应 (never 已解决) and records the response. The calling session must be the Goal-bound Tech Lead session. Only the human can resolve or reopen an item.",
    inputSchema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Goal identifier" },
        itemId: { type: "string", description: "Review item identifier" },
        response: { type: "string", description: "What changed or why the item is addressed" },
        sessionID: { type: "string", description: "Calling Tech Lead session id (MCP does not carry caller identity)" },
      },
      required: ["goalId", "itemId", "response", "sessionID"],
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
    // schema ��ʵ��2026-10-22 spec §5.6�������� handler �����������أ�������Э���ֶΣ�
    outputSchema: {
      type: "object",
      properties: {
        results: { type: "array", items: { type: "object" } },
        canExpand: { type: "boolean" },
        state: { type: ["string", "null"] },
        round: { type: "number" },
        count: { type: "number" },
        fok: { type: "object" },
        hint: { type: "string" },
        t1Results: { type: "array", items: { type: "object" } },
        t1Count: { type: "number" },
      },
      required: ["results", "canExpand", "round", "count", "hint"],
    },
    description: "Search memory. layer=gist (default) searches Harmonic knowledge; layer=t1 searches raw T1 verbatim turns; layer=both returns both. T1 hits carry traceId and are redeemed with mafw_get_memory(\"t1:<traceId>\").",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        topK: { type: "number", description: "Maximum results", default: 20 },
        memoryType: { type: "string", enum: ["episodic", "semantic", "procedural", "global"], description: "Optional filter" },
        policy: { type: "string", enum: ["guided", "oneshot"], default: "guided", description: "Retrieval strategy (reserved)" },
        retriever: { type: "string", enum: ["bm25", "hybrid", "token", "guided"], description: "Retrieval engine: bm25 (default), hybrid = BM25 + embedding RRF fusion (requires memory.embedding.provider), guided = multi-hop query expansion, token = legacy substring" },
        layer: { type: "string", enum: ["gist", "t1", "both"], default: "gist", description: "Search layer: gist (default) = Harmonic knowledge, t1 = raw verbatim turns, both = both result sets" },
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
    description: "Save a memory unit to the harmonic memory system. Agent calls this to persist reusable experiences, solutions, patterns, and insights for future retrieval. Before writing preference/fact memories, search for similar existing memories first 鈥?if one already covers the same fact, use mafw_supersede_memory instead.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory content text to remember" },
        memoryType: { type: "string", enum: ["semantic", "episodic", "procedural", "global"], description: "Memory type" },
        cueAnchors: { type: "array", items: { type: "string" }, description: "Tags/keywords for retrieval (max 8)" },
        primaryAbstraction: { type: "string", description: "6-8 word summary (auto-generated from content if omitted)" },
        supersedes: { type: "array", items: { type: "string" }, description: "IDs of existing memories this new memory replaces/updates. The old memories will be marked superseded (energy halved, search penalty applied)." },
        sticky: { type: "boolean", description: "Put this memory on the note board: injected into every turn's recall context until it expires (default 7 days). Use when the user explicitly says 'remember this / 璁颁笅鏉?/ 鍒繕浜?. Expiry only removes it from the board; the memory stays searchable." },
        stickyDays: { type: "number", description: "Note-board TTL in days (default 7, only with sticky: true)" },
        authority: { type: "string", enum: ["user", "agent", "tool", "pipeline"], description: "Provenance authority (G1). Default 'agent'. Use 'user' ONLY for verbatim user statements; 'tool' for verifiable tool-returned facts; 'pipeline' is reserved for background pipelines." },
        sourceTraceIds: { type: "array", items: { type: "string" }, description: "Exact T1 source traces this memory was extracted from (copy the [trace:<id>] markers that support it, max 20). Unknown ids are ignored." },
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
    description: "Pin/unpin a memory to/from the disclosure layer (<user-profile>, permanent, for identity & long-term preferences), or stick/unstick it on the note board (<note-board>, time-limited, for user-commissioned reminders). Provide at least one of pinned / sticky.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory unit id (mem_...)" },
        pinned: { type: "boolean", description: "true to pin, false to unpin" },
        sticky: { type: "boolean", description: "true to stick/renew on the note board, false to remove from the board" },
        stickyDays: { type: "number", description: "Note-board TTL in days when sticky: true (default 7)" },
      },
      required: ["id"],
    },
  },
  {
    name: "mafw_get_memory",
    // schema ��ʵ��{success, memory} �ŷ� + ��ѡ latest/source��t1 ��֧��״��ͬ��success + t1��
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        memory: { type: "object" },
        latest: { type: "object" },
        source: { type: "object" },
        t1: { type: "object" },
      },
      required: ["success"],
    },
    description: "Fetch a memory's full content by id. Accepts mem_... / #mem-xxxxxx for Harmonic memories, t1:<traceId> for a permanent T1 verbatim turn, or legacy t1:<sessionTail>:<turnId>. Superseded memories include the latest version. Use this to expand a recall pointer before relying on it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Full memory id (mem_...) or 6-char pointer tail from a <recall> block" },
      },
      required: ["id"],
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
  // 鈹€鈹€ Manager tools 鈹€鈹€
  {
    name: "mafw_set_goal",
    description: "Create a new MAFW goal (Manager tool 鈥?must confirm with user first)",
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
        budget: {
          type: "object",
          description: "Turn/cost budget for the goal session (BudgetGuard hard-stop)",
          properties: { maxTurns: { type: "number" }, maxCostUsd: { type: "number" } },
        },
        taskType: { type: "string", enum: ["feature", "bugfix", "refactor", "research", "docs", "test", "other"], description: "D4b task type (optional declaration; the plan node's judgement in waves.taskType wins)." },
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
    outputSchema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        goals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              goalId: { type: "string" },
              phase: { type: "string" },
              round: {},
              verdict: {},
              updatedAt: {},
            },
            required: ["goalId"],
          },
        },
      },
      required: ["success", "goals"],
    },
    description: "List all active goals with their phase and verdict",
    inputSchema: { type: "object", properties: {} },
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
  // 鈹€鈹€ Tier 1: Read-only automation tools 鈹€鈹€
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
  // 鈹€鈹€ Tier 2: Safe action automation tools 鈹€鈹€
  {
    name: "mafw_run_automation",
    description: "Run a scan-type automation rule. Force auto_confirm=false 鈥?results always go to PENDING_CONFIRMATION for your review",
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
            type: { type: "string", enum: ["memory:decay", "memory:review", "memory:prune"], description: "Memory action type" },
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
  // 鈹€鈹€ Tier 3: Draft/Suggest automation tools 鈹€鈹€
  {
    name: "mafw_propose_triage_decision",
    description: "Attach your analysis and suggestion to a triage item. Item REMAINS PENDING_CONFIRMATION 鈥?the user sees your suggestion when they review triage items and can accept or override it",
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
            type: { type: "string", enum: ["memory:decay", "memory:review", "memory:prune"] },
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
  // 鈹€鈹€ Desktop GUI automation tools 鈹€鈹€
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
    description: "Restart the agent runtime (runtime serve). This will interrupt any in-flight prompts. Only works when the runtime supports agent process management (agentProcessApi=true).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mafw_lead_goal_status",
    description: "Read the project Lead goal-status projection: stage / progress / blockers / pending attention for active Goals. Read-only; does not read the Tech Lead transcript.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Registered project directory (defaults to MAFW_PROJECT_DIR/current)" },
        limit: { type: "number", description: "Maximum active Goals to return (default 5)" },
      },
    },
  },
  {
    name: "mafw_create_standing_goal",
    description: "Create a long-lived Standing Goal with cron/event/manual triggers. Every trigger becomes a GoalRun triaged by the Tech Lead.",
    inputSchema: {
      type: "object",
      properties: {
        projectDir: { type: "string", description: "Registered project directory" },
        title: { type: "string" },
        objective: { type: "string" },
        template: { type: "object" },
        triggers: { type: "array", items: { type: "object" } },
        concurrency: { type: "number" },
        cooldownMs: { type: "number" },
        budget: { type: "object" },
        approval: { type: "string", enum: ["auto", "plan", "confirm"] },
      },
      required: ["title", "objective", "triggers"],
    },
  },
  {
    name: "mafw_update_standing_goal",
    description: "Update a Standing Goal's triggers, budget, template or state.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        patch: { type: "object" },
      },
      required: ["id", "patch"],
    },
  },
  {
    name: "mafw_list_standing_goals",
    description: "List Standing Goals with last/next run information.",
    inputSchema: {
      type: "object",
      properties: { projectDir: { type: "string" } },
    },
  },
  {
    name: "mafw_run_standing_goal",
    description: "Manually trigger one Standing Goal run (force).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        payload: { type: "object" },
      },
      required: ["id"],
    },
  },
];

// MCP stable spec 注解物化（2026-10-22 spec §5.3）：模块加载期一次性从 mafw 专属表
// 派生（第二级，registry 定义无手工声明）——ListTools 请求路径零运行时开销。
// title 本批不填（registry 定义无 label 字段，YAGNI）。
for (const def of DEFINITIONS) {
  if (!def.annotations) def.annotations = annotationsForTool(def.name);
}

import { handleCreateGoal } from "./handlers/create-goal";
import { handleLeadGoalStatus } from "./handlers/lead-goal-status";
import {
  handleCreateStandingGoal,
  handleUpdateStandingGoal,
  handleListStandingGoals,
  handleRunStandingGoal,
} from "./handlers/standing-goals";
import { handlePodGoalDirection } from "./handlers/pod-goal-direction";
import { handleDecisionDraft } from "./handlers/decision-draft";
import { handlePodGoalContext } from "./handlers/pod-context-select";
import { handlePodReviewRespond } from "./handlers/pod-review-respond";
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
import { handleGetMemory } from "./handlers/get-memory";
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
import { handleManagerSetGoal } from "./handlers/manager-set-goal";
import { handleManagerGetGoalStatus } from "./handlers/manager-get-goal-status";
import { handleManagerListGoals } from "./handlers/manager-list-goals";
import { handleManagerGetEvidence } from "./handlers/manager-get-evidence";
import { handleManagerCancelGoal } from "./handlers/manager-cancel-goal";
import { handleManagerListPendingQuestions } from "./handlers/manager-list-pending-questions";

export function createToolRegistry(): ToolRegistry {
  const genericOutputSchema = { type: 'object', additionalProperties: true };
  return {
    definitions: DEFINITIONS.map((d) => d.outputSchema ? d : { ...d, outputSchema: genericOutputSchema }),
    handlers: {
      mafw_create_goal: handleCreateGoal,
  mafw_create_standing_goal: handleCreateStandingGoal,
  mafw_update_standing_goal: handleUpdateStandingGoal,
  mafw_list_standing_goals: handleListStandingGoals,
  mafw_run_standing_goal: handleRunStandingGoal,
      mafw_lead_goal_status: handleLeadGoalStatus,
      mafw_pod_goal_direction: handlePodGoalDirection,
      mafw_decision_draft: handleDecisionDraft,
      mafw_pod_goal_context: handlePodGoalContext,
      mafw_pod_review_respond: handlePodReviewRespond,
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
      mafw_get_memory: handleGetMemory,
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
      mafw_set_goal: handleManagerSetGoal,
      mafw_get_goal_status: handleManagerGetGoalStatus,
      mafw_list_goals: handleManagerListGoals,
      mafw_get_evidence: handleManagerGetEvidence,
      mafw_cancel_goal: handleManagerCancelGoal,
      mafw_list_pending_questions: handleManagerListPendingQuestions,
    },
  };
}
