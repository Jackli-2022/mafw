import * as path from 'path';
import { ToolHandler } from '../../types';
import { HarmonicUnitFileStore } from '../../memory/harmonic-file-store';
import { matchAbstraction } from '../../memory/abstraction-matcher';
import { generateHarmonicId } from '../../core/memory/harmonic-types';

export const handleResolveMerge: ToolHandler = async (args, { memory }) => {
  try {
    const conflictingId = args.conflictingId as string;
    const newAbstraction = args.newAbstraction as string;
    const action = args.action as 'merge' | 'link' | 'abstract';

    if (!conflictingId || !newAbstraction || !action) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'conflictingId, newAbstraction, and action required' }) }], isError: true };
    }

    const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
    const mafwDir = path.join(projectDir, '.mafw');
    const store = new HarmonicUnitFileStore(mafwDir);

    const existing = await store.read(conflictingId);
    if (!existing) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unit ${conflictingId} not found` }) }], isError: true };
    }

    const match = matchAbstraction(newAbstraction, existing.primary_abstraction);

    if (action === 'merge') {
      existing.memory_value = existing.memory_value + '\n---\n(' + newAbstraction + ' merge)';
      existing.merged_from = [...(existing.merged_from || []), conflictingId + '-merged'];
      existing.updated_at = new Date().toISOString();
      await store.write(existing);
    } else if (action === 'link') {
      existing.memory_value = existing.memory_value + `\n\nRelated: [[${newAbstraction}]]`;
      existing.updated_at = new Date().toISOString();
      await store.write(existing);
    } else if (action === 'abstract') {
      const parentId = generateHarmonicId();
      const parent: import('../../core/memory/harmonic-types').HarmonicUnit = {
        id: parentId,
        type: 'semantic',
        granularity: 'architecture',
        primary_abstraction: newAbstraction,
        cue_anchors: [...existing.cue_anchors],
        memory_value: `Merged from [[${existing.id}]] and [[${conflictingId}-merged]]`,
        energy: Math.min(1.0, existing.energy + 0.1),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        merged_from: [existing.id, conflictingId],
      };
      await store.write(parent);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, action, similarity: match.similarity }) }],
    };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
