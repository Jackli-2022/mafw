import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { DashboardAPI } from './api';
import { SchedulerState } from './types';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

export class DashboardServer {
  private port: number;
  private server?: http.Server;
  private api: DashboardAPI;
  private publicDir: string;
  private sseClients: Set<http.ServerResponse> = new Set();

  constructor(port: number = 3111, projectDir: string = '.', scheduler?: SchedulerState) {
    this.port = port;
    this.publicDir = path.resolve(__dirname, 'public');
    this.api = new DashboardAPI(projectDir, scheduler);
  }

  private resolveFilePath(url: string): string | null {
    let cleanUrl = url.split('?')[0].split('#')[0];
    if (cleanUrl === '/') return null;
    return path.join(this.publicDir, cleanUrl);
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const url = req.url || '/';

        // SSE stream
        if (url === '/api/events?stream=true' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
          this.sseClients.add(res);
          req.on('close', () => { this.sseClients.delete(res); });
          return;
        }

        // API routes
        if (url.startsWith('/api/')) {
          await this.api.handle(req, res);
          return;
        }

        // Static files
        const filePath = this.resolveFilePath(url);
        if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath);
          const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
          const content = fs.readFileSync(filePath);
          res.writeHead(200, { 'Content-Type': mimeType });
          res.end(content);
          return;
        }

        // SPA fallback: serve index.html for non-API, non-file routes
        const indexPath = path.join(this.publicDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      this.server.listen(this.port, () => {
        console.log(`[DashboardServer] HTTP server @ http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  broadcast(event: { type: string; [key: string]: any }): void {
    const data = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(data); } catch { this.sseClients.delete(client); }
    }
  }

  stop(): void {
    for (const client of this.sseClients) {
      try { client.end(); } catch {}
    }
    this.sseClients.clear();
    this.server?.close();
  }
}
