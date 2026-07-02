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
exports.LoopMonitor = void 0;
/**
 * Loop Monitor — Loop 心跳监控
 */
const fs = __importStar(require("fs"));
class LoopMonitor {
    statusPath;
    constructor(statusPath) {
        this.statusPath = statusPath;
    }
    isStuck(timeoutMs = 5 * 60 * 1000) {
        if (!fs.existsSync(this.statusPath))
            return false;
        const content = fs.readFileSync(this.statusPath, 'utf-8');
        const match = content.match(/updated_at:\s*(.+)/);
        if (!match)
            return false;
        const lastUpdate = new Date(match[1].trim()).getTime();
        return (Date.now() - lastUpdate) > timeoutMs;
    }
    getState() {
        if (!fs.existsSync(this.statusPath))
            return null;
        const content = fs.readFileSync(this.statusPath, 'utf-8');
        const lines = content.split('\n');
        const parse = (key) => {
            const line = lines.find(l => l.startsWith(key + ':'));
            return line ? line.split(':').slice(1).join(':').trim() : '';
        };
        return {
            goalId: parse('goal_id'),
            state: parse('state'),
            loop: parseInt(parse('loop'), 10) || 0,
            updatedAt: parse('updated_at')
        };
    }
}
exports.LoopMonitor = LoopMonitor;
//# sourceMappingURL=loop-monitor.js.map