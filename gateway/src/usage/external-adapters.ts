import { UsageProvider, UsageWindow, Severity } from './types';
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
