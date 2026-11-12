import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { renameWithRetry } from '../utils/atomic-write';
import type {
  DecisionConfirmInput,
  DecisionDraftInput,
  DecisionKind,
  DecisionRecord,
  DecisionRecordEvidence,
  DecisionRecordOption,
  DecisionReopenInput,
  DecisionShelveInput,
} from './decision-record';

const KINDS = new Set<DecisionKind>([
  'direction', 'plan', 'scope', 'authorization', 'acceptance', 'priority', 'disposition', 'other',
]);
const EVIDENCE_KINDS = new Set(['message', 'file', 'change', 'review_item', 'goal']);
const MAX_QUESTION = 500;
const MAX_TEXT = 4000;
const MAX_OPTIONS = 8;
const MAX_EVIDENCE = 12;

export class DecisionRecordError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DecisionRecordError';
  }
}

export interface DecisionRecordServiceDeps {
  mafwDir(projectDir: string): string | null;
  now?: () => string;
  id?: () => string;
}

/** Registry keys are stored raw; compare canonically so case/trailing-separator
 *  differences do not turn a registered project into a 503. */
export function findMafwDirForProject(
  entries: Iterable<readonly [string, { mafwDir: string }]>,
  projectDir: string,
  canonicalize: (value: string) => string,
): string | null {
  const canonical = canonicalize(projectDir);
  for (const [registered, info] of entries) {
    if (canonicalize(registered) === canonical) return info.mafwDir;
  }
  return null;
}

function requireText(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new DecisionRecordError(400, `${field} is required`);
  if (text.length > max) throw new DecisionRecordError(400, `${field} is too long`);
  return text;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new DecisionRecordError(400, `${field} must be a string`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new DecisionRecordError(400, `${field} is too long`);
  return text;
}

function dateText(value: unknown, field: string, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new DecisionRecordError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new DecisionRecordError(400, `${field} must be a date string`);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new DecisionRecordError(400, `${field} is not a valid date`);
  return new Date(time).toISOString();
}

function normalizeKind(value: unknown): DecisionKind {
  if (typeof value !== 'string' || !KINDS.has(value as DecisionKind)) {
    throw new DecisionRecordError(400, 'kind is invalid');
  }
  return value as DecisionKind;
}

function normalizeOptions(value: unknown): DecisionRecordOption[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DecisionRecordError(400, 'options must be an array');
  if (value.length > MAX_OPTIONS) throw new DecisionRecordError(400, 'options is too long');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new DecisionRecordError(400, `options[${index}] is invalid`);
    const option = entry as Record<string, unknown>;
    return {
      id: requireText(option.id, `options[${index}].id`, 80),
      title: requireText(option.title, `options[${index}].title`, 200),
      ...(option.summary !== undefined ? { summary: optionalText(option.summary, `options[${index}].summary`, MAX_TEXT) ?? undefined } : {}),
      ...(option.risks !== undefined
        ? {
            risks: Array.isArray(option.risks)
              ? option.risks.map((risk) => requireText(risk, `options[${index}].risks`, 300))
              : (() => { throw new DecisionRecordError(400, `options[${index}].risks must be an array`); })(),
          }
        : {}),
    };
  });
}

function normalizeEvidence(value: unknown): DecisionRecordEvidence[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DecisionRecordError(400, 'evidence must be an array');
  if (value.length > MAX_EVIDENCE) throw new DecisionRecordError(400, 'evidence is too long');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new DecisionRecordError(400, `evidence[${index}] is invalid`);
    const item = entry as Record<string, unknown>;
    const kind = typeof item.kind === 'string' ? item.kind : '';
    if (!EVIDENCE_KINDS.has(kind)) throw new DecisionRecordError(400, `evidence[${index}].kind is invalid`);
    return {
      kind: kind as DecisionRecordEvidence['kind'],
      ref: requireText(item.ref, `evidence[${index}].ref`, 1000),
      ...(item.label !== undefined ? { label: optionalText(item.label, `evidence[${index}].label`, 200) ?? undefined } : {}),
    };
  });
}

function normalizeRevision(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new DecisionRecordError(400, 'revision must be a positive integer');
  }
  return Number(value);
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new DecisionRecordError(400, 'decision id is invalid');
  return id;
}

/**
 * Append-only decision records under `<project>/.mafw/decisions/<id>.json`.
 * Drafts come from agents; only human routes may confirm, shelve or reopen.
 */
export class DecisionRecordService {
  constructor(private readonly deps: DecisionRecordServiceDeps) {}

  private now(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private id(): string {
    return this.deps.id?.() ?? `dec_${randomUUID()}`;
  }

  private dir(projectDir: string): string {
    const mafwDir = this.deps.mafwDir(projectDir);
    if (!mafwDir) throw new DecisionRecordError(503, 'project is not registered');
    return path.join(mafwDir, 'decisions');
  }

  private file(projectDir: string, id: string): string {
    return path.join(this.dir(projectDir), `${safeId(id)}.json`);
  }

  private read(projectDir: string, id: string): DecisionRecord {
    const file = this.file(projectDir, id);
    if (!fs.existsSync(file)) throw new DecisionRecordError(404, 'decision not found');
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as DecisionRecord;
    } catch {
      throw new DecisionRecordError(500, 'decision record is unreadable');
    }
  }

  private write(projectDir: string, record: DecisionRecord): DecisionRecord {
    const file = this.file(projectDir, record.id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
    renameWithRetry(tmp, file);
    return record;
  }

  list(projectDir: string, goalId?: string): DecisionRecord[] {
    let dir: string;
    try {
      dir = this.dir(projectDir);
    } catch {
      return [];
    }
    if (!fs.existsSync(dir)) return [];
    const items: DecisionRecord[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')) as DecisionRecord;
        if (!record || typeof record.id !== 'string') continue;
        if (goalId && record.goalId !== goalId) continue;
        items.push(record);
      } catch {
        /* ignore unreadable records */
      }
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  draft(input: DecisionDraftInput): DecisionRecord {
    const projectDir = requireText(input.projectDir, 'projectDir', 1000);
    const at = this.now();
    const record: DecisionRecord = {
      id: this.id(),
      projectDir,
      goalId: optionalText(input.goalId, 'goalId', 200),
      revision: normalizeRevision(input.revision),
      kind: normalizeKind(input.kind),
      status: 'draft',
      question: requireText(input.question, 'question', MAX_QUESTION),
      options: normalizeOptions(input.options),
      evidence: normalizeEvidence(input.evidence),
      rationale: optionalText(input.rationale, 'rationale', MAX_TEXT),
      consequences: optionalText(input.consequences, 'consequences', MAX_TEXT),
      reviewAt: dateText(input.reviewAt, 'reviewAt', false),
      decidedBy: null,
      decidedAt: null,
      createdAt: at,
      updatedAt: at,
      history: [{ action: 'drafted', by: 'agent', at }],
    };
    return this.write(projectDir, record);
  }

  confirm(id: string, input: DecisionConfirmInput): DecisionRecord {
    const projectDir = requireText(input.projectDir, 'projectDir', 1000);
    const record = this.read(projectDir, id);
    if (record.status !== 'draft') {
      throw new DecisionRecordError(409, 'only a draft can be confirmed');
    }
    const at = this.now();
    const next: DecisionRecord = {
      ...record,
      status: 'decided',
      rationale: optionalText(input.rationale, 'rationale', MAX_TEXT) ?? record.rationale,
      consequences: optionalText(input.consequences, 'consequences', MAX_TEXT) ?? record.consequences,
      reviewAt: dateText(input.reviewAt, 'reviewAt', false) ?? record.reviewAt,
      decidedBy: 'user',
      decidedAt: at,
      updatedAt: at,
      history: [...record.history, { action: 'confirmed', by: 'user', at }],
    };
    return this.write(projectDir, next);
  }

  shelve(id: string, input: DecisionShelveInput): DecisionRecord {
    const projectDir = requireText(input.projectDir, 'projectDir', 1000);
    const record = this.read(projectDir, id);
    if (record.status !== 'draft') {
      throw new DecisionRecordError(409, 'only a draft can be shelved');
    }
    const at = this.now();
    const reviewAt = dateText(input.reviewAt, 'reviewAt', true)!;
    const note = optionalText(input.note, 'note', MAX_TEXT);
    const next: DecisionRecord = {
      ...record,
      status: 'shelved',
      reviewAt,
      updatedAt: at,
      history: [...record.history, { action: 'shelved', by: 'user', at, ...(note ? { note } : {}) }],
    };
    return this.write(projectDir, next);
  }

  reopen(id: string, input: DecisionReopenInput): DecisionRecord {
    const projectDir = requireText(input.projectDir, 'projectDir', 1000);
    const record = this.read(projectDir, id);
    if (record.status !== 'decided' && record.status !== 'shelved') {
      throw new DecisionRecordError(409, 'only a decided or shelved record can be reopened');
    }
    const at = this.now();
    const note = optionalText(input.note, 'note', MAX_TEXT);
    const next: DecisionRecord = {
      ...record,
      status: 'draft',
      decidedBy: null,
      decidedAt: null,
      updatedAt: at,
      history: [...record.history, { action: 'reopened', by: 'user', at, ...(note ? { note } : {}) }],
    };
    return this.write(projectDir, next);
  }
}
