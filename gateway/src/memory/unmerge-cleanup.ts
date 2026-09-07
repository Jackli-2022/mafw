// Undo MinHash merge blobs: restore the superseded source units and delete
// the ' | '-concatenated merge products. Pure planning function (no IO) so
// the decision logic is unit-testable; the CLI in scripts/unmerge-blobs.ts
// executes the plan against ~/.mafw/memory.

export interface CleanupEntry {
  id: string;
  superseded_by?: string;
  merged_from?: string[];
  pinned?: boolean;
  energy?: number;
}

export interface CleanupPlan {
  /** Sources to un-supersede, with the energy to set. */
  restore: { id: string; energy: number }[];
  /** Blob unit ids to delete (file + index entry). */
  deleteBlobs: string[];
  /** Blobs kept with a human-readable reason. */
  keepBlobs: { id: string; reason: string }[];
  /** Sources referenced by kept blobs that no longer exist on disk. */
  missingSources: { blobId: string; sourceId: string }[];
}

const isBlob = (e?: CleanupEntry): boolean => !!e && (e.merged_from?.length ?? 0) > 0;

/** Restored energy: markSuperseded halved energy (floor 0.1) per supersede;
 *  the original is unrecoverable, so double with a floor/cap. */
export function restoredEnergy(current: number | undefined): number {
  return Math.min(0.9, Math.max(0.4, (current ?? 0.4) * 2));
}

export function planUnmerge(entries: CleanupEntry[], fileExists: (id: string) => boolean): CleanupPlan {
  const byId = new Map(entries.map(e => [e.id, e]));
  const blobs = entries.filter(isBlob);

  // Expand a blob's merged_from through intermediate blobs (merge chains;
  // consolidation mergeIntoNewer does not inherit ancestors).
  const closureSources = (blob: CleanupEntry): { sources: string[]; missing: string[] } => {
    const sources: string[] = [];
    const missing: string[] = [];
    const seen = new Set<string>([blob.id]);
    const queue = [...(blob.merged_from ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = byId.get(id);
      if (isBlob(e)) {
        queue.push(...(e!.merged_from ?? []));
        continue;
      }
      if (!e || !fileExists(id)) {
        missing.push(id);
        continue;
      }
      sources.push(id);
    }
    return { sources, missing };
  };

  // Pass 1: decide each blob's fate.
  const deleteSet = new Set<string>();
  const blobSources = new Map<string, string[]>();
  const keepBlobs: CleanupPlan['keepBlobs'] = [];
  const missingSources: CleanupPlan['missingSources'] = [];
  for (const blob of blobs) {
    if (blob.pinned) {
      keepBlobs.push({ id: blob.id, reason: 'pinned' });
      continue;
    }
    const { sources, missing } = closureSources(blob);
    if (missing.length > 0) {
      keepBlobs.push({ id: blob.id, reason: `missing sources: ${missing.length}` });
      for (const m of missing) missingSources.push({ blobId: blob.id, sourceId: m });
      continue;
    }
    deleteSet.add(blob.id);
    blobSources.set(blob.id, sources);
  }

  // Pass 2: restore sources superseded by a blob that is being deleted.
  // Never touch units superseded by a live non-blob unit (explicit
  // knowledge-update via mafw_add_memory supersedes / mafw_supersede_memory).
  const restore: CleanupPlan['restore'] = [];
  const restoredIds = new Set<string>();
  for (const blobId of deleteSet) {
    for (const srcId of blobSources.get(blobId)!) {
      if (restoredIds.has(srcId)) continue;
      const src = byId.get(srcId)!;
      if (!src.superseded_by) continue; // still live — nothing to undo
      if (!deleteSet.has(src.superseded_by)) continue; // superseded by something kept
      restoredIds.add(srcId);
      restore.push({ id: srcId, energy: restoredEnergy(src.energy) });
    }
  }

  return { restore, deleteBlobs: [...deleteSet], keepBlobs, missingSources };
}
