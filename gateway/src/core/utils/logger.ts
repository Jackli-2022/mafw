import * as fs from 'fs';
import * as path from 'path';

/**
 * Tees console.log/warn/error to both the original console and a log file.
 * Once installed, ALL existing console.* calls automatically go to both.
 */
export function installFileLogging(logDir: string, maxFileSize = 5 * 1024 * 1024): void {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFilePath = path.join(logDir, 'mafw.log');

  function appendToFile(text: string): void {
    try {
      if (fs.existsSync(logFilePath)) {
        const stat = fs.statSync(logFilePath);
        if (stat.size >= maxFileSize) {
          fs.renameSync(logFilePath, `${logFilePath}.${Date.now()}`);
        }
      }
      fs.appendFileSync(logFilePath, text, 'utf-8');
    } catch { /* non-fatal */ }
  }

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: any[]) => {
    origLog(...args);
    const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    appendToFile(`[${new Date().toISOString()}] [INFO] ${line}\n`);
  };

  console.warn = (...args: any[]) => {
    origWarn(...args);
    const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    appendToFile(`[${new Date().toISOString()}] [WARN] ${line}\n`);
  };

  console.error = (...args: any[]) => {
    origError(...args);
    const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    appendToFile(`[${new Date().toISOString()}] [ERROR] ${line}\n`);
  };
}
