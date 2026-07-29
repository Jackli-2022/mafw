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
exports.MemoryIndexManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const bm25_index_1 = require("./bm25-index");
/**
 * Memory Index — L2 倒排索引检索器
 *
 * 职责：为 lessons 文件建立轻量级倒排索引，Plan Agent 启动时
 * 根据 Goal Charter 关键词检索最多 3 条相关 lessons，总 token ≤ 1200。
 *
 * 不需要向量数据库。单个 Goal 内 lessons 通常 < 20 条。
 *
 * 索引结构：
 *   {
 *     "version": "1",
 *     "entries": [...],
 *     "inverted_index": { "jwt": ["id1"], "coverage": ["id1", "id2"] },
 *     "domain_index": { "auth": ["id1"], "viz": ["id2"] }
 *   }
 */
class MemoryIndexManager {
    indexPath;
    index;
    bm25;
    constructor(indexPath = '.mafw/memory-index.json') {
        this.indexPath = indexPath;
        this.index = this.load();
        this.bm25 = new bm25_index_1.BM25Index();
    }
    load() {
        if (!fs.existsSync(this.indexPath)) {
            return { version: '1', entries: [], inverted_index: {}, domain_index: {} };
        }
        return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
    }
    save() {
        fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf-8');
    }
    /**
     * 添加一个 lesson 条目到索引
     */
    add(entry) {
        // 去重：相同 ID 更新
        const existingIdx = this.index.entries.findIndex(e => e.id === entry.id);
        if (existingIdx >= 0) {
            this.index.entries[existingIdx] = entry;
        }
        else {
            this.index.entries.push(entry);
        }
        // 更新倒排索引
        for (const tag of entry.tags) {
            if (!this.index.inverted_index[tag])
                this.index.inverted_index[tag] = [];
            if (!this.index.inverted_index[tag].includes(entry.id)) {
                this.index.inverted_index[tag].push(entry.id);
            }
        }
        // 更新 domain 索引 (使用 goal 字段)
        if (entry.goal) {
            if (!this.index.domain_index[entry.goal])
                this.index.domain_index[entry.goal] = [];
            if (!this.index.domain_index[entry.goal].includes(entry.id)) {
                this.index.domain_index[entry.goal].push(entry.id);
            }
        }
        // Also index into BM25 for keyword search
        this.bm25.addDocument(entry.id, entry.tags.join(' '));
    }
    /**
     * 根据关键词检索相关 lessons，最多 3 条，按 energy 排序。
     */
    search(keywords, domain, maxResults = 3) {
        const scores = new Map();
        // 1. 关键词匹配（倒排索引）
        for (const kw of keywords) {
            const lowerKw = kw.toLowerCase();
            for (const [tag, ids] of Object.entries(this.index.inverted_index)) {
                if (tag.toLowerCase().includes(lowerKw)) {
                    for (const id of ids) {
                        scores.set(id, (scores.get(id) || 0) + 1);
                    }
                }
            }
        }
        // 2. domain 匹配（加权）
        if (domain && this.index.domain_index[domain]) {
            for (const id of this.index.domain_index[domain]) {
                scores.set(id, (scores.get(id) || 0) + 2);
            }
        }
        // 3. 按分数 + energy 排序，取前 N
        const scored = Array.from(scores.entries())
            .map(([id, score]) => {
            const entry = this.index.entries.find(e => e.id === id);
            return { id, score, entry };
        })
            .filter(x => x.entry)
            .sort((a, b) => {
            if (b.score !== a.score)
                return b.score - a.score;
            return (b.entry.energy || 0) - (a.entry.energy || 0);
        })
            .slice(0, maxResults)
            .map(x => x.entry);
        return scored;
    }
    /**
     * BM25 关键词搜索
     */
    searchBM25(query, topK = 10) {
        return this.bm25.search(query, topK);
    }
    /**
     * 从关键词自动提取 tags（简单分词）
     */
    static extractTags(text) {
        const words = text
            .toLowerCase()
            .replace(/[^\u4e00-\u9fff\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2);
        return Array.from(new Set(words));
    }
    /**
     * 重建完整索引（用于手动清理后）
     */
    rebuild(lessonsDir = '.mafw/lessons') {
        this.index = { version: '1', entries: [], inverted_index: {}, domain_index: {} };
        if (!fs.existsSync(lessonsDir))
            return;
        const files = fs.readdirSync(lessonsDir).filter(f => f.endsWith('.md'));
        for (const f of files) {
            const content = fs.readFileSync(path.join(lessonsDir, f), 'utf-8');
            // 简单解析：按 "### Loop N" 分割
            const loops = content.split(/###\s+Loop\s+\d+/).slice(1);
            // 这里只做占位，实际需更复杂的 YAML front-matter 解析
            // 为简化，假设每个 lesson 文件已包含 YAML 块
            const tags = MemoryIndexManager.extractTags(content);
            const entry = {
                id: `${f.replace('.md', '')}-loop-1`,
                file: path.join(lessonsDir, f),
                anchor: 'L1',
                tags,
                energy: 0.5,
                type: 'constraint_source',
                loop: 1,
                goal: f.replace('.md', '')
            };
            this.add(entry);
        }
        this.save();
    }
}
exports.MemoryIndexManager = MemoryIndexManager;
//# sourceMappingURL=memory-index.js.map