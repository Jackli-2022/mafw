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
const config_1 = require("./config");
class SchedulerLedger {
    ledgerPath;
    constructor(projectDir = '.') {
        this.ledgerPath = path.join(projectDir, config_1.config.paths.mafwDir, 'ledger.md');
    }
    append(entry) {
        const parts = [
            `[${entry.timestamp}]`,
            `[${entry.event}]`,
        ];
        if (entry.ruleId)
            parts.push(`[${entry.ruleId}]`);
        if (entry.goalId)
            parts.push(`[${entry.goalId}]`);
        if (entry.source)
            parts.push(`source=${entry.source}`);
        if (entry.reason)
            parts.push(`reason=${entry.reason}`);
        if (entry.sessionId)
            parts.push(`session=${entry.sessionId}`);
        if (entry.details)
            parts.push(JSON.stringify(entry.details));
        fs.appendFileSync(this.ledgerPath, parts.join(' ') + '\n', 'utf-8');
    }
    read() {
        if (!fs.existsSync(this.ledgerPath))
            return [];
        const content = fs.readFileSync(this.ledgerPath, 'utf-8');
        return content.split('\n').filter(Boolean).map(line => this.parse(line));
    }
    getHistory(ruleId, limit) {
        let entries = this.read();
        if (ruleId) {
            entries = entries.filter(e => e.ruleId === ruleId);
        }
        entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        if (limit && entries.length > limit) {
            entries = entries.slice(-limit);
        }
        return entries.reverse();
    }
    parse(line) {
        const entry = { timestamp: new Date().toISOString(), event: 'UNKNOWN' };
        const tsMatch = line.match(/^\[(.+?)\]/);
        if (!tsMatch)
            return entry;
        entry.timestamp = tsMatch[1];
        const eventMatch = line.match(/^\[.+?\] \[(.+?)\]/);
        if (!eventMatch)
            return entry;
        entry.event = eventMatch[1];
        const rest = line.slice(line.indexOf(']', line.indexOf(']') + 1) + 1).trim();
        const bracketIds = [...rest.matchAll(/\[([^\]]+)\]/g)];
        if (bracketIds.length >= 1) {
            entry.ruleId = bracketIds[0][1];
        }
        if (bracketIds.length >= 2) {
            entry.goalId = bracketIds[1][1];
        }
        const sourceMatch = rest.match(/source=(\w+)/);
        if (sourceMatch && ['cron', 'llm', 'user'].includes(sourceMatch[1])) {
            entry.source = sourceMatch[1];
        }
        const reasonMatch = rest.match(/reason=([^\s{}]+)/);
        if (reasonMatch)
            entry.reason = reasonMatch[1];
        const sessionMatch = rest.match(/session=([^\s{}]+)/);
        if (sessionMatch)
            entry.sessionId = sessionMatch[1];
        const detailsMatch = rest.match(/(\{.+})/);
        if (detailsMatch) {
            try {
                entry.details = JSON.parse(detailsMatch[1]);
            }
            catch {
                entry.details = { raw: detailsMatch[1] };
            }
        }
        return entry;
    }
}
exports.SchedulerLedger = SchedulerLedger;
