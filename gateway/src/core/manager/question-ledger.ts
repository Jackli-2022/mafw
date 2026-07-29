import * as fs from 'fs';
import * as path from 'path';

export interface QuestionEvent {
  type: 'asked' | 'answered' | 'cancelled' | 'orphaned';
  questionId: string;
  goalId: string;
  node?: 'plan' | 'review';
  loop?: number;
  questions?: string[];
  askedAt?: string;
  answer?: string;
  answeredAt?: string;
  cancelledAt?: string;
  orphanedAt?: string;
  reason?: string;
}

export type QuestionState = 'pending' | 'answered' | 'cancelled' | 'orphaned';

export interface QuestionRecord {
  questionId: string;
  goalId: string;
  node: string;
  loop: number;
  questions: string[];
  askedAt: string;
  state: QuestionState;
  answer?: string;
  answeredAt?: string;
}

export class QuestionLedger {
  private ledgerPath: string;

  constructor(mafwDir: string) {
    this.ledgerPath = path.join(mafwDir, 'question-ledger.jsonl');
  }

  appendQuestionEvent(event: QuestionEvent): void {
    const dir = path.dirname(this.ledgerPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.ledgerPath, JSON.stringify(event) + '\n', 'utf-8');
  }

  getQuestionState(questionId: string): QuestionState | null {
    if (!fs.existsSync(this.ledgerPath)) return null;
    const lines = fs.readFileSync(this.ledgerPath, 'utf-8').trim().split('\n');
    let lastEvent: QuestionEvent | null = null;
    for (const line of lines) {
      try {
        const evt: QuestionEvent = JSON.parse(line);
        if (evt.questionId === questionId) lastEvent = evt;
      } catch {}
    }
    if (!lastEvent) return null;
    switch (lastEvent.type) {
      case 'asked': return 'pending';
      case 'answered': return 'answered';
      case 'cancelled': return 'cancelled';
      case 'orphaned': return 'orphaned';
      default: return null;
    }
  }

  listPendingQuestions(goalId?: string): QuestionRecord[] {
    if (!fs.existsSync(this.ledgerPath)) return [];
    const events: QuestionEvent[] = [];
    const lines = fs.readFileSync(this.ledgerPath, 'utf-8').trim().split('\n');
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch {}
    }

    const lastByQid = new Map<string, QuestionEvent>();
    for (const evt of events) {
      lastByQid.set(evt.questionId, evt);
    }

    const pending: QuestionRecord[] = [];
    for (const evt of events) {
      if (evt.type === 'asked') {
        if (goalId && evt.goalId !== goalId) continue;
        const last = lastByQid.get(evt.questionId);
        if (last && last.type === 'asked') {
          pending.push({
            questionId: evt.questionId,
            goalId: evt.goalId,
            node: evt.node || 'plan',
            loop: evt.loop || 0,
            questions: evt.questions || [],
            askedAt: evt.askedAt || '',
            state: 'pending',
          });
        }
      }
    }
    return pending;
  }

  bootReconcile(activeCheckpoints: Set<string>): void {
    const pending = this.listPendingQuestions();
    for (const q of pending) {
      if (!activeCheckpoints.has(q.goalId)) {
        this.appendQuestionEvent({
          type: 'orphaned',
          questionId: q.questionId,
          goalId: q.goalId,
          orphanedAt: new Date().toISOString(),
          reason: 'checkpoint not found during boot reconcile',
        });
      }
    }
  }
}
