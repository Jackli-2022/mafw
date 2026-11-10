/**
 * MAFW Gateway entry point (D3 Task 8).
 *
 * Three jobs only: pull `MafwScheduler` back out of `kernel.ts`, keep the public
 * `export { MafwScheduler }` shape (tests and docs import it from `src/index`),
 * and boot the process under `require.main === module` (signal handlers +
 * instantiate + start). All orchestration lives in `src/kernel.ts`.
 */
import { log } from './core/utils/logger';
import { MafwScheduler } from './kernel';

export { MafwScheduler };

// -- entry --

if (require.main === module) {
  const scheduler = new MafwScheduler('.');

  process.on('SIGINT', () => {
    log.info('\n[Scheduler] Received SIGINT, shutting down...');
    void scheduler.shutdown().finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    log.info('\n[Scheduler] Received SIGTERM, shutting down...');
    void scheduler.shutdown().finally(() => process.exit(0));
  });

  scheduler.start().catch(err => {
    log.error('[Scheduler] Fatal error:', (err && (err.stack || err.message)) || err);
    process.exit(1);
  });
}
