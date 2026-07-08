"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeltaMerger = void 0;
class DeltaMerger {
    hookManager;
    constructor(hookManager) {
        this.hookManager = hookManager || null;
    }
    /**
     * 合并候选 Δ 列表，去重并解决冲突。
     */
    merge(deltas) {
        const merged = new Map();
        const conflicts = [];
        const banned = [];
        for (const d of deltas) {
            // 1. 严格去重：相同 ID
            if (merged.has(d.id)) {
                const existing = merged.get(d.id);
                this.hookManager?.execute('memory.contradiction', {
                    existingId: existing.id,
                    newId: d.id,
                    field: 'id',
                    existingValue: existing.id,
                    newValue: d.id
                });
                if (d.energy_score > existing.energy_score) {
                    conflicts.push({
                        deltaId: d.id,
                        reason: 'superseded',
                        suggestion: `新版本 energy_score 更高 (${d.energy_score} > ${existing.energy_score})`
                    });
                    merged.set(d.id, d);
                }
                else {
                    conflicts.push({
                        deltaId: d.id,
                        reason: 'duplicate',
                        suggestion: '保留能量分更高的版本'
                    });
                }
                continue;
            }
            // 2. 语义去重：相同 rule / prompt_delta 内容（简化）
            const semanticDup = this.findSemanticDuplicate(d, merged.values());
            if (semanticDup) {
                conflicts.push({
                    deltaId: d.id,
                    reason: 'duplicate',
                    suggestion: `语义重复于 ${semanticDup.id}`
                });
                this.hookManager?.execute('memory.contradiction', {
                    existingId: semanticDup.id,
                    newId: d.id,
                    field: 'content',
                    existingValue: this.getContent(semanticDup).substring(0, 100),
                    newValue: this.getContent(d).substring(0, 100)
                });
                if (d.energy_score > semanticDup.energy_score) {
                    merged.set(d.id, d);
                    merged.delete(semanticDup.id);
                }
                continue;
            }
            merged.set(d.id, d);
        }
        return {
            merged: Array.from(merged.values()),
            conflicts,
            banned
        };
    }
    /**
     * 查找语义重复的 Δ（简单：rule 或 prompt_delta 前 100 字符相同）
     */
    findSemanticDuplicate(d, existing) {
        const dContent = this.getContent(d).substring(0, 100);
        for (const e of existing) {
            if (this.getContent(e).substring(0, 100) === dContent) {
                return e;
            }
        }
        return null;
    }
    getContent(d) {
        if (d.type === 'constraint')
            return d.rule || '';
        if (d.type === 'prompt')
            return d.prompt_delta || '';
        if (d.type === 'pattern')
            return d.pattern_template || '';
        return '';
    }
}
exports.DeltaMerger = DeltaMerger;
//# sourceMappingURL=merger.js.map