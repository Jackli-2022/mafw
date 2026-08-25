import { UsageProvider, UsageWindow, Severity, WindowType } from './types';
import { readOpencodeAuth } from '../media/auth-util';
import { log } from '../core/utils/logger';

export interface ExternalAdapter {
  name: string;
  fetch(): Promise<UsageProvider | null>;
}

function makeBalanceWindow(used: number, limit: number, remaining?: number): UsageWindow {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  return {
    window: 'balance',
    used: Math.round(used * 100) / 100,
    limit: Math.round(limit * 100) / 100,
    unit: '$',
    pct,
    remaining: remaining !== undefined ? Math.round(remaining * 100) / 100 : undefined,
  };
}

function severity(pct: number): Severity {
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'high';
  if (pct >= 50) return 'mid';
  return 'low';
}

/** DeepSeek — official: GET /user/balance (CNY). */
export class DeepSeekAdapter implements ExternalAdapter {
  name = 'deepseek';

  async fetch(): Promise<UsageProvider | null> {
    const auth = readOpencodeAuth();
    const key = auth['deepseek']?.key;
    if (!key) return null;

    try {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[DeepSeekAdapter] HTTP ${res.status}`);
        return null;
      }
      const data = await res.json() as any;
      const infos = data?.balance_infos;
      if (!Array.isArray(infos) || infos.length === 0) return null;

      const CNY_TO_USD = 0.14;
      let remaining = 0;
      let totalEver = 0;
      for (const info of infos) {
        const bal = parseFloat(info.total_balance) || 0;
        const granted = parseFloat(info.granted_balance) || 0;
        const toppedUp = parseFloat(info.topped_up_balance) || 0;
        const rate = info.currency === 'CNY' ? CNY_TO_USD : 1;
        remaining += bal * rate;
        totalEver += (granted + toppedUp) * rate;
      }

      if (remaining <= 0 && totalEver <= 0) return null;

      const used = Math.max(0, totalEver - remaining);
      const limit = totalEver > 0 ? totalEver : 0;
      const windows: UsageWindow[] = [makeBalanceWindow(used, limit, remaining)];

      return {
        name: 'deepseek',
        plan: 'prepaid',
        windows,
        severity: severity(windows[0].pct),
      };
    } catch (err: any) {
      log.warn(`[DeepSeekAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

/** Kimi / Moonshot — official: GET /v1/users/me/balance. */
export class KimiAdapter implements ExternalAdapter {
  name = 'kimi';

  async fetch(): Promise<UsageProvider | null> {
    const auth = readOpencodeAuth();
    const key = auth['kimi']?.key || auth['moonshot']?.key;
    if (!key) return null;

    try {
      const res = await fetch('https://api.moonshot.cn/v1/users/me/balance', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[KimiAdapter] HTTP ${res.status}`);
        return null;
      }
      const data = await res.json() as any;
      const d = data?.data;
      if (!d) return null;

      const available = parseFloat(d.available_balance) || 0;
      const voucher = parseFloat(d.voucher_balance) || 0;
      const cash = parseFloat(d.cash_balance) || 0;

      if (available <= 0) return null;

      // Kimi has no "total ever" from the API — only remaining balance.
      // Show as balance-only (no limit) unless user configures a budget.
      const windows: UsageWindow[] = [makeBalanceWindow(0, 0, available)];

      return {
        name: 'kimi',
        plan: 'prepaid',
        windows,
        severity: 'low',
      };
    } catch (err: any) {
      log.warn(`[KimiAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

/** OpenRouter — official: GET /api/v1/key (usage + limit). */
export class OpenRouterAdapter implements ExternalAdapter {
  name = 'openrouter';

  async fetch(): Promise<UsageProvider | null> {
    const auth = readOpencodeAuth();
    const key = auth['openrouter']?.key;
    if (!key) return null;

    try {
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[OpenRouterAdapter] HTTP ${res.status}`);
        return null;
      }
      const data = await res.json() as any;
      const d = data?.data;
      if (!d) return null;

      const limitRemaining = d.limit_remaining;
      const limit = d.limit;
      const usage = d.usage || 0;

      if (limit == null && limitRemaining == null) {
        return {
          name: 'openrouter',
          plan: 'prepaid',
          windows: [makeBalanceWindow(usage, 0, limitRemaining)],
          severity: 'low',
        };
      }

      const remaining = limitRemaining ?? 0;
      const totalLimit = limit ?? (remaining + usage);
      const used = totalLimit - remaining;
      const windows: UsageWindow[] = [makeBalanceWindow(used, totalLimit, remaining)];

      return {
        name: 'openrouter',
        plan: 'prepaid',
        windows,
        severity: severity(windows[0].pct),
      };
    } catch (err: any) {
      log.warn(`[OpenRouterAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

/** OpenCode Go — official: GET https://opencode.ai/zen/go/v1/usage (rolling 5h / weekly / monthly). */
export class OpencodeGoAdapter implements ExternalAdapter {
  name = 'opencode-go';

  async fetch(): Promise<UsageProvider | null> {
    const auth = readOpencodeAuth();
    const key = auth['opencode-go']?.key || auth['opencode']?.key;
    if (!key) return null;

    try {
      const res = await fetch('https://opencode.ai/zen/go/v1/usage', {
        headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[OpencodeGoAdapter] HTTP ${res.status}`);
        return null;
      }
      const data = await res.json() as any;
      const usage = data?.usage;
      if (!usage) return null;

      const windows: UsageWindow[] = [];
      const order: Array<{ key: 'rolling' | 'weekly' | 'monthly'; label: WindowType }> = [
        { key: 'rolling', label: '5h' },
        { key: 'weekly', label: '7d' },
        { key: 'monthly', label: 'month' },
      ];
      for (const { key, label } of order) {
        const w = usage[key];
        if (!w || w.status !== 'ok') continue;
        const pct = Math.round(w.percent ?? 0);
        const resetAt = w.resetsAt ? Date.parse(w.resetsAt) : undefined;
        windows.push({
          window: label,
          used: pct,
          limit: 100,
          unit: 'pct',
          pct,
          resetAt: Number.isFinite(resetAt as number) ? (resetAt as number) : undefined,
        });
      }

      if (windows.length === 0) return null;

      return {
        name: 'opencode-go',
        plan: 'Go',
        windows,
        severity: severity(Math.max(...windows.map(w => w.pct))),
      };
    } catch (err: any) {
      log.warn(`[OpencodeGoAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

/** GLM Coding Plan (zhipu) — GET https://bigmodel.cn/api/monitor/usage/quota/limit (5h / weekly). */
export class ZhipuCodingPlanAdapter implements ExternalAdapter {
  name = 'zhipuai-coding-plan';

  async fetch(): Promise<UsageProvider | null> {
    const auth = readOpencodeAuth();
    const key = auth['zhipuai-coding-plan']?.key || auth['zhipu-coding-plan']?.key;
    if (!key) return null;

    try {
      const res = await fetch('https://bigmodel.cn/api/monitor/usage/quota/limit', {
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[ZhipuAdapter] HTTP ${res.status}`);
        return null;
      }
      const body = await res.json() as any;
      const limits: any[] = body?.data?.limits ?? body?.limits;
      if (!Array.isArray(limits)) return null;

      const windows: UsageWindow[] = [];
      for (const limit of limits) {
        if (limit.type !== 'TOKENS_LIMIT' && limit.type !== 'CREDIT_LIMIT') continue;
        const pct = Math.round(limit.percentage ?? 0);
        const resetMs = limit.nextResetTime ? Math.round(limit.nextResetTime) : undefined;
        const resetAt = resetMs && Number.isFinite(resetMs) && resetMs > 0 ? resetMs : undefined;
        const label = limit.unit === 3 ? '5h' : limit.unit === 6 ? '7d' : undefined;
        if (!label) continue;
        windows.push({ window: label, used: pct, limit: 100, unit: 'pct', pct, resetAt });
      }

      if (windows.length === 0) return null;

      return {
        name: 'zhipuai-coding-plan',
        plan: body?.data?.planName || 'GLM',
        windows,
        severity: severity(Math.max(...windows.map(w => w.pct))),
      };
    } catch (err: any) {
      log.warn(`[ZhipuAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

/** Kimi Code — GET https://api.kimi.com/coding/v1/usages (limits array with used/limit). */
export class KimiCodingPlanAdapter implements ExternalAdapter {
  name = 'kimi-for-coding';

  async fetch(): Promise<UsageProvider | null> {
    const auth = readOpencodeAuth();
    const key = auth['kimi-for-coding']?.key || auth['kimi-code']?.key;
    if (!key) return null;

    try {
      const res = await fetch('https://api.kimi.com/coding/v1/usages', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[KimiAdapter] HTTP ${res.status}`);
        return null;
      }
      const payload = await res.json() as any;
      const root = payload?.data ?? payload;

      const windows: UsageWindow[] = [];
      const limits: any[] = root?.limits ?? [];
      for (const item of limits) {
        const detail = item?.detail ?? item;
        const win = item?.window ?? {};
        const limitVal = num(detail.limit);
        if (limitVal === undefined || limitVal <= 0) continue;
        const usedVal = num(detail.used) ?? (num(detail.remaining) !== undefined && num(detail.limit) !== undefined ? num(detail.limit)! - num(detail.remaining)! : 0);
        const pct = Math.round((usedVal / limitVal) * 100);
        const resetMs = parseResetMs(detail);
        windows.push({
          window: '5h',
          used: Math.round(usedVal * 100) / 100,
          limit: limitVal,
          unit: 'pct',
          pct,
          resetAt: resetMs,
        });
      }

      if (windows.length === 0) return null;

      return {
        name: 'kimi-for-coding',
        plan: 'Kimi Code',
        windows,
        severity: severity(Math.max(...windows.map(w => w.pct))),
      };
    } catch (err: any) {
      log.warn(`[KimiAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

/** SiliconFlow — GET https://api.siliconflow.cn/v1/user/info (balance). */
export class SiliconFlowAdapter implements ExternalAdapter {
  name = 'siliconflow-cn';

  async fetch(): Promise<UsageProvider | null> {
    const auth = readOpencodeAuth();
    const key = auth['siliconflow-cn']?.key || auth['siliconflow']?.key;
    if (!key) return null;

    try {
      const res = await fetch('https://api.siliconflow.cn/v1/user/info', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[SiliconFlowAdapter] HTTP ${res.status}`);
        return null;
      }
      const body = await res.json() as any;
      const d = body?.data ?? body;
      const total = num(d.totalBalance) ?? num(d.total_balance);
      const cash = num(d.cashBalance) ?? num(d.cash_balance);
      if (total === undefined || total <= 0) return null;

      const windows: UsageWindow[] = [makeBalanceWindow(0, 0, total)];

      return {
        name: 'siliconflow-cn',
        plan: 'prepaid',
        windows,
        severity: 'low',
      };
    } catch (err: any) {
      log.warn(`[SiliconFlowAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

/** Command Code GOAT — session cookie → GET https://api.commandcode.ai/internal/billing/credits
 *  (5h / weekly $ windows). Cookie comes from usage.cookies.commandcode in config.
 *  No cookie → returns null → poller falls back to local trajectory cost. */
export class CommandCodeAdapter implements ExternalAdapter {
  name = 'commandcode';

  async fetch(): Promise<UsageProvider | null> {
    const cookie = getUsageCookie('commandcode');
    if (!cookie) return null;

    try {
      const res = await fetch('https://api.commandcode.ai/internal/billing/credits', {
        headers: { 'Cookie': cookie },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[CommandCodeAdapter] HTTP ${res.status}`);
        return null;
      }
      const body = await res.json() as any;
      const windowLimits = body?.credits?.windowLimits;
      if (!windowLimits) return null;

      const windows: UsageWindow[] = [];
      for (const [key, label] of [['fiveHour', '5h'], ['weekly', '7d']] as const) {
        const w = windowLimits[key];
        const cap = num(w?.cap);
        if (cap === undefined || cap <= 0) continue;
        const used = num(w?.used) ?? 0;
        const pct = Math.round((used / cap) * 100);
        const resetMs = w?.resetAt ? Date.parse(w.resetAt) : undefined;
        windows.push({
          window: label,
          used: Math.round(used * 100) / 100,
          limit: Math.round(cap * 100) / 100,
          unit: '$',
          pct,
          resetAt: Number.isFinite(resetMs as number) ? (resetMs as number) : undefined,
        });
      }

      if (windows.length === 0) return null;

      return {
        name: 'commandcode',
        plan: 'GOAT',
        windows,
        severity: severity(Math.max(...windows.map(w => w.pct))),
      };
    } catch (err: any) {
      log.warn(`[CommandCodeAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

function num(v: any): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function getUsageCookie(name: string): string | null {
  try {
    const { config } = require('../config');
    const cookie = config.usage?.cookies?.[name];
    return typeof cookie === 'string' && cookie.trim() ? cookie.trim() : null;
  } catch {
    return null;
  }
}

function parseResetMs(detail: any): number | undefined {
  for (const key of ['reset_at', 'resetAt', 'reset_time', 'resetTime']) {
    const v = detail?.[key];
    if (typeof v === 'string' && v.trim()) {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return undefined;
}
