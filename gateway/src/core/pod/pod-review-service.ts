// Goal review items (Plan C): human opinions attached to one revision.
// The store owns rows; this service owns the status machine and authority checks.
import {
  PodError,
  type PodGoalAcceptanceRow,
  type PodReviewItemRow,
  type PodReviewItemStatus,
  type PodReviewSource,
  type PodStore,
} from './pod-store';

export const MAX_REVIEW_ITEMS = 50;
const MAX_REL = 1000;
const MAX_COMMENT = 4000;
const MAX_CODE = 20000;
const MAX_ANCHOR = 8000;
const MAX_SOURCE = 16 * 1024;
const MAX_CLIENT_REF = 200;
const MAX_RESPONSE = 4000;
const MAX_NOTE = 2000;
/** Keep a batch under the route's JSON cap while allowing large single snapshots. */
const MAX_BATCH_CHARS = 256 * 1024;

export type PodReviewAnchor =
  | { kind: 'quote'; quote: string }
  | { kind: 'jsonPath'; path: string; valueSummary: string }
  | { kind: 'cell'; sheet?: string; ref: string; value: string }
  | { kind: 'region'; x: number; y: number; w: number; h: number; slide?: number };

export interface PodReviewItem {
  id: string;
  podId: string;
  goalId: string;
  revision: number;
  status: PodReviewItemStatus;
  rel: string;
  startLine: number | null;
  endLine: number | null;
  code: string;
  comment: string;
  anchor: PodReviewAnchor | null;
  source: PodReviewSource | null;
  clientRef: string | null;
  response: string | null;
  originItemId: string | null;
  originRevision: number | null;
  createdAt: string;
  updatedAt: string;
  respondedAt: string | null;
  resolvedAt: string | null;
}

export interface PodReviewItemInput {
  rel: string;
  startLine?: number | null;
  endLine?: number | null;
  code?: string;
  comment: string;
  anchor?: PodReviewAnchor;
  source?: PodReviewSource;
  clientRef?: string;
}

export interface PodReviewServiceDeps {
  store: PodStore;
  now(): string;
  notify?(podId: string, kind?: string, goalId?: string): void;
  assertTechLeadSession(goalId: string, sessionID: string): void;
  /** True while accept/reject holds the Goal mutation lock. */
  isGoalMutating?(podId: string, goalId: string): boolean;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAnchor(raw: string | null): PodReviewAnchor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as PodReviewAnchor : null;
  } catch {
    return null;
  }
}

function toItem(row: PodReviewItemRow): PodReviewItem {
  return {
    id: row.id,
    podId: row.podId,
    goalId: row.goalId,
    revision: row.revision,
    status: row.status,
    rel: row.rel,
    startLine: row.startLine,
    endLine: row.endLine,
    code: row.code,
    comment: row.comment,
    anchor: parseAnchor(row.anchorJson),
    source: row.source,
    clientRef: row.clientRef,
    response: row.response,
    originItemId: row.originItemId,
    originRevision: row.originRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    respondedAt: row.respondedAt,
    resolvedAt: row.resolvedAt,
  };
}

function requireText(value: unknown, field: string, max: number): string {
  const text = clean(value);
  if (!text) throw new PodError(400, `${field} is required`);
  if (text.length > max) throw new PodError(400, `${field} is too long`);
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (text.length > max) throw new PodError(400, `${field} is too long`);
  return text || null;
}

function normalizeSource(raw: unknown): { source: PodReviewSource; json: string } | null {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PodError(400, 'source must be an object');
  }
  const input = raw as Record<string, unknown>;
  const projectDir = requireText(input.projectDir, 'source.projectDir', 1000);
  const root = requireText(input.root, 'source.root', 1000);
  const contentVersion = optionalText(input.contentVersion, 'source.contentVersion', 500);
  let source: PodReviewSource;
  if (input.kind === 'project') {
    source = { kind: 'project', projectDir, root, contentVersion };
  } else if (input.kind === 'goal') {
    const goalId = requireText(input.goalId, 'source.goalId', 300);
    const revision = Number(input.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new PodError(400, 'source.revision must be a positive integer');
    }
    source = { kind: 'goal', projectDir, goalId, revision, root, contentVersion };
  } else {
    throw new PodError(400, 'source.kind must be project or goal');
  }
  const json = JSON.stringify(source);
  if (json.length > MAX_SOURCE) throw new PodError(400, 'source is too large');
  return { source, json };
}

export class PodReviewService {
  constructor(private readonly deps: PodReviewServiceDeps) {}

  createItems(
    podId: string,
    goalId: string,
    input: { revision?: number; items: PodReviewItemInput[] },
  ): PodReviewItem[] {
    const goal = this.requireGoal(podId, goalId);
    const revision = input.revision ?? goal.activeRevision;
    if (!Number.isInteger(revision) || revision < 1) {
      throw new PodError(400, 'revision must be a positive integer');
    }
    if (revision !== goal.activeRevision) {
      throw new PodError(409, `review items can only target the active revision (${goal.activeRevision})`);
    }
    this.ensureMutable(podId, goalId, revision);
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new PodError(400, 'items are required');
    }
    if (input.items.length > MAX_REVIEW_ITEMS) {
      throw new PodError(400, `at most ${MAX_REVIEW_ITEMS} review items per request`);
    }

    const seenRefs = new Set<string>();
    const prepared = input.items.map((item) => {
      const rel = requireText(item?.rel, 'rel', MAX_REL);
      const comment = requireText(item?.comment, 'comment', MAX_COMMENT);
      const code = optionalText(item?.code, 'code', MAX_CODE) ?? '';
      const startLine = this.optionalLine(item?.startLine, 'startLine');
      const endLine = this.optionalLine(item?.endLine, 'endLine');
      if (startLine != null && endLine != null && endLine < startLine) {
        throw new PodError(400, 'endLine must be >= startLine');
      }
      const anchorJson = item?.anchor ? JSON.stringify(item.anchor) : null;
      if (anchorJson && anchorJson.length > MAX_ANCHOR) {
        throw new PodError(400, 'anchor is too large');
      }
      const source = normalizeSource(item?.source);
      if (source?.source.kind === 'goal') {
        if (source.source.goalId !== goalId || source.source.revision !== revision) {
          throw new PodError(
            409,
            `review source ${source.source.goalId}#${source.source.revision} does not match target ${goalId}#${revision}`,
          );
        }
      }
      const clientRef = optionalText(item?.clientRef, 'clientRef', MAX_CLIENT_REF);
      if (clientRef) {
        if (seenRefs.has(clientRef)) throw new PodError(400, `duplicate clientRef: ${clientRef}`);
        seenRefs.add(clientRef);
      }
      return {
        rel, comment, code, startLine, endLine, anchorJson,
        sourceJson: source?.json ?? null, clientRef,
      };
    });
    const totalChars = prepared.reduce(
      (sum, item) => sum + item.rel.length + item.comment.length + item.code.length
        + (item.anchorJson?.length ?? 0) + (item.sourceJson?.length ?? 0) + (item.clientRef?.length ?? 0),
      0,
    );
    if (totalChars > MAX_BATCH_CHARS) {
      throw new PodError(400, 'review item batch is too large');
    }

    // Validate the whole batch before writing. Retries reuse rows by clientRef,
    // so a lost HTTP response cannot duplicate items or their created events.
    let createdCount = 0;
    const created = this.deps.store.transaction(() => {
      const rows: PodReviewItem[] = [];
      for (const item of prepared) {
        if (item.clientRef) {
          const existing = this.deps.store.findReviewItemByClientRef(
            podId, goalId, revision, item.clientRef,
          );
          if (existing) {
            rows.push(toItem(existing));
            continue;
          }
        }
        const row = this.deps.store.createReviewItem({
          podId, goalId, revision, rel: item.rel, startLine: item.startLine,
          endLine: item.endLine, code: item.code, comment: item.comment,
          anchorJson: item.anchorJson, sourceJson: item.sourceJson,
          clientRef: item.clientRef, now: this.deps.now(),
        });
        this.deps.store.appendReviewItemEvent({
          podId, goalId, revision, itemId: row.id, kind: 'created',
          payloadJson: row.originItemId ? JSON.stringify({ originItemId: row.originItemId }) : null,
          now: this.deps.now(),
        });
        createdCount++;
        rows.push(toItem(row));
      }
      return rows;
    });
    if (createdCount > 0) this.deps.notify?.(podId, 'review', goalId);
    return created;
  }

  list(
    podId: string,
    goalId: string,
    opts: { revision?: number } = {},
  ): { revision: number; items: PodReviewItem[] } {
    const goal = this.requireGoal(podId, goalId);
    const revision = opts.revision ?? goal.activeRevision;
    if (!Number.isInteger(revision) || revision < 1) {
      throw new PodError(400, 'revision must be a positive integer');
    }
    return {
      revision,
      items: this.deps.store.listReviewItems(podId, goalId, revision).map(toItem),
    };
  }

  respond(
    podId: string,
    goalId: string,
    itemId: string,
    input: { sessionID: string; response: string },
  ): PodReviewItem {
    const sessionID = clean(input?.sessionID);
    if (!sessionID) throw new PodError(403, 'tech lead session is required');
    this.deps.assertTechLeadSession(goalId, sessionID);
    const response = requireText(input?.response, 'response', MAX_RESPONSE);
    const item = this.requireActiveItem(podId, goalId, itemId);
    this.ensureMutable(podId, goalId, item.revision);
    const applied = this.deps.store.transaction(() => {
      const ok = this.deps.store.setReviewItemStatus({
        podId, goalId, itemId,
        from: ['pending', 'responded'], to: 'responded',
        response, now: this.deps.now(),
      });
      if (!ok) return false;
      this.deps.store.appendReviewItemEvent({
        podId, goalId, revision: item.revision, itemId, kind: 'responded',
        payloadJson: JSON.stringify({ response }), now: this.deps.now(),
      });
      return true;
    });
    if (!applied) throw new PodError(409, 'review item is already resolved');
    this.deps.notify?.(podId, 'review', goalId);
    return this.requireItem(podId, goalId, itemId);
  }

  resolve(podId: string, goalId: string, itemId: string, opts: { note?: string } = {}): PodReviewItem {
    const item = this.requireActiveItem(podId, goalId, itemId);
    this.ensureMutable(podId, goalId, item.revision);
    const applied = this.deps.store.transaction(() => {
      const ok = this.deps.store.setReviewItemStatus({
        podId, goalId, itemId,
        from: ['pending', 'responded'], to: 'resolved',
        now: this.deps.now(),
      });
      if (!ok) return false;
      this.appendNoteEvent(podId, goalId, item.revision, itemId, 'resolved', opts.note);
      return true;
    });
    if (!applied) throw new PodError(409, 'review item is already resolved');
    this.deps.notify?.(podId, 'review', goalId);
    return this.requireItem(podId, goalId, itemId);
  }

  reopen(podId: string, goalId: string, itemId: string, opts: { note?: string } = {}): PodReviewItem {
    const item = this.requireActiveItem(podId, goalId, itemId);
    this.ensureMutable(podId, goalId, item.revision);
    const applied = this.deps.store.transaction(() => {
      const ok = this.deps.store.setReviewItemStatus({
        podId, goalId, itemId,
        from: ['responded', 'resolved'], to: 'pending',
        now: this.deps.now(),
      });
      if (!ok) return false;
      this.appendNoteEvent(podId, goalId, item.revision, itemId, 'reopened', opts.note);
      return true;
    });
    if (!applied) throw new PodError(409, 'review item is already pending');
    this.deps.notify?.(podId, 'review', goalId);
    return this.requireItem(podId, goalId, itemId);
  }

  unresolved(podId: string, goalId: string, revision: number): PodReviewItem[] {
    return this.deps.store.listUnresolvedReviewItems(podId, goalId, revision).map(toItem);
  }

  acceptance(podId: string, goalId: string, revision: number): PodGoalAcceptanceRow | null {
    return this.deps.store.getGoalAcceptance(podId, goalId, revision);
  }

  recordAcceptance(input: {
    podId: string;
    goalId: string;
    revision: number;
    unresolvedItemIds: string[];
    forced: boolean;
    riskAcknowledged: boolean;
    mergeCommit: string | null;
  }): PodGoalAcceptanceRow {
    return this.deps.store.recordGoalAcceptance({
      ...input,
      now: this.deps.now(),
    });
  }

  private requireGoal(podId: string, goalId: string) {
    const goal = this.deps.store.getGoal(podId, goalId);
    if (!goal) throw new PodError(404, `goal not found: ${goalId}`);
    return goal;
  }

  private requireItem(podId: string, goalId: string, itemId: string): PodReviewItem {
    const row = this.deps.store.getReviewItem(itemId);
    if (!row || row.podId !== podId || row.goalId !== goalId) {
      throw new PodError(404, `review item not found: ${itemId}`);
    }
    return toItem(row);
  }

  private requireActiveItem(podId: string, goalId: string, itemId: string): PodReviewItem {
    const goal = this.requireGoal(podId, goalId);
    const item = this.requireItem(podId, goalId, itemId);
    if (item.revision !== goal.activeRevision) {
      throw new PodError(409, 'review items from a previous revision are read-only');
    }
    return item;
  }

  private ensureMutable(podId: string, goalId: string, revision: number): void {
    if (this.deps.isGoalMutating?.(podId, goalId)) {
      throw new PodError(409, 'goal acceptance/rejection is in progress; review items are temporarily read-only');
    }
    if (this.deps.store.getGoalAcceptance(podId, goalId, revision)) {
      throw new PodError(409, 'review items are frozen after acceptance');
    }
    // Legacy revisions accepted before Plan C have no acceptance row; the
    // merged worktree is the durable truth that the revision is closed.
    if (this.deps.store.getGoalWorktree(podId, goalId, revision)?.status === 'merged') {
      throw new PodError(409, 'review items are frozen after acceptance');
    }
  }

  private appendNoteEvent(
    podId: string,
    goalId: string,
    revision: number,
    itemId: string,
    kind: 'resolved' | 'reopened',
    note: string | undefined,
  ): void {
    const text = optionalText(note, 'note', MAX_NOTE);
    this.deps.store.appendReviewItemEvent({
      podId, goalId, revision, itemId, kind,
      payloadJson: text ? JSON.stringify({ note: text }) : null,
      now: this.deps.now(),
    });
  }

  private optionalLine(value: unknown, field: string): number | null {
    if (value === undefined || value === null) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new PodError(400, `${field} must be a positive integer`);
    return n;
  }
}
