import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MANAGER_IDENTITY_SYSTEM_PROMPT } from './manager-identity';
import { log } from '../core/utils/logger';

// The `manager` primary agent definition, installed into the global opencode
// config on gateway start so every registered project can switch to / mention
// the MAFW manager agent. Only written when missing — a user-customized
// manager agent is left untouched.
const MANAGER_AGENT_TEMPLATE = `---
mode: primary
description: 编排 · 分解任务与调度
color: "#46DC82"
---

${MANAGER_IDENTITY_SYSTEM_PROMPT}
`;

export function ensureManagerAgentConfig(): string | null {
  try {
    const dir = path.join(os.homedir(), '.config', 'opencode', 'agent');
    const file = path.join(dir, 'manager.md');
    if (fs.existsSync(file)) {
      log.info('[ManagerAgent] config already present, skipping');
      return null;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, MANAGER_AGENT_TEMPLATE, 'utf-8');
    log.info(`[ManagerAgent] wrote ${file}`);
    return file;
  } catch (err: any) {
    log.error(`[ManagerAgent] failed to write config: ${err.message}`);
    return null;
  }
}
