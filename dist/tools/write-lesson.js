"use strict";
/**
 * Write Lesson Tool — 写入 Lesson tool 函数
 *
 * 职责：
 *   1. 将 Review 失败结果写入 lessons/{goalId}-loop{loop}.md
 *   2. 格式化 Lesson 结构
 *
 * 被 mafw-review/entry.ts 调用。
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
exports.writeLesson = writeLesson;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * 写入 Lesson 文件
 */
function writeLesson(data, projectDir = '.') {
    const { goalId, loop, reason, metrics, domain = 'general', task = 'unknown' } = data;
    const lessonsDir = path.join(projectDir, '.opencode/mafw/lessons');
    if (!fs.existsSync(lessonsDir)) {
        fs.mkdirSync(lessonsDir, { recursive: true });
    }
    const lessonPath = path.join(lessonsDir, `${goalId}-loop${loop}.md`);
    const content = formatLesson(data);
    fs.writeFileSync(lessonPath, content, 'utf-8');
    console.log(`[write-lesson] Written: ${lessonPath}`);
    return lessonPath;
}
/**
 * 格式化 Lesson 内容
 */
function formatLesson(data) {
    const { goalId, loop, reason, metrics, domain, task } = data;
    return `# Lesson: ${goalId} — Loop ${loop}

## Trigger

Review failed: ${reason}

## Context

- Goal: ${goalId}
- Loop: ${loop}
- Domain: ${domain}
- Task: ${task}

## Metrics

${Object.entries(metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Root Cause

${reason}

## Recommendation

Address the above issues in the next loop.

---
_generated: ${new Date().toISOString()}_
`;
}
//# sourceMappingURL=write-lesson.js.map