import { PodError } from '../pod/pod-store';
import type { LeadTopicStore } from './lead-topic-store';
import { detectBoundary, type BoundaryProposal } from './topic-boundary';
import type { BoundaryStatus, TopicBoundaryRow, TopicBoundaryStore } from './topic-boundary-store';

export interface LeadBoundaryDeps {
  boundaries: TopicBoundaryStore;
  topics: Pick<LeadTopicStore, 'get' | 'insert' | 'setState'>;
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

const PROPOSE_THRESHOLD = 0.5;
const DEDUPE_WINDOW_MS = 10 * 60_000;

function splitTitle(text: string, fallback: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, 40) : fallback;
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
    lastActiveAt?: string;
    now: string;
    goalActive: boolean;
    goalJustClosed?: boolean;
  }): BoundaryProposal | null {
    if (this.deps.mode() === 'off') return null;
    const proposal = detectBoundary(input);
    if (!proposal || proposal.confidence < PROPOSE_THRESHOLD) return null;

    const since = new Date(Date.parse(input.now) - DEDUPE_WINDOW_MS).toISOString();
    if (this.deps.boundaries.latestProposed(input.fromTopicId, since)) {
      return null;
    }

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
      text: input.text,
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

  /**
   * Accept splits at the current topic tail: the source keeps its transcript
   * and is parked cold, while the new topic starts after the last message.
   * Nothing from the source is copied except the boundary anchor.
   */
  accept(topicId: string, boundaryId: string): BoundaryDecision {
    const row = this.requireBoundary(topicId, boundaryId);
    if (row.status === 'accepted' && row.toTopicId) {
      return { status: 'accepted', toTopicId: row.toTopicId };
    }
    if (row.status !== 'proposed') {
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
      title: splitTitle(row.text, `${source.title}（新话题）`),
      startMessageId: source.endMessageId,
      endMessageId: source.endMessageId,
      goalId: '',
      ownerRole: 'lead',
      ownerSessionId: source.leadSessionId,
      createdAt: now,
      summary: null,
      state: 'resident',
      lastActiveAt: now,
    });
    this.deps.topics.setState(source.id, 'cold', now);
    this.deps.boundaries.updateStatus(row.id, 'accepted', toTopicId);
    return { status: 'accepted', toTopicId };
  }

  merge(topicId: string, boundaryId: string): BoundaryDecision {
    const row = this.requireBoundary(topicId, boundaryId);
    if (row.status === 'accepted') {
      throw new PodError(409, 'accepted boundary already split the topic');
    }
    this.update(row, 'merged');
    return { status: 'merged' };
  }

  undo(topicId: string, boundaryId: string): BoundaryDecision {
    const row = this.requireBoundary(topicId, boundaryId);
    if (row.status === 'accepted') {
      throw new PodError(409, 'accepted boundary cannot be undone');
    }
    this.update(row, 'undone');
    return { status: 'undone' };
  }

  private update(row: TopicBoundaryRow, status: BoundaryStatus): void {
    if (row.status === status) return;
    this.deps.boundaries.updateStatus(row.id, status);
  }

  private requireBoundary(topicId: string, boundaryId: string): TopicBoundaryRow {
    if (!topicId || !boundaryId) throw new PodError(400, 'topic and boundary ids are required');
    const row = this.deps.boundaries.get(boundaryId);
    if (!row || row.fromTopicId !== topicId) {
      throw new PodError(404, `boundary not found: ${boundaryId}`);
    }
    return row;
  }
}
