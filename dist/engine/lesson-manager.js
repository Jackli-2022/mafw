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
exports.LessonManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const lesson_compactor_1 = require("../compression/lesson-compactor");
const compression_verifier_1 = require("../compression/compression-verifier");
const memory_index_1 = require("../compression/memory-index");
/**
 * Lesson Manager — L2 经验档案管理器
 *
 * 职责：
 *   1. 写入自然语言 Lesson（Review 失败时）
 *   2. 写入前调用 L2 LessonCompactor 压缩为 YAML
 *   3. 写入后异步更新 L2 MemoryIndex
 *   4. 提供加载接口（loadAll / loadRelevant）
 *
 * 文件结构：
 *   .opencode/mafw/lessons/{goal_id}.md
 */
class LessonManager {
    lessonsDir;
    compactor;
    verifier;
    index;
    constructor(projectDir = '.') {
        this.lessonsDir = path.join(projectDir, '.opencode/mafw/lessons');
        if (!fs.existsSync(this.lessonsDir))
            fs.mkdirSync(this.lessonsDir, { recursive: true });
        this.compactor = new lesson_compactor_1.LessonCompactor();
        this.verifier = new compression_verifier_1.CompressionVerifier();
        this.index = new memory_index_1.MemoryIndexManager(path.join(projectDir, '.opencode/mafw/memory-index.json'));
    }
    /**
     * 写入一个自然语言 Lesson。
     * 返回 lesson 在文件中的 anchor（如 "L12"）。
     */
    async writeLesson(goalId, loop, data) {
        const file = path.join(this.lessonsDir, `${goalId}.md`);
        const raw = {
            loop,
            trigger: data.trigger,
            result: data.result,
            domain: data.executeResult.domain || 'general',
            task: data.executeResult.currentTask || 'unknown',
            violation: {
                rule: data.reason,
                type: 'boundary_cross',
                severity: 'high'
            },
            root_cause: data.reason,
            lesson: `Lesson from Loop ${loop}: ${data.reason}`,
            energy: 'high',
            files: data.executeResult.filesChanged || [],
            created_at: new Date().toISOString()
        };
        const block = this.renderRawBlock(raw);
        const isNew = !fs.existsSync(file);
        fs.appendFileSync(file, block, 'utf-8');
        // 更新索引
        const anchor = this.getAnchor(file, block);
        this.index.add({
            id: `${goalId}-loop-${loop}`,
            file,
            anchor,
            tags: memory_index_1.MemoryIndexManager.extractTags(raw.lesson + ' ' + raw.domain),
            energy: 0.8,
            type: 'constraint_source',
            loop,
            goal: goalId
        });
        this.index.save();
        return anchor;
    }
    /**
     * 压缩最后写入的 Lesson（Stop Hook 调用）
     */
    compactLastLesson(goalId) {
        const file = path.join(this.lessonsDir, `${goalId}.md`);
        if (!fs.existsSync(file))
            return;
        const content = fs.readFileSync(file, 'utf-8');
        const blocks = content.split(/###\s+Loop\s+/).filter(Boolean);
        if (blocks.length === 0)
            return;
        const lastBlock = blocks[blocks.length - 1];
        // 解析为 RawLesson（简化解析）
        const raw = this.parseRawBlock('Loop ' + lastBlock);
        if (!raw)
            return;
        const result = this.compactor.compact(raw);
        if (result.success) {
            // 验证通过，替换为压缩版本
            const newContent = content.replace(/###\s+Loop\s+\d+\s+[\s\S]*$/, this.renderCompactedBlock(result.compacted));
            fs.writeFileSync(file, newContent, 'utf-8');
        }
    }
    /**
     * 加载所有 lessons（不推荐，用于重建索引）
     */
    loadAll(goalId) {
        const file = path.join(this.lessonsDir, `${goalId}.md`);
        if (!fs.existsSync(file))
            return [];
        const content = fs.readFileSync(file, 'utf-8');
        return this.parseAllBlocks(content);
    }
    /**
     * 加载相关 lessons（由 RalphLoop 调用，最多 3 条）
     */
    loadRelevant(goalId, keywords, maxResults = 3) {
        const all = this.loadAll(goalId);
        // 简单关键词过滤
        const scored = all.map(l => {
            const score = keywords.filter(kw => l.lesson.toLowerCase().includes(kw.toLowerCase()) ||
                l.domain.toLowerCase().includes(kw.toLowerCase())).length;
            return { lesson: l, score };
        }).sort((a, b) => b.score - a.score);
        return scored.slice(0, maxResults).map(s => s.lesson);
    }
    // ── 渲染/解析辅助 ──
    renderRawBlock(raw) {
        const lines = [
            `### Loop ${raw.loop} (${raw.created_at})`,
            `loop: ${raw.loop}`,
            `trigger: ${raw.trigger}`,
            `result: ${raw.result}`,
            `domain: ${raw.domain}`,
            `task: "${raw.task}"`,
            raw.violation ? `violation:\n  rule: "${raw.violation.rule}"\n  type: ${raw.violation.type}\n  severity: ${raw.violation.severity}` : '',
            raw.root_cause ? `root_cause: ${raw.root_cause}` : '',
            `lesson: "${raw.lesson}"`,
            `energy: ${raw.energy}`,
            `files: [${raw.files.map(f => `"${f}"`).join(', ')}]`,
            ''
        ];
        return lines.join('\n');
    }
    renderCompactedBlock(compacted) {
        const lines = [
            `### Loop ${compacted.loop} (${compacted.created_at})`,
            `loop: ${compacted.loop}`,
            `trigger: ${compacted.trigger}`,
            `result: ${compacted.result}`,
            `domain: ${compacted.domain}`,
            `task: "${compacted.task}"`,
            compacted.violation ? `violation:\n  rule: "${compacted.violation.rule}"\n  type: ${compacted.violation.type}\n  severity: ${compacted.violation.severity}` : '',
            compacted.root_cause ? `root_cause: ${compacted.root_cause}` : '',
            `lesson: "${compacted.lesson}"`,
            `energy: ${compacted.energy}`,
            `files: [${compacted.files.map(f => `"${f}"`).join(', ')}]`,
            `# _compacted: true, saved ${compacted._originalTokens - compacted._compactedTokens} tokens`,
            ''
        ];
        return lines.join('\n');
    }
    parseRawBlock(block) {
        try {
            const loop = parseInt(block.match(/loop:\s*(\d+)/)?.[1] || '0');
            const trigger = block.match(/trigger:\s*(.+)/)?.[1] || '';
            const result = block.match(/result:\s*(.+)/)?.[1] || '';
            const domain = block.match(/domain:\s*(.+)/)?.[1] || '';
            const task = block.match(/task:\s*"?(.+?)"?\s*$/)?.[1] || '';
            const lesson = block.match(/lesson:\s*"?(.+?)"?\s*$/)?.[1] || '';
            const energy = (block.match(/energy:\s*(.+)/)?.[1] || 'medium');
            const files = (block.match(/files:\s*\[(.+?)\]/)?.[1] || '').split(',').map(f => f.trim().replace(/"/g, '')).filter(Boolean);
            return { loop, trigger, result, domain, task, lesson, energy, files, created_at: new Date().toISOString() };
        }
        catch {
            return null;
        }
    }
    parseAllBlocks(content) {
        const blocks = content.split(/###\s+Loop\s+/).filter(Boolean);
        return blocks.map(b => {
            const raw = this.parseRawBlock('Loop ' + b);
            if (!raw)
                return null;
            return { ...raw, _compacted: /_compacted/.test(b), _originalTokens: 0, _compactedTokens: 0 };
        }).filter(Boolean);
    }
    getAnchor(file, block) {
        const content = fs.readFileSync(file, 'utf-8');
        const idx = content.indexOf(block.split('\n')[0]);
        const lines = content.substring(0, idx).split('\n').length;
        return `L${lines}`;
    }
}
exports.LessonManager = LessonManager;
//# sourceMappingURL=lesson-manager.js.map