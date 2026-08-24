import { UsageProvider, UsageWindow } from './types';
import { readOpencodeAuth } from '../media/auth-util';
import { log } from '../core/utils/logger';

export interface ExternalAdapter {
  name: string;
  fetch(): Promise<UsageProvider | null>;
}

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
        const isCNY = info.currency === 'CNY';
        const rate = isCNY ? CNY_TO_USD : 1;
        remaining += bal * rate;
        totalEver += (granted + toppedUp) * rate;
      }

      if (remaining <= 0 && totalEver <= 0) return null;

      const used = Math.max(0, totalEver - remaining);
      const limit = totalEver > 0 ? totalEver : 0;
      const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;

      const windows: UsageWindow[] = [{
        window: 'balance',
        used: Math.round(used * 100) / 100,
        limit: Math.round(limit * 100) / 100,
        unit: '$',
        pct,
      }];

      return {
        name: 'deepseek',
        plan: 'prepaid',
        windows,
        severity: pct >= 90 ? 'critical' : pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low',
      };
    } catch (err: any) {
      log.warn(`[DeepSeekAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}

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
          windows: [{
            window: 'balance',
            used: Math.round(usage * 100) / 100,
            limit: 0,
            unit: '$',
            pct: 0,
          }],
          severity: 'low',
        };
      }

      const remaining = limitRemaining ?? 0;
      const totalLimit = limit ?? (remaining + usage);
      const used = totalLimit - remaining;
      const pct = totalLimit > 0 ? Math.round((used / totalLimit) * 100) : 0;

      const windows: UsageWindow[] = [{
        window: 'balance',
        used: Math.round(used * 100) / 100,
        limit: Math.round(totalLimit * 100) / 100,
        unit: '$',
        pct,
      }];

      return {
        name: 'openrouter',
        plan: 'prepaid',
        windows,
        severity: pct >= 90 ? 'critical' : pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low',
      };
    } catch (err: any) {
      log.warn(`[OpenRouterAdapter] fetch failed: ${err.message}`);
      return null;
    }
  }
}
