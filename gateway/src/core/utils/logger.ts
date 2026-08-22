import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { redactLog } from '../auth';

const LOG_DIR = path.join(os.homedir(), '.mafw', 'logs');
const LOG_PATH = path.join(LOG_DIR, 'mafw.log');
const MAX_SIZE = 5 * 1024 * 1024;

function rotateIfNeeded(): void {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size >= MAX_SIZE) {
      fs.renameSync(LOG_PATH, `${LOG_PATH}.${Date.now()}`);
    }
  } catch { /* non-fatal */ }
}

function write(level: string, msg: string, ...args: any[]): void {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    const line = args.length === 0
      ? `[${new Date().toISOString()}] [${level}] ${redactLog(msg)}\n`
      : `[${new Date().toISOString()}] [${level}] ${redactLog(msg)} ${redactLog(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))}\n`;
    fs.appendFileSync(LOG_PATH, line, 'utf-8');
  } catch { /* non-fatal */ }
}

export const log = {
  info: (msg: string, ...args: any[]) => write('INFO', msg, ...args),
  warn: (msg: string, ...args: any[]) => write('WARN', msg, ...args),
  error: (msg: string, ...args: any[]) => write('ERROR', msg, ...args),
  debug: (msg: string, ...args: any[]) => write('DEBUG', msg, ...args),
};
