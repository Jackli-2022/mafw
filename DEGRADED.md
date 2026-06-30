# DEGRADED Components

These components are below 80% test coverage and marked degraded per AGENTS.md §3.2:

- `gateway/src/index.ts` scheduler integration paths (require real OpenCode Serve)
- `bin/mafw-gateway.js` Windows service registration (requires elevated shell)
- `src/skills/mafw-execute/entry.ts` LLM-driven code generation paths
- `src/skills/mafw-review/entry.ts` LLM-driven review paths
- `src/memory/store.ts` persistent L2/L3 memory disk operations
- `src/compression/memory-index.ts` index compaction and eviction paths
- `src/engine/goal-worktree-manager.ts` full worktree lifecycle and error paths
- `src/engine/task-branch-manager.ts` merge conflict and cleanup paths
- `src/utils/state.ts` degraded state and file-lock fallback paths
- `src/skills/mafw-plan/entry.ts` LLM failure and fallback paths
- `src/memory/injector.ts` delta rejection and token-limit edge cases
- `src/engine/phase-orchestrator.ts` retry and recovery branches
