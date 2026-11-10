/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode snapshot-repo lookup moved to `adapters/opencode/src/snapshot.ts`
 * (`@mafw/adapter-opencode`). Gateway call sites keep their old import path
 * until Task 7 removes the shim.
 */
export {
  createOpenCodeSnapshotTreeChannel,
  defaultSnapshotRoot,
  findOpenCodeSnapshotRepo,
} from '@mafw/adapter-opencode';
