# DEGRADED Components

These components are below 80% test coverage and marked degraded per AGENTS.md §3.2.
The authoritative metric is **statement/line coverage** from `npm test -- --coverage`.

## Files with statement/line coverage below 80%

- `gateway/src/index.ts` scheduler integration paths (require real OpenCode Serve)
- `src/plugin.ts` command/tool/hook wiring and TUI integration
- `src/compression/compression-verifier.ts` verification rules
- `src/compression/memory-index.ts` index compaction and eviction paths
- `src/engine/goal-worktree-manager.ts` full worktree lifecycle and error paths
- `src/engine/lesson-manager.ts` lesson compaction and L2 operations
- `src/engine/task-branch-manager.ts` merge conflict and cleanup paths
- `src/memory/extractor.ts` delta extraction logic
- `src/memory/injector.ts` delta rejection and token-limit edge cases
- `src/memory/store.ts` persistent L2/L3 memory disk operations
- `src/skills/mafw-plan/entry.ts` LLM failure and fallback paths

## Files with no executed coverage (0%)

- `bin/mafw-gateway.js` CLI and Windows service registration (requires elevated shell)
- `bin/mafw-uninstall.js` uninstall helper script
- `gateway/src/automation-engine.ts`
- `gateway/src/health.ts`
- `gateway/src/heartbeat.ts`
- `gateway/src/ledger.ts`
- `gateway/src/loop-monitor.ts`
- `gateway/src/metrics/collector.ts`
- `gateway/src/poll.ts`
- `gateway/src/recovery.ts`
- `gateway/src/session-manager.ts`
- `src/index.ts`
- `src/engine/degradation.ts`
- `src/engine/report-generator.ts`
- `src/engine/wave-executor.ts`
- `src/hooks/tool-executed.ts`
- `src/memory/matcher.ts`
- `src/memory/merger.ts`
- `src/memory/validator.ts`
- `src/tools/archive-worktree.ts`
- `src/tools/run-execute-wave.ts`
- `src/tools/run-plan.ts`
- `src/tools/run-review.ts`
- `src/tools/write-lesson.ts`
- `src/utils/github.ts`

## Notes

- `src/compression/lesson-compactor.ts`, `src/compression/session-pruner.ts`, `gateway/src/dashboard/server.ts`, `src/skills/mafw-goal/entry.ts`, `src/skills/mafw-review/entry.ts`, `src/tools/remote-cli.ts`, and `src/utils/git.ts` now exceed the 80% line-coverage threshold and are no longer listed here.
- Global coverage remains below 80%; this is expected while the degraded components above are still under test.
