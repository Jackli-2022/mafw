import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as os from 'os';

export interface DesktopAutomationInfo {
  port: number;
  secret: string;
}

export class DesktopClient {
  private baseUrl: string;
  private secret: string;

  constructor(info: DesktopAutomationInfo) {
    this.baseUrl = `http://127.0.0.1:${info.port}`;
    this.secret = info.secret;
  }

  static tryLoad(): DesktopClient | null {
    const candidates = [
      path.join(os.homedir(), '.config', 'mafw', 'desktop-automation.json'),
      path.join(process.cwd(), '.mafw', 'desktop-automation.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const data: DesktopAutomationInfo = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (data.port && data.secret) {
            return new DesktopClient(data);
          }
        } catch { /* skip */ }
      }
    }
    return null;
  }

  async screenshot(selector?: string): Promise<{ filePath: string; width: number; height: number }> {
    const query = selector ? `?selector=${encodeURIComponent(selector)}` : '';
    const res = await this.fetch(`/screenshot${query}`);
    return res;
  }

  async uiState(): Promise<{ tab: string; elements: any[]; dimensions: { width: number; height: number }; scrollPosition: { x: number; y: number } }> {
    return this.fetch('/ui-state');
  }

  async navigate(tab: string): Promise<{ ok: boolean; currentTab: string }> {
    return this.fetch('/navigate', { tab });
  }

  async click(selector: string): Promise<{ clicked: boolean; element?: any }> {
    return this.fetch('/click', { selector });
  }

  async type(selector: string, text: string): Promise<{ typed: boolean; value?: string }> {
    return this.fetch('/type', { selector, text });
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<{ ok: boolean }> {
    return this.fetch('/scroll', { direction, amount });
  }

  private async fetch(endpoint: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
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
