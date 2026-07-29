import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { QuestionLedger } = require('../../../gateway/src/core/manager/question-ledger');

describe('QuestionLedger', () => {
  let tmpDir: string;
  let ledgerPath: string;
  let ledger: InstanceType<typeof QuestionLedger>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'question-ledger-test-'));
    ledger = new QuestionLedger(tmpDir);
    ledgerPath = path.join(tmpDir, 'question-ledger.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('appendQuestionEvent', () => {
    it('creates the JSONL file on first append', () => {
      ledger.appendQuestionEvent({
        type: 'asked',
        questionId: 'q1',
        goalId: 'g1',
        node: 'plan',
        loop: 1,
        questions: ['What is your name?'],
        askedAt: new Date().toISOString(),
      });
      expect(fs.existsSync(ledgerPath)).toBe(true);
      const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(1);
    });

    it('appends multiple events to the file', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q?'], askedAt: now });
      ledger.appendQuestionEvent({ type: 'answered', questionId: 'q1', answer: '42', answeredAt: now });
      const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  describe('getQuestionState', () => {
    it('returns null when no events exist for questionId', () => {
      expect(ledger.getQuestionState('q-nonexistent')).toBeNull();
    });

    it('returns null when the ledger file does not exist', () => {
      const freshLedger = new QuestionLedger(path.join(tmpDir, 'nonexistent'));
      expect(freshLedger.getQuestionState('q1')).toBeNull();
    });

    it('returns pending after an asked event', () => {
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q?'], askedAt: new Date().toISOString() });
      expect(ledger.getQuestionState('q1')).toBe('pending');
    });

    it('returns answered after an answered event', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q?'], askedAt: now });
      ledger.appendQuestionEvent({ type: 'answered', questionId: 'q1', answer: 'yes', answeredAt: now });
      expect(ledger.getQuestionState('q1')).toBe('answered');
    });

    it('returns cancelled after a cancelled event', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q?'], askedAt: now });
      ledger.appendQuestionEvent({ type: 'cancelled', questionId: 'q1', cancelledAt: now });
      expect(ledger.getQuestionState('q1')).toBe('cancelled');
    });

    it('returns orphaned after an orphaned event', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q?'], askedAt: now });
      ledger.appendQuestionEvent({ type: 'orphaned', questionId: 'q1', orphanedAt: now });
      expect(ledger.getQuestionState('q1')).toBe('orphaned');
    });
  });

  describe('listPendingQuestions', () => {
    it('returns empty array when no events exist', () => {
      expect(ledger.listPendingQuestions()).toEqual([]);
    });

    it('returns empty array when no file exists', () => {
      const freshLedger = new QuestionLedger(path.join(tmpDir, 'empty-dir'));
      expect(freshLedger.listPendingQuestions()).toEqual([]);
    });

    it('returns pending questions only', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q1?'], askedAt: now });
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q2', goalId: 'g1', node: 'review', loop: 1, questions: ['Q2?'], askedAt: now });
      ledger.appendQuestionEvent({ type: 'answered', questionId: 'q2', answer: 'ok', answeredAt: now });
      const pending = ledger.listPendingQuestions();
      expect(pending).toHaveLength(1);
      expect(pending[0].questionId).toBe('q1');
      expect(pending[0].state).toBe('pending');
    });

    it('filters by goalId when provided', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q1?'], askedAt: now });
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q2', goalId: 'g2', node: 'plan', loop: 1, questions: ['Q2?'], askedAt: now });
      const pendingG1 = ledger.listPendingQuestions('g1');
      expect(pendingG1).toHaveLength(1);
      expect(pendingG1[0].questionId).toBe('q1');
    });
  });

  describe('bootReconcile', () => {
    it('orphans pending questions whose goalId is not in activeCheckpoints', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q?'], askedAt: now });
      ledger.bootReconcile(new Set(['g2']));
      expect(ledger.getQuestionState('q1')).toBe('orphaned');
    });

    it('leaves pending questions whose goalId is in activeCheckpoints', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'asked', questionId: 'q1', goalId: 'g1', node: 'plan', loop: 1, questions: ['Q?'], askedAt: now });
      ledger.bootReconcile(new Set(['g1']));
      expect(ledger.getQuestionState('q1')).toBe('pending');
    });

    it('does nothing when no pending questions exist', () => {
      const now = new Date().toISOString();
      ledger.appendQuestionEvent({ type: 'answered', questionId: 'q1', goalId: 'g1', answer: 'done', answeredAt: now });
      ledger.bootReconcile(new Set(['g2']));
      expect(ledger.getQuestionState('q1')).toBe('answered');
    });
  });
});
