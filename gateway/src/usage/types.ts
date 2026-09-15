export type WindowType = '5h' | 'day' | '7d' | 'month' | 'balance';
export type Severity = 'low' | 'mid' | 'high' | 'critical';
export type Pacing = 'ahead' | 'on-track' | 'under';
export type UsageProviderType = 'api' | 'token-plan';

export interface UsageWindow {
  window: WindowType;
  used: number;
  limit: number;
  unit: '$' | 'tokens' | 'requests' | 'pct' | 'credit';
  resetAt?: number;
  pct: number;
  pacing?: Pacing;
  projected?: number;
  remaining?: number;
  tokens?: number;
  projectedCost?: number;
  /** 附加明细行（如分模型消耗），UI tooltip 逐行展示。 */
  detailLines?: string[];
}

export interface UsageProvider {
  name: string;
  plan?: string;
  type?: UsageProviderType;
  windows: UsageWindow[];
  severity: Severity;
}

export interface ExternalAdapter {
  name: string;
  type?: UsageProviderType;
  fetch(): Promise<UsageProvider | null>;
}

export interface UsageResponse {
  providers: UsageProvider[];
  updatedAt: number;
}

export interface QuotaLimits {
  'opencode-go': { '5h': number; '7d': number; month: number };
  zen: { balance: number };
}
