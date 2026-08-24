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
      const balance = data?.balance_infos?.[0];
      if (!balance) return null;

      const total = parseFloat(balance.total_balance) || 0;
      const granted = parseFloat(balance.granted_balance) || 0;
      const used = granted - total;

      if (total <= 0) return null;

      const pct = Math.round((used / granted) * 100);
      const windows: UsageWindow[] = [{
        window: 'balance',
        used: Math.round(used * 100) / 100,
        limit: Math.round(granted * 100) / 100,
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
      const res = await fetch('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`[OpenRouterAdapter] HTTP ${res.status}`);
        return null;
      }
      const data = await res.json() as any;
      const credits = parseFloat(data?.data?.credits_remaining) || 0;
      const totalCredits = parseFloat(data?.data?.total_credits) || 0;

      if (totalCredits <= 0) return null;

      const used = totalCredits - credits;
      const pct = Math.round((used / totalCredits) * 100);
      const windows: UsageWindow[] = [{
        window: 'balance',
        used: Math.round(used * 100) / 100,
        limit: Math.round(totalCredits * 100) / 100,
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
