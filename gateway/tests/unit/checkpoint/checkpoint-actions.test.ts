import { projectCheckpointActions, type CheckpointActionInput } from '../../../src/core/checkpoint/checkpoint-actions';

function access(semantics: Record<string, any> = {}) {
  return {
    semantics: (id: string) => semantics[id] ?? {},
  } as any;
}

const cp = (over: Partial<CheckpointActionInput> = {}): CheckpointActionInput => ({
  id: 'cp1',
  anchorMessageID: 'm1',
  snapshotTree: 'tree1',
  filesKnown: true,
  files: [{ patch: '@@ -1 +1 @@\n-a\n+b' }],
  ...over,
});

describe('projectCheckpointActions', () => {
  it('disables everything while the session is busy', () => {
    const a = projectCheckpointActions(cp(), { access: access(), busy: true, targets: [cp()] });
    expect(a.restoreConversation).toMatchObject({ enabled: false, reason: 'busy' });
    expect(a.restoreFiles).toMatchObject({ enabled: false, reason: 'busy' });
  });

  it('enables files restore for a server snapshot with no undo semantics', () => {
    const a = projectCheckpointActions(cp(), {
      access: access({ 'branch.revert': { files: true, undo: false } }),
      busy: false,
      targets: [cp()],
    });
    expect(a.restoreConversation.enabled).toBe(true);
    expect(a.restoreFiles.enabled).toBe(true);
    expect(a.restoreBoth.warningKey).toBe('restore-conversation-files-no-undo');
  });

  it('reports missing-data when no snapshot/files information exists', () => {
    const a = projectCheckpointActions(cp({ snapshotTree: null, filesKnown: false, files: undefined }), {
      access: access(), busy: false, targets: [cp({ snapshotTree: null, filesKnown: false, files: undefined })],
    });
    expect(a.restoreConversation.enabled).toBe(true);
    expect(a.restoreFiles).toMatchObject({ enabled: false, reason: 'missing-data' });
  });

  it('refuses non-invertible patches across every target turn', () => {
    const a = projectCheckpointActions(cp(), {
      access: access(), busy: false,
      targets: [cp(), cp({ id: 'cp2', snapshotTree: null, files: [{ patch: 'new file mode 100644\n@@ -0,0 +1 @@\n+x' }] })],
    });
    expect(a.restoreFiles).toMatchObject({ enabled: false, reason: 'non-invertible-patch' });
  });

  it('uses undo semantics for warning keys', () => {
    const a = projectCheckpointActions(cp(), {
      access: access({ 'branch.revert': { files: true, undo: true } }), busy: false, targets: [cp()],
    });
    expect(a.restoreBoth.warningKey).toBe('restore-conversation-files-undoable');
  });
});
