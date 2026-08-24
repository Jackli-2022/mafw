export type WindowType = '5h' | '7d' | 'month' | 'balance';
export type Severity = 'low' | 'mid' | 'high' | 'critical';
export type Pacing = 'ahead' | 'on-track' | 'under';

export interface UsageWindow {
  window: WindowType;
  used: number;
  limit: number;
  unit: '$' | 'tokens' | 'requests';
  resetAt?: number;
  pct: number;
  pacing?: Pacing;
  projected?: number;
}

export interface UsageProvider {
  name: string;
  plan?: string;
  windows: UsageWindow[];
  severity: Severity;
}

export interface UsageResponse {
  providers: UsageProvider[];
  updatedAt: number;
}

export interface QuotaLimits {
  'opencode-go': { '5h': number; '7d': number; month: number };
  zen: { balance: number };
}
