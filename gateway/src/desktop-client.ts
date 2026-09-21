import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as os from 'os';

export interface DesktopAutomationInfo {
  port: number;
  secret: string;
}

/**
 * Desktop 自动化客户端。
 *
 * desktop 每次启动都会以临时端口重写 desktop-automation.json，而 gateway
 * 常驻不重启——端口缓存会导致 mafw_desktop_* 工具在 desktop 重启后失联。
 * 因此每次请求前按源文件 mtime 自愈：文件变了就重读端口与 secret；
 * 读取失败 fail-open 沿用旧值，不阻塞调用。
 */
export class DesktopClient {
  private static defaultCandidates(): string[] {
    return [
      path.join(os.homedir(), '.config', 'mafw', 'desktop-automation.json'),
      path.join(process.cwd(), '.mafw', 'desktop-automation.json'),
    ];
  }

  private port: number;
  private secret: string;
  private mtimeMs: number;

  constructor(
    info: DesktopAutomationInfo,
    private sourcePath: string,
    private candidates: string[],
  ) {
    this.port = info.port;
    this.secret = info.secret;
    this.mtimeMs = DesktopClient.safeMtime(sourcePath);
  }

  static tryLoad(candidates: string[] = DesktopClient.defaultCandidates()): DesktopClient | null {
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue;
        const data: DesktopAutomationInfo = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (data.port && data.secret) {
          return new DesktopClient(data, p, candidates);
        }
      } catch { /* skip */ }
    }
    return null;
  }

  private static safeMtime(p: string): number {
    try { return fs.statSync(p).mtimeMs; } catch { return 0; }
  }

  /** 源文件 mtime 变化时重读；任何失败沿用当前值（fail-open） */
  private refresh(): void {
    try {
      const m = DesktopClient.safeMtime(this.sourcePath);
      if (m === this.mtimeMs) return;
      const data: DesktopAutomationInfo = JSON.parse(fs.readFileSync(this.sourcePath, 'utf-8'));
      if (data.port && data.secret) {
        this.port = data.port;
        this.secret = data.secret;
      }
      this.mtimeMs = m;
    } catch { /* fail-open：保持旧端口 */ }
  }

  async screenshot(selector?: string): Promise<{ filePath: string; width: number; height: number }> {
    this.refresh();
    const query = selector ? `?selector=${encodeURIComponent(selector)}` : '';
    return this.fetch(`/screenshot${query}`);
  }

  async uiState(): Promise<{ tab: string; elements: any[]; dimensions: { width: number; height: number }; scrollPosition: { x: number; y: number } }> {
    this.refresh();
    return this.fetch('/ui-state');
  }

  async navigate(tab: string): Promise<{ ok: boolean; currentTab: string }> {
    this.refresh();
    return this.fetch('/navigate', { tab });
  }

  async click(selector: string): Promise<{ clicked: boolean; element?: any }> {
    this.refresh();
    return this.fetch('/click', { selector });
  }

  async type(selector: string, text: string): Promise<{ typed: boolean; value?: string }> {
    this.refresh();
    return this.fetch('/type', { selector, text });
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<{ ok: boolean }> {
    this.refresh();
    return this.fetch('/scroll', { direction, amount });
  }

  private async fetch(endpoint: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, `http://127.0.0.1:${this.port}`);
      const method = body ? 'POST' : 'GET';
      const payload = body ? JSON.stringify(body) : undefined;

      const req = http.request(
        url.toString(),
        {
          method,
          headers: {
            'Authorization': `Bearer ${this.secret}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
              } else {
                resolve(parsed);
              }
            } catch {
              reject(new Error(`Invalid response: ${data.slice(0, 100)}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }
}
