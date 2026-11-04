import { normalizeMode, type SessionPermissionMode } from './approval/policy-service';
import type { ThinkingLevel } from '../runtime/contract';

export type SessionConfigCategory = 'mode' | 'agent' | 'model' | 'model_config' | 'thought_level';

export interface SessionConfigState {
  mode: SessionPermissionMode;
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  thinkingLevel?: ThinkingLevel;
  /** runtime 是否支持 thought_level（桌面会话菜单的 Thinking 行据此渲染禁用态）。 */
  thinkingLevelSupported: boolean;
}

export interface SessionConfigStored {
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  thinkingLevel?: ThinkingLevel;
}

export interface SessionConfigDeps {
  load(sessionID: string): SessionConfigStored | undefined;
  save(sessionID: string, state: SessionConfigStored): void;
  getMode(sessionID: string): Promise<SessionPermissionMode>;
  setMode(sessionID: string, mode: SessionPermissionMode): Promise<void>;
  getSession(sessionID: string): Promise<any>;
  switchAgent?(sessionID: string, agent: string): Promise<void>;
  switchModel?(sessionID: string, model: { providerID: string; modelID: string }, variant?: string): Promise<void>;
  setThinkingLevel?(sessionID: string, level: ThinkingLevel): Promise<void>;
  /** 活 runtime 是否支持 thought_level。**必须经契约面**（RuntimeAccess.can('session.setThinkingLevel')）
   *  注入——生产 wrapper 恒存在，dep-presence 与直接摸 runtime 属性都不可靠
   *  （2026-11-04 终审 Critical + 契约隔绝收口）。 */
  supportsThinkingLevel?(): boolean;
  emit(sessionID: string, state: SessionConfigState, category: SessionConfigCategory): void;
}

export class SessionConfigError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function normalizeModel(raw: any): { providerID: string; modelID: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const modelID = raw.modelID ?? raw.id;
  if (typeof raw.providerID !== 'string' || typeof modelID !== 'string') return undefined;
  return { providerID: raw.providerID, modelID };
}

export class SessionConfigService {
  constructor(private readonly deps: SessionConfigDeps) {}

  async get(sessionID: string): Promise<SessionConfigState> {
    const stored = this.deps.load(sessionID) ?? {};
    const mode = await this.deps.getMode(sessionID).catch(() => 'read-only' as SessionPermissionMode);
    let info: any;
    try { info = await this.deps.getSession(sessionID); } catch { info = undefined; }
    const model = normalizeModel(info?.model) ?? stored.model;
    const agent = typeof info?.agent === 'string' ? info.agent : stored.agent;
    return {
      mode,
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
      ...(stored.variant ? { variant: stored.variant } : {}),
      ...(stored.thinkingLevel ? { thinkingLevel: stored.thinkingLevel } : {}),
      thinkingLevelSupported: this.deps.supportsThinkingLevel
        ? this.deps.supportsThinkingLevel()
        : typeof this.deps.setThinkingLevel === 'function',
    };
  }

  async set(sessionID: string, category: SessionConfigCategory, value: any): Promise<SessionConfigState> {
    const stored = this.deps.load(sessionID) ?? {};
    let patch: SessionConfigStored = {};

    if (category === 'mode') {
      if (value !== 'read-only' && value !== 'auto' && value !== 'full-access' && value !== 'manual') {
        throw new SessionConfigError(400, "mode must be 'read-only'|'auto'|'full-access' ('manual' accepted as legacy alias)");
      }
      await this.deps.setMode(sessionID, normalizeMode(value));
    } else if (category === 'agent') {
      if (typeof value !== 'string' || !value.trim()) throw new SessionConfigError(400, 'agent must be a non-empty string');
      if (!this.deps.switchAgent) throw new SessionConfigError(503, 'runtime does not implement session.switchAgent');
      await this.deps.switchAgent(sessionID, value.trim());
      patch = { agent: value.trim() };
    } else if (category === 'model') {
      const model = normalizeModel(value);
      if (!model) throw new SessionConfigError(400, 'model.providerID/modelID required');
      if (!this.deps.switchModel) throw new SessionConfigError(503, 'runtime does not implement session.switchModel');
      const variant = typeof value?.variant === 'string' && value.variant ? value.variant : undefined;
      await this.deps.switchModel(sessionID, model, variant);
      patch = { model, ...(variant ? { variant } : {}) };
    } else if (category === 'model_config') {
      const variant = typeof value?.variant === 'string' && value.variant ? value.variant : undefined;
      if (!variant) throw new SessionConfigError(400, 'model_config.variant required');
      if (!this.deps.switchModel) throw new SessionConfigError(503, 'runtime does not implement session.switchModel');
      const current = normalizeModel((await this.deps.getSession(sessionID).catch(() => undefined))?.model) ?? stored.model;
      if (!current) throw new SessionConfigError(400, 'no current model; set category=model first');
      await this.deps.switchModel(sessionID, current, variant);
      patch = { model: current, variant };
    } else if (category === 'thought_level') {
      if (value === null) {
        // 清除回「默认」：只清配置层（展示/徽标），runtime 无通用 unset 原语，
        // 抹掉运行时档位会与 runtime 内部状态分裂——保留 runtime 现状，下次显式设定再同步。
        const next = { ...stored };
        delete next.thinkingLevel;
        this.deps.save(sessionID, next);
        const state = await this.get(sessionID);
        this.deps.emit(sessionID, state, category);
        return state;
      }
      if (typeof value !== 'string' || !THINKING_LEVELS.has(value)) {
        throw new SessionConfigError(400, `invalid thinkingLevel: ${String(value)}`);
      }
      if (!this.deps.setThinkingLevel) {
        throw new SessionConfigError(400, 'runtime does not support session.setThinkingLevel');
      }
      await this.deps.setThinkingLevel(sessionID, value as ThinkingLevel);
      patch = { thinkingLevel: value as ThinkingLevel };
    } else {
      throw new SessionConfigError(400, `unknown config category: ${String(category)}`);
    }

    if (Object.keys(patch).length > 0) this.deps.save(sessionID, { ...stored, ...patch });
    const state = await this.get(sessionID);
    this.deps.emit(sessionID, state, category);
    return state;
  }
}
