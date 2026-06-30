"use strict";
/**
 * Dashboard Server — Gateway 内置 Web 看板
 */
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
const http = __importStar(require("http"));
class DashboardServer {
    port;
    constructor(port = 3000) {
        this.port = port;
    }
    start() {
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
exports.DashboardServer = DashboardServer;
