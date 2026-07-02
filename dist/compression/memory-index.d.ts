import { MemoryIndexEntry } from '../types/compression';
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
export declare class MemoryIndexManager {
    private indexPath;
    private index;
    private bm25;
    constructor(indexPath?: string);
    private load;
    save(): void;
    /**
     * 添加一个 lesson 条目到索引
     */
    add(entry: MemoryIndexEntry): void;
    /**
     * 根据关键词检索相关 lessons，最多 3 条，按 energy 排序。
     */
    search(keywords: string[], domain?: string, maxResults?: number): MemoryIndexEntry[];
    /**
     * BM25 关键词搜索
     */
    searchBM25(query: string, topK?: number): Array<{
        id: string;
        score: number;
        text: string;
    }>;
    /**
     * 从关键词自动提取 tags（简单分词）
     */
    static extractTags(text: string): string[];
    /**
     * 重建完整索引（用于手动清理后）
     */
    rebuild(lessonsDir?: string): void;
}
//# sourceMappingURL=memory-index.d.ts.map