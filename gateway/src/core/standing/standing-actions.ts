import type { StandingAction } from './standing-triage';

export interface StandingActionDeps {
  notify(input: { title: string; body: string }): Promise<void> | void;
  comment(input: { target: string; body: string }): Promise<void> | void;
  label(input: { target: string; label: string }): Promise<void> | void;
  enabled(): boolean;
}

export class StandingActionExecutor {
  constructor(private readonly deps: StandingActionDeps) {}

  async execute(action: StandingAction): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
    if (!this.deps.enabled()) return { ok: false, error: 'standing goals disabled' };
    try {
      if (action.type === 'notify') {
        await this.deps.notify(action.payload);
        return { ok: true, result: { notified: true } };
      }
      if (action.type === 'comment') {
        await this.deps.comment(action.payload);
        return { ok: true, result: { commented: action.payload.target } };
      }
      if (action.type === 'label') {
        await this.deps.label(action.payload);
        return { ok: true, result: { labeled: action.payload.target } };
      }
      return { ok: false, error: 'action not allowed' };
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  }
}
