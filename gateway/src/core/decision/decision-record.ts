export type DecisionKind =
  | 'direction'
  | 'plan'
  | 'scope'
  | 'authorization'
  | 'acceptance'
  | 'priority'
  | 'disposition'
  | 'other';

export type DecisionRecordStatus = 'draft' | 'decided' | 'shelved';

export interface DecisionRecordOption {
  id: string;
  title: string;
  summary?: string;
  risks?: string[];
}

export interface DecisionRecordEvidence {
  kind: 'message' | 'file' | 'change' | 'review_item' | 'goal';
  ref: string;
  label?: string;
}

export interface DecisionRecordHistoryEntry {
  action: 'drafted' | 'confirmed' | 'shelved' | 'reopened';
  by: 'agent' | 'user';
  at: string;
  note?: string;
}

export interface DecisionRecord {
  id: string;
  projectDir: string;
  goalId: string | null;
  revision: number | null;
  kind: DecisionKind;
  status: DecisionRecordStatus;
  question: string;
  options: DecisionRecordOption[];
  evidence: DecisionRecordEvidence[];
  rationale: string | null;
  consequences: string | null;
  reviewAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: DecisionRecordHistoryEntry[];
}

export interface DecisionRecordEvent {
  action: 'drafted' | 'confirmed' | 'shelved' | 'reopened';
  projectDir: string;
  goalId: string | null;
  revision: number | null;
  recordId: string;
  /** Full record after the write (E6-3); clients patch in place from this. */
  record: DecisionRecord;
}

export interface DecisionDraftInput {
  projectDir: string;
  goalId?: string | null;
  revision?: number | null;
  kind: DecisionKind;
  question: string;
  options?: DecisionRecordOption[];
  evidence?: DecisionRecordEvidence[];
  rationale?: string | null;
  consequences?: string | null;
  reviewAt?: string | null;
  /** Who authored the draft; defaults to agent. */
  source?: 'agent' | 'user';
}

export interface DecisionConfirmInput {
  projectDir: string;
  rationale?: string;
  consequences?: string;
  reviewAt?: string;
}

export interface DecisionShelveInput {
  projectDir: string;
  reviewAt: string;
  note?: string;
}

export interface DecisionReopenInput {
  projectDir: string;
  note?: string;
}
