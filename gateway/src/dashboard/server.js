"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardServer = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const api_1 = require("./api");
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};
class DashboardServer {
    port;
    server;
    api;
    publicDir;
    sseClients = new Set();
    constructor(port = 3111, projectDir = '.') {
        this.port = port;
        this.publicDir = path.resolve(__dirname, 'public');
        this.api = new api_1.DashboardAPI(projectDir);
    }
    resolveFilePath(url) {
        let cleanUrl = url.split('?')[0].split('#')[0];
        if (cleanUrl === '/')
            return null;
        return path.join(this.publicDir, cleanUrl);
    }
    start() {
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
    broadcast(event) {
        const data = `data: ${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n\n`;
        for (const client of this.sseClients) {
            try {
                client.write(data);
            }
            catch {
                this.sseClients.delete(client);
            }
        }
    }
    stop() {
        for (const client of this.sseClients) {
            try {
                client.end();
            }
            catch { }
        }
        this.sseClients.clear();
        this.server?.close();
    }
}
exports.DashboardServer = DashboardServer;
//# sourceMappingURL=server.js.map