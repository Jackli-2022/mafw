/**
 * Dashboard Server — Gateway 内置 Web 看板
 */

import * as http from 'http';

export class DashboardServer {
  private port: number;

  constructor(port: number = 3001) {
    this.port = port;
  }

  start(): void {
    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/dashboard' || req.url === '/') {
        res.writeHead(200);
        res.end(JSON.stringify({
          status: 'ok',
          message: 'MAFW Dashboard v4.1',
          endpoints: ['/health', '/metrics', '/dashboard']
        }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(this.port, () => {
      console.log(`[Dashboard] HTTP server @ http://localhost:${this.port}/dashboard`);
    });
  }
}
