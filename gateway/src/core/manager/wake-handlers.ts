import { log } from '../utils/logger';
import { AutomationRule, AutomationEngine } from '../../automation-engine';
import { RuntimeClient } from '../../runtime/contract';
import * as fs from 'fs';
import * as path from 'path';
import { QuestionLedger } from './question-ledger';

const reportedQuestions: Set<string> = new Set();

export async function injectWakePrompt(
  client: RuntimeClient,
  _projectDir: string,
  sessionId: string,
  reason: string,
  countCompleted: number,
  countFailed: number,
): Promise<void> {
  const wakePrompt = `[MANAGER SYSTEM WAKE] Goals updated. Active: ${countCompleted} completed, ${countFailed} failed.\nUse mafw_get_goal_status for details. Do NOT fabricate results.`;

  log.info(`[WakeHandler] Injecting wake prompt into session ${sessionId}: ${reason}`);
  try {
    await client.session.promptAsync({
      sessionID: sessionId,
      parts: [{ type: 'text', text: wakePrompt }],
    });
  } catch (err: any) {
    log.warn(`[WakeHandler] Failed to inject wake prompt: ${err.message}`);
  }
}

async function resolveManagerSession(mafwDir: string): Promise<string | null> {
  const managerSessionFile = path.join(mafwDir, 'manager-session.json');
  if (!fs.existsSync(managerSessionFile)) {
    log.info('[WakeHandler] No manager session found — skipping wake injection');
    return null;
  }
  const { sessionId } = JSON.parse(fs.readFileSync(managerSessionFile, 'utf-8'));
  if (!sessionId) {
    log.warn('[WakeHandler] Manager session id missing — skipping wake injection');
    return null;
  }
  return sessionId;
}

async function injectWakeMessage(engine: AutomationEngine, goalIds: string[], reason: string): Promise<void> {
  const client = engine.runtimeClient;
  if (!client) {
    log.warn('[WakeHandler] No runtime client available — skipping wake injection');
    return;
  }

  const mafwDir = engine['mafwDir'] as string;
  const sessionId = await resolveManagerSession(mafwDir);
  if (!sessionId) return;

  const countCompleted = goalIds.filter(gid => {
    const sf = path.join(mafwDir, 'state', `${gid}.json`);
    if (!fs.existsSync(sf)) return false;
    const s = JSON.parse(fs.readFileSync(sf, 'utf-8'));
    return s.reviewVerdict === 'PASS' && !s.reportedAt;
  }).length;

  const countFailed = goalIds.length - countCompleted;
  await injectWakePrompt(client, mafwDir, sessionId, reason, countCompleted, countFailed);
}

export async function wakeCompletedHandler(rule: AutomationRule, engine: AutomationEngine): Promise<void> {
  const mafwDir = engine['mafwDir'] as string;
  const stateDir = path.join(mafwDir, 'state');
  if (!fs.existsSync(stateDir)) return;
  const completedGoalIds: string[] = [];
  for (const file of fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
      if (s.reviewVerdict === 'PASS' && !s.reportedAt) {
        completedGoalIds.push(s.goalId || file.replace('.json', ''));
      }
    } catch {}
  }
  if (completedGoalIds.length > 0) {
    await injectWakeMessage(engine, completedGoalIds, 'report_completed');
  }
}

export async function wakeFailedHandler(rule: AutomationRule, engine: AutomationEngine): Promise<void> {
  const mafwDir = engine['mafwDir'] as string;
  const stateDir = path.join(mafwDir, 'state');
  if (!fs.existsSync(stateDir)) return;
  const failedGoalIds: string[] = [];
  for (const file of fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
      if ((s.reviewVerdict === 'FAIL' || s.reviewVerdict === 'ERROR') && !s.reportedAt) {
        failedGoalIds.push(s.goalId || file.replace('.json', ''));
      }
    } catch {}
  }
  if (failedGoalIds.length > 0) {
    await injectWakeMessage(engine, failedGoalIds, 'report_failed');
  }
}

export async function wakeQuestionHandler(_rule: AutomationRule, engine: AutomationEngine): Promise<void> {
  const mafwDir = engine['mafwDir'] as string;
  const ledger = new QuestionLedger(mafwDir);
  const pending = ledger.listPendingQuestions();
  if (pending.length === 0) return;

  const goalIds: string[] = [];
  for (const q of pending) {
    if (reportedQuestions.has(q.questionId)) continue;
    reportedQuestions.add(q.questionId);
    if (!goalIds.includes(q.goalId)) {
      goalIds.push(q.goalId);
    }
  }
  if (goalIds.length === 0) return;
  await injectWakeMessage(engine, goalIds, 'report_question');
}



