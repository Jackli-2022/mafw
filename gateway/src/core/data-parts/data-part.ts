/**
 * T2-3 data part 校验工具（AI SDK 6 语义：`data-<name>` + id 调和 + transient）。
 *
 * id 统一 `data_` 前缀且 session 作用域——与 runtime part id（prt_/msg_…-pN）
 * 不可能碰撞；同一 body.id 归一后稳定，供同 id 渐进更新。
 */
import { randomUUID } from 'crypto';

export const DATA_PART_PREFIX = 'data-';
export const DATA_PART_MAX_BYTES = 65_536;

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export interface DataPart {
  id: string;
  type: `data-${string}`;
  data: unknown;
  transient?: boolean;
  sessionID?: string;
  messageID?: string;
  native?: Record<string, unknown>;
}

export function isDataPartType(type: string): boolean {
  if (typeof type !== 'string' || !type.startsWith(DATA_PART_PREFIX)) return false;
  return NAME_RE.test(type.slice(DATA_PART_PREFIX.length));
}

export function dataPartNameOf(type: string): string | null {
  return isDataPartType(type) ? type.slice(DATA_PART_PREFIX.length) : null;
}

export function isDataPart(part: unknown): part is DataPart {
  if (part === null || typeof part !== 'object') return false;
  const p = part as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) return false;
  if (typeof p.type !== 'string' || !isDataPartType(p.type)) return false;
  return 'data' in p;
}

/** body.id → 最终 part id（缺省生成；非法字符替换；稳定幂等）。 */
export function normalizeDataPartId(
  raw?: string,
  idFactory: () => string = () => randomUUID(),
): string {
  const base = typeof raw === 'string' && raw.trim() ? raw.trim() : idFactory();
  const safe = base
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .slice(0, 64);
  const cleaned = ID_RE.test(safe) ? safe : `id-${safe}`;
  return cleaned.startsWith('data_') ? cleaned : `data_${cleaned}`;
}

export function isDataPartName(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name);
}

export function isDataPartId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

/** JSON 序列化后的 UTF-8 字节数（不可序列化按 Infinity）。 */
export function dataSizeBytes(data: unknown): number {
  if (data === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
