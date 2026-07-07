### Task 1: 文件 Checkpointer

Create `src/langgraph/checkpointer.ts` — a file-based `BaseCheckpointSaver` implementation for LangGraph.

Files:
- Create: `src/langgraph/checkpointer.ts`
- Create: `tests/unit/langgraph/checkpointer.test.ts`

Requirements:
- Extends `BaseCheckpointSaver` from `@langchain/langgraph`
- Implements `get()`, `put()`, `list()` methods
- Stores checkpoints as JSON files at `{baseDir}/checkpoints/{thread_id}/step_{N}.json`
- Stores metadata at `{baseDir}/checkpoints/{thread_id}/metadata.json`
- Has a `getCurrentState(threadId)` method that returns `{round, phase, verdict, lastError}`

Complete test code is in the plan at `docs/superpowers/plans/2026-07-07-langgraph-deep-integration.md` under Task 1, Step 1.

Note: The `serde` parameter in `BaseCheckpointSaver` constructor. Check what version of BaseCheckpointSaver is available — it may require passing a serde parameter. If so, use `super({ serialize: JSON.stringify, deserialize: JSON.parse })` or similar. (Note: the `BaseCheckpointSaver` in `@langchain/langgraph` v1.4.7 may not require this — just call `super()`.)

Run tests after implementation. Commit with message: `feat(langgraph): add FileCheckpointer for persistent checkpoints`
