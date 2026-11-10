import { PodError } from '../pod/pod-store';
import type { LeadTopicStore } from './lead-topic-store';
import { detectBoundary, type BoundaryProposal } from './topic-boundary';
import type { BoundaryStatus, TopicBoundaryRow, TopicBoundaryStore } from './topic-boundary-store';

export interface LeadBoundaryDeps {
  boundaries: TopicBoundaryStore;
  topics: Pick<LeadTopicStore, 'get' | 'insert'>;
  mode(): 'off' | 'observe' | 'on';
  broadcast?(event: { type: string; properties: Record<string, unknown> }): void;
  now(): string;
  newId(): string;
  log?(message: string): void;
}

export interface BoundaryDecision {
  status: 'accepted' | 'merged' | 'undone';
  toTopicId?: string;
}

export class LeadBoundaryService {
  constructor(private readonly deps: LeadBoundaryDeps) {}

  list(topicId: string): TopicBoundaryRow[] {
    return this.deps.boundaries.listByTopic(topicId);
  }

  observe(input: {
    projectDir: string;
    leadSessionId: string;
    fromTopicId: string;
    text: string;
    previousUserText?: string;
    now: string;
    goalActive: boolean;
    goalJustClosed?: boolean;
  }): BoundaryProposal | null {
    if (this.deps.mode() === 'off') return null;
    const proposal = detectBoundary(input);
    if (!proposal || proposal.confidence < 0.7) return null;

    const id = this.deps.newId();
    this.deps.boundaries.insert({
      id,
      projectDir: input.projectDir,
      leadSessionId: input.leadSessionId,
      fromTopicId: input.fromTopicId,
      toTopicId: null,
      trigger: proposal.trigger,
      confidence: proposal.confidence,
      status: 'proposed',
      createdAt: this.deps.now(),
    });
    if (this.deps.mode() === 'on') {
      this.deps.broadcast?.({
        type: 'topic.boundary.proposed',
        properties: { topicId: input.fromTopicId, boundaryId: id, confidence: proposal.confidence },
      });
    }
    return proposal;
  }

  accept(boundaryId: string): BoundaryDecision {
    const row = this.requireBoundary(boundaryId);
    if (row.status === 'accepted' && row.toTopicId) {
      return { status: 'accepted', toTopicId: row.toTopicId };
    }
    if (row.status !== 'proposed' && row.status !== 'accepted') {
      throw new PodError(409, `boundary is ${row.status}`);
    }
    const source = this.deps.topics.get(row.fromTopicId);
    if (!source) throw new PodError(404, `topic not found: ${row.fromTopicId}`);

    const now = this.deps.now();
    const toTopicId = this.deps.newId();
    this.deps.topics.insert({
      id: toTopicId,
      projectDir: source.projectDir,
      leadSessionId: source.leadSessionId,
      title: source.title,
      startMessageId: source.startMessageId,
      endMessageId: source.endMessageId,
      goalId: source.goalId,
      ownerRole: 'lead',
      ownerSessionId: source.leadSessionId,
      createdAt: now,
      summary: source.summary,
      state: 'resident',
      lastActiveAt: now,
    });
    this.deps.boundaries.updateStatus(row.id, 'accepted', toTopicId);
    return { status: 'accepted', toTopicId };
  }

  merge(boundaryId: string): BoundaryDecision {
    const row = this.requireBoundary(boundaryId);
    this.update(row, 'merged');
    return { status: 'merged' };
  }

  undo(boundaryId: string): BoundaryDecision {
    const row = this.requireBoundary(boundaryId);
    this.update(row, 'undone');
    return { status: 'undone' };
  }

  private update(row: TopicBoundaryRow, status: BoundaryStatus): void {
    if (row.status === status) return;
    this.deps.boundaries.updateStatus(row.id, status);
  }

  private requireBoundary(boundaryId: string): TopicBoundaryRow {
    const row = this.deps.boundaries.get(boundaryId);
    if (!row) throw new PodError(404, `boundary not found: ${boundaryId}`);
    return row;
  }
}
