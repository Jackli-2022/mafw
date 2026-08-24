import { GatewayDatabase } from '../memory/gateway-db';
import { log } from '../core/utils/logger';

export function backfillProviderColumn(db: GatewayDatabase): void {
  const rawDb = (db as any).db;

  const rows = rawDb
    .prepare('SELECT session_id, turn_id, model FROM trajectory_turns WHERE provider IS NULL AND model IS NOT NULL')
    .all() as { session_id: string; turn_id: number; model: string }[];

  if (rows.length === 0) {
    log.info('[Backfill] No turns need provider backfill');
    return;
  }

  const update = rawDb.prepare('UPDATE trajectory_turns SET provider = ? WHERE session_id = ? AND turn_id = ?');
  let updated = 0;

  for (const row of rows) {
    const provider = inferProvider(row.model);
    if (provider) {
      update.run(provider, row.session_id, row.turn_id);
      updated++;
    }
  }

  log.info(`[Backfill] Updated ${updated}/${rows.length} turns with provider`);
}

function inferProvider(model: string): string | null {
  if (model.includes('/')) {
    return model.split('/')[0];
  }
  const known: Record<string, string> = {
    'claude': 'anthropic',
    'gpt': 'openai',
    'deepseek': 'deepseek',
    'mimo': 'xiaomi',
    'qwen': 'alibaba-cn',
  };
  for (const [prefix, provider] of Object.entries(known)) {
    if (model.toLowerCase().includes(prefix)) return provider;
  }
  return null;
}
