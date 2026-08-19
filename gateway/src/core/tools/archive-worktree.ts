import { log } from '../utils/logger';
/**
 * Archive Worktree Tool —Archive tool 鍑芥暟
 *
 * 鑱岃矗锛?
 *   1. 鍚堝苟 Goal 鍒嗘敮鍒?main
 *   2. 浠?worktree 鎻愬彇鐙湁璁板繂鍒颁富椤圭洰
 *   3. 鐢熸垚鎶ュ憡
 *   4. 鏇存柊 STATUS.md
 *   5. 娓呯悊涓存椂璧勬簮
 *
 * 琚?Scheduler 鍦?ARCHIVE 闃舵璋冪敤銆?
 */

import * as fs from 'fs';
import * as path from 'path';
import { GoalWorktreeManager, WorktreeInfo } from '../engine/goal-worktree-manager';
import { MinHashMerger } from '../memory/minhash-merger';
import { generateHarmonicId } from '../memory/harmonic-types';

export interface ArchiveContext {
  goalId: string;
  projectDir: string;
  loopCount: number;
}

export interface FusionResult {
  added: number;
  conflicts: number;
  fusionLog: boolean;
}

/**
 * 鎵ц Archive 娴佺▼
 */
export async function archiveWorktree(context: ArchiveContext): Promise<void> {
  const { goalId, projectDir, loopCount } = context;

  log.info(`[archive-worktree] Archiving goal ${goalId}`);

  const worktreeManager = new GoalWorktreeManager(projectDir);
  const info = await worktreeManager.getCurrentInfo(goalId);

  // 1. 鍦?git 鍚堝苟鍓嶏紝浠?worktree 鎻愬彇鐙湁璁板繂
  let fusionResult: FusionResult | null = null;
  if (info.worktreeDir !== projectDir) {
    fusionResult = await mergeMemoryFromWorktree(info.worktreeDir, projectDir);
    if (fusionResult.added > 0 || fusionResult.conflicts > 0) {
      log.info(`[archive-worktree] Memory fusion: ${fusionResult.added} added, ${fusionResult.conflicts} conflicts`);
    }
  }

  // 2. 鍚堝苟 Goal 鍒嗘敮鍒?main
  try {
    await worktreeManager.archive(info, 'merge');
    log.info(`[archive-worktree] Merged goal/${goalId} into main`);
  } catch (err: any) {
    log.error(`[archive-worktree] Merge failed: ${err.message}`);
    throw err;
  }

  // 3. 鐢熸垚鎶ュ憡
  await generateReport(goalId, projectDir, loopCount, fusionResult);

  // 4. 鏇存柊 STATUS.md
  updateStatusArchive(goalId, projectDir);

  log.info(`[archive-worktree] Goal ${goalId} archived successfully`);
}

/**
 * 浠?worktree 鎻愬彇鐙湁璁板繂鍒颁富椤圭洰
 */
export async function mergeMemoryFromWorktree(
  sourceDir: string,
  targetDir: string,
): Promise<FusionResult> {
  const sourceMafw = path.join(sourceDir, '.mafw');
  const targetMafw = path.join(targetDir, '.mafw');
  const { HarmonicUnitFileStore } = await import('../../memory/harmonic-file-store.js');

  // Read the source worktree's memories via the harmonic index + OKF store
  // (the legacy `memory/memories.json` layout was replaced by OKF + index and
  // is deleted by the data-dir migration, so reading it would silently no-op).
  const sourceStore = new HarmonicUnitFileStore(sourceMafw);
  const sourceIndex = sourceStore.indexManager_().getIndex();
  if (sourceIndex.entries.length === 0) {
    return { added: 0, conflicts: 0, fusionLog: false };
  }

  const sourceUnits: any[] = [];
  for (const entry of sourceIndex.entries) {
    const unit = await sourceStore.read(entry.id);
    if (unit) sourceUnits.push(unit);
  }
  if (sourceUnits.length === 0) {
    return { added: 0, conflicts: 0, fusionLog: false };
  }

  const store = new HarmonicUnitFileStore(targetMafw);
  const minhash = new MinHashMerger();
  const targetIndex = store.indexManager_().getIndex();
  let added = 0;
  let conflicts = 0;

  for (const srcUnit of sourceUnits) {
    if (srcUnit.type === 'episodic') continue;
    const srcSig = minhash.generateSignature(srcUnit.primary_abstraction || '');
    let bestSim = 0;
    for (const tgtEntry of targetIndex.entries) {
      const tgtSig = minhash.generateSignature(tgtEntry.primary_abstraction || '');
      const sim = minhash.similarity(srcSig, tgtSig);
      if (sim > bestSim) bestSim = sim;
    }
    if (bestSim > 0.6) {
      conflicts++;
    } else {
      const origId = srcUnit.id;
      srcUnit.id = generateHarmonicId();
      srcUnit.energy = 0.4;
      srcUnit.merged_from = [origId];
      const now = new Date().toISOString();
      srcUnit.created_at = now;
      srcUnit.updated_at = now;
      await store.write(srcUnit);
      added++;
    }
  }

  if (added > 0 || conflicts > 0) {
    const fusionLogPath = path.join(targetMafw, 'fusion-log.jsonl');
    const logEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      source_worktree: sourceDir,
      added,
      conflicts,
    });
    fs.appendFileSync(fusionLogPath, logEntry + '\n', 'utf-8');
    return { added, conflicts, fusionLog: true };
  }

  return { added: 0, conflicts: 0, fusionLog: false };
}

/**
 * 鐢熸垚鎶ュ憡锛堝惈铻嶅悎缁撴灉锛?
 */
async function generateReport(goalId: string, projectDir: string, loopCount: number, fusion?: FusionResult | null): Promise<void> {
  const reportsDir = path.join(projectDir, '.mafw/reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  let fusionSection = '';
  if (fusion && (fusion.added > 0 || fusion.conflicts > 0)) {
    fusionSection = `
## Memory Fusion

- New memories extracted: ${fusion.added}
- Conflicts detected: ${fusion.conflicts}
- Fusion log: .mafw/fusion-log.jsonl
`;
  }

  const reportPath = path.join(reportsDir, `${goalId}.md`);
  const report = `# Report: ${goalId}

## Summary

- Goal: ${goalId}
- Loops: ${loopCount}
- Status: COMPLETED
- Completed: ${new Date().toISOString()}

## Artifacts

- Plan: waves.json
- Receipts: receipts/${goalId}/
- Reviews: reviews/${goalId}-loop*.md
## Notes

Goal completed successfully after ${loopCount} loop(s).
${fusionSection}`;

  fs.writeFileSync(reportPath, report, 'utf-8');
  log.info(`[archive-worktree] Report generated: ${reportPath}`);
}

/**
 * 鏇存柊 STATUS.md 涓?COMPLETED
 */
function updateStatusArchive(goalId: string, projectDir: string): void {
  const statusPath = path.join(projectDir, '.mafw/STATUS.md');
  
  if (!fs.existsSync(statusPath)) {
    return;
  }

  const content = fs.readFileSync(statusPath, 'utf-8');
  // 鏇存柊瀵瑰簲 Goal 鐨勭姸鎬?
  const updated = content.replace(
    new RegExp(`(goalId: "${goalId}"[\s\S]*?state:) "[^"]*"`, 'g'),
    `$1 "COMPLETED"`
  );
  
  fs.writeFileSync(statusPath, updated, 'utf-8');
  log.info(`[archive-worktree] STATUS.md updated for ${goalId}`);
}



