// File → DB migration for the unified gateway database. Runs once per
// startup (idempotent):
//   ① rename legacy t1.db(-wal/-shm) → gateway.db (only when gateway.db absent)
//   ② manager-session.json (all known candidate locations) → kv_store, then
//      delete the file
//   ③ recall-reflect-cursor.json → kv_store, then delete the file
//   ④ registry snapshot → kv_store (refreshed every start; the authoritative
//      registry stays in scheduler/registered-projects.json)
// Every step degrades to a warning and keeps the source intact on failure.
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { GatewayDatabase } from '../memory/gateway-db';

export interface GatewayDbMigrateResult {
  renamed: boolean;
  managerSessions: number;
  cursorImported: boolean;
  registrySnapshot: boolean;
}

export interface ManagerSessionFile {
  projectDir: string;
  filePath: string;
}

export function migrateGatewayDb(
  memoryDir: string,
  managerSessions: ManagerSessionFile[],
  cursorFile: string | null,
  registrySnapshot: unknown | null,
): GatewayDbMigrateResult {
  const result: GatewayDbMigrateResult = { renamed: false, managerSessions: 0, cursorImported: false, registrySnapshot: false };
  const gatewayDb = path.join(memoryDir, 'gateway.db');
  const legacyT1 = path.join(memoryDir, 't1.db');

  // ① rename legacy t1.db → gateway.db (files + WAL companions)
  if (!fs.existsSync(gatewayDb) && fs.existsSync(legacyT1)) {
    try {
      for (const suffix of ['', '-wal', '-shm']) {
        const src = legacyT1 + suffix;
        if (fs.existsSync(src)) fs.renameSync(src, gatewayDb + suffix);
      }
      result.renamed = true;
      log.info(`[gateway-db] renamed legacy t1.db → gateway.db`);
    } catch (err: any) {
      log.warn(`[gateway-db] t1.db rename failed (non-fatal): ${err.message}`);
    }
  }

  let db: GatewayDatabase | null = null;
  try {
    // Create/open the database (absent = fresh install; creating here keeps
    // the subsequent imports atomic with the unified store).
    db = new GatewayDatabase(gatewayDb);

    // ② manager-session files → kv_store (project identity inferred from path;
    // relative paths like "." are historical artifacts — skip them)
    for (const ms of managerSessions) {
      try {
        if (!fs.existsSync(ms.filePath)) continue;
        if (!path.isAbsolute(ms.projectDir)) {
          log.warn(`[gateway-db] skipping manager-session import for relative projectDir "${ms.projectDir}" (${ms.filePath})`);
          continue;
        }
        const data = JSON.parse(fs.readFileSync(ms.filePath, 'utf-8'));
        if (!data?.sessionId) continue;
        db.kvSet('manager-session', ms.projectDir, {
          sessionId: data.sessionId,
          createdAt: data.createdAt || null,
        });
        fs.rmSync(ms.filePath, { force: true });
        result.managerSessions++;
      } catch (err: any) {
        log.warn(`[gateway-db] manager-session import failed for ${ms.filePath}: ${err.message}`);
      }
    }

    // ③ reflect cursor file → kv_store
    if (cursorFile && fs.existsSync(cursorFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(cursorFile, 'utf-8'));
        if (raw && typeof raw === 'object') {
          for (const [sessionID, ids] of Object.entries(raw as Record<string, string[]>)) {
            if (Array.isArray(ids)) db.kvSet('reflect-cursor', sessionID, ids);
          }
          fs.rmSync(cursorFile, { force: true });
          result.cursorImported = true;
        }
      } catch (err: any) {
        log.warn(`[gateway-db] cursor import failed: ${err.message}`);
      }
    }

    // ④ registry snapshot (refreshed every start)
    if (registrySnapshot !== null) {
      db.kvSet('registry', 'snapshot', registrySnapshot);
      result.registrySnapshot = true;
    }

    db.close();
    db = null;
    if (result.managerSessions > 0 || result.cursorImported) {
      log.info(
        `[gateway-db] imported ${result.managerSessions} manager sessions, cursor=${result.cursorImported}, registrySnapshot=${result.registrySnapshot}`,
      );
    }
  } catch (err: any) {
    try { db?.close(); } catch { /* ignore */ }
    log.warn(`[gateway-db] migration failed (non-fatal): ${err.message}`);
  }

  return result;
}
