/**
 * JSON-only RPC between the gateway and an untrusted package worker.
 *
 * The protocol deliberately has no function serialization, no advanced
 * serialization and a hard message-size cap. Both sides validate every frame.
 */

export const MAX_WORKER_MESSAGE_BYTES = 1024 * 1024;

export type WorkerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type HostToWorker =
  | { t: 'invoke'; id: string; action: string; input: unknown; timeoutMs: number }
  | { t: 'shutdown' }
  // Host -> child responses for the child's config RPC.
  | { t: 'result'; id: string; ok: true; output: unknown }
  | { t: 'result'; id: string; ok: false; error: { message: string; code?: string } };

export type WorkerToHost =
  | {
    t: 'ready';
    name: string;
    version?: string;
    apiVersion: number;
    contributions: Record<string, unknown>;
  }
  | { t: 'result'; id: string; ok: true; output: unknown }
  | { t: 'result'; id: string; ok: false; error: { message: string; code?: string } }
  | { t: 'emit'; type: string; payload: unknown }
  | { t: 'log'; level: WorkerLogLevel; message: string }
  | { t: 'config.get'; id: string }
  | { t: 'config.update'; id: string; patch: Record<string, unknown> };

type AnyMessage = HostToWorker | WorkerToHost;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isLogLevel(value: unknown): value is WorkerLogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function normalize(raw: unknown): AnyMessage | null {
  if (!isPlainObject(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'invoke':
      if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.action)) return null;
      if (typeof raw.timeoutMs !== 'number' || !Number.isFinite(raw.timeoutMs)) return null;
      return { t: 'invoke', id: raw.id, action: raw.action, input: raw.input, timeoutMs: raw.timeoutMs };
    case 'shutdown':
      return { t: 'shutdown' };
    case 'ready':
      if (!isNonEmptyString(raw.name) || typeof raw.apiVersion !== 'number') return null;
      if (!isPlainObject(raw.contributions)) return null;
      return {
        t: 'ready',
        name: raw.name,
        ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
        apiVersion: raw.apiVersion,
        contributions: raw.contributions,
      };
    case 'result':
      if (!isNonEmptyString(raw.id) || typeof raw.ok !== 'boolean') return null;
      if (raw.ok) return { t: 'result', id: raw.id, ok: true, output: raw.output };
      if (!isPlainObject(raw.error) || !isNonEmptyString(raw.error.message)) return null;
      return {
        t: 'result',
        id: raw.id,
        ok: false,
        error: {
          message: raw.error.message,
          ...(typeof raw.error.code === 'string' ? { code: raw.error.code } : {}),
        },
      };
    case 'emit':
      if (!isNonEmptyString(raw.type)) return null;
      return { t: 'emit', type: raw.type, payload: raw.payload };
    case 'log':
      if (!isLogLevel(raw.level) || typeof raw.message !== 'string') return null;
      return { t: 'log', level: raw.level, message: raw.message };
    case 'config.get':
      if (!isNonEmptyString(raw.id)) return null;
      return { t: 'config.get', id: raw.id };
    case 'config.update':
      if (!isNonEmptyString(raw.id) || !isPlainObject(raw.patch)) return null;
      return { t: 'config.update', id: raw.id, patch: raw.patch };
    default:
      return null;
  }
}

/** Serializes a validated frame; returns '' for invalid or oversized messages. */
export function encodeWorkerMessage(message: AnyMessage): string {
  const normalized = normalize(message);
  if (!normalized) return '';
  const text = JSON.stringify(normalized);
  if (Buffer.byteLength(text, 'utf8') > MAX_WORKER_MESSAGE_BYTES) return '';
  return text;
}

/** Parses and validates a frame; returns null for malformed/unknown messages. */
export function decodeWorkerMessage(raw: unknown): AnyMessage | null {
  if (typeof raw !== 'string') return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_WORKER_MESSAGE_BYTES) return null;
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}
