/**
 * T2-3 DataPartService —— 校验 + assistant 承载 + overlay 持久化 + 广播。
 *
 * 语义（spec §5.3）：messageID 缺省=最新 assistant（user 消息不渲染 parts，
 * 会造永久不可见行）；同 id 固定消息归属（跨消息 409）；transient 不入库且
 * 删除同 id 持久行（防重载复活旧值）。
 */
import type { SessionDataPartRow } from '../../memory/gateway-db';
import {
  DATA_PART_MAX_BYTES,
  dataSizeBytes,
  isDataPartId,
  isDataPartName,
  normalizeDataPartId,
  type DataPart,
} from './data-part';

export class DataPartError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DataPartError';
  }
}

export interface DataPartServiceDeps {
  db: {
    upsertSessionDataPart(row: SessionDataPartRow): void;
    getSessionDataPart(sessionId: string, id: string): SessionDataPartRow | undefined;
    deleteSessionDataPart(sessionId: string, id: string): void;
    pruneSessionDataParts(sessionId: string, keep: number): number;
    deleteSessionDataParts(sessionId: string): void;
  };
  runtime(): {
    session: { messages(opts: { sessionID: string; limit?: number }): Promise<{ data: any[] }> };
  } | null;
  broadcast(event: { type: string; [key: string]: any }): void;
  now(): string;
}

const KEEP = 200;

function roleOf(m: any): string | undefined {
  if (typeof m?.role === 'string') return m.role;
  if (m?.type === 'user' || m?.type === 'assistant') return m.type;
  return undefined;
}

function createdOf(m: any): number {
  const v = m?.time?.created;
  return typeof v === 'number' ? v : 0;
}

export class DataPartService {
  constructor(private deps: DataPartServiceDeps) {}

  async create(input: {
    sessionID: string;
    name: unknown;
    id?: unknown;
    data: unknown;
    transient?: boolean;
    messageID?: unknown;
  }): Promise<DataPart> {
    if (!isDataPartName(input.name)) {
      throw new DataPartError(400, 'name must match [a-z0-9][a-z0-9_-]{0,31}');
    }
    const size = dataSizeBytes(input.data);
    if (!Number.isFinite(size) || size > DATA_PART_MAX_BYTES) {
      throw new DataPartError(400, `data must be JSON-serializable and <= ${DATA_PART_MAX_BYTES} bytes`);
    }

    const resolved = await this.resolveMessage(input.sessionID, input.messageID);
    const messageID = resolved.messageID;
    const normalizedId = typeof input.id === 'string' && input.id ? input.id : undefined;
    if (normalizedId && !isDataPartId(normalizedId)) {
      throw new DataPartError(400, 'id must match [A-Za-z0-9._:-]{1,64}');
    }
    const id = normalizeDataPartId(normalizedId);

    const existing = this.deps.db.getSessionDataPart(input.sessionID, id);
    if (existing && existing.message_id !== messageID) {
      // 目标消息已被 revert/压缩时允许重新绑定；仍存在则禁止跨消息移动。
      if (resolved.messageIds.has(existing.message_id)) {
        throw new DataPartError(409, `data part id already bound to message ${existing.message_id}`);
      }
      this.deps.db.deleteSessionDataPart(input.sessionID, id);
    }

    const now = this.deps.now();
    const transient = input.transient === true;
    if (transient) {
      // transient 覆盖：删除旧持久值，避免重载历史复活旧数据。
      if (existing) this.deps.db.deleteSessionDataPart(input.sessionID, id);
    } else {
      this.deps.db.upsertSessionDataPart({
        session_id: input.sessionID,
        id,
        message_id: messageID,
        type: `data-${input.name}`,
        data_json: JSON.stringify(input.data ?? null),
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
      this.deps.db.pruneSessionDataParts(input.sessionID, KEEP);
    }

    const part: DataPart = {
      id,
      type: `data-${input.name}` as `data-${string}`,
      data: input.data ?? null,
      // 显式布尔：transient→persistent 的同 id 更新必须清掉旧的 true（review #1）。
      transient,
      sessionID: input.sessionID,
      messageID,
    };
    this.deps.broadcast({
      type: 'part.updated',
      properties: { part },
      sessionID: input.sessionID,
    });
    return part;
  }

  /** 会话删除联动（fail-open 由调用侧兜底）。 */
  deleteForSession(sessionID: string): void {
    this.deps.db.deleteSessionDataParts(sessionID);
  }

  private async resolveMessage(
    sessionID: string,
    explicit: unknown,
  ): Promise<{ messageID: string; messageIds: Set<string> }> {
    const rt = this.deps.runtime();
    if (!rt) throw new DataPartError(503, 'runtime not available');
    const res = await rt.session.messages({ sessionID, limit: 200 });
    const messages = Array.isArray(res?.data) ? res.data : [];
    const messageIds = new Set(
      messages.map((m) => m?.id).filter((id): id is string => typeof id === 'string' && !!id),
    );

    if (typeof explicit === 'string' && explicit) {
      const found = messages.find((m) => m?.id === explicit);
      if (!found) throw new DataPartError(404, `message not found: ${explicit}`);
      if (roleOf(found) !== 'assistant') {
        throw new DataPartError(400, 'data parts can only attach to assistant messages');
      }
      return { messageID: explicit, messageIds };
    }

    const assistants = messages
      .filter((m) => m && typeof m === 'object' && roleOf(m) === 'assistant' && typeof m.id === 'string')
      .sort((a, b) => createdOf(b) - createdOf(a));
    if (assistants.length === 0) {
      throw new DataPartError(400, 'session has no assistant message to attach to');
    }
    return { messageID: assistants[0].id, messageIds };
  }
}
