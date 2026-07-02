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
exports.SchedulerLedger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class SchedulerLedger {
    ledgerPath;
    constructor(projectDir = '.') {
        this.ledgerPath = path.join(projectDir, '.opencode/mafw/ledger.md');
    }
    append(entry) {
        const line = `[${entry.timestamp}] [${entry.event}]` +
            (entry.goalId ? ` [${entry.goalId}]` : '') +
            (entry.reason ? ` reason=${entry.reason}` : '') +
            (entry.sessionId ? ` session=${entry.sessionId}` : '') +
            (entry.details ? ` ${JSON.stringify(entry.details)}` : '');
        fs.appendFileSync(this.ledgerPath, line + '\n', 'utf-8');
    }
    read() {
        if (!fs.existsSync(this.ledgerPath))
            return [];
        const content = fs.readFileSync(this.ledgerPath, 'utf-8');
        return content.split('\n').filter(Boolean).map(line => this.parse(line));
    }
    parse(line) {
        // 简单解析：[$timestamp] [$event] ...
        const match = line.match(/^\[(.+?)\] \[(.+?)\](?: \[(.+?)\])?(?: reason=(.+?))?(?: session=(.+?))?(?: (.+))?$/);
        if (!match)
            return { timestamp: new Date().toISOString(), event: 'UNKNOWN' };
        const [, timestamp, event, goalId, reason, sessionId, details] = match;
        return {
            timestamp,
            event,
            goalId,
            reason,
            sessionId,
            details: details ? JSON.parse(details) : undefined
        };
    }
}
exports.SchedulerLedger = SchedulerLedger;
//# sourceMappingURL=ledger.js.map