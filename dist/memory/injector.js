"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeltaInjector = void 0;
/**
 * Delta Injector — L3 参数注入器
 *
 * 职责：将匹配的 Δ 按优先级注入到 Agent 的 System Prompt 中。
 *
 * 注入规则：
 *   1. 按 priority DESC → energy_score DESC 排序
 *   2. 硬截断：最多 5 个 Δ，总 token ≤ 800
 *   3. 三种前缀：
 *      [C-N] constraint-delta (HARD)
 *      [P-N] prompt-delta (SOFT)
 *      [P-N] pattern-delta (PATTERN)
 *   4. 防污染：Agent 输出若包含 [C- 或 [P- 标记，视为违规
 *
 * 注入格式示例：
 *   [PARAMETRIC MEMORY ACTIVE — 3 deltas injected]
 *   [C-1] review-coverage-v2 (HARD): 测试覆盖率低于 80% 的代码必须...
 *   [P-1] wave-decomposition-auth-v1 (PATTERN): Wave 1(契约层)→...
 */
class DeltaInjector {
    MAX_DELTA_COUNT = 5;
    MAX_TOKENS = 800;
    /**
     * 从 ParametricStore 取出匹配的 Δ，排序并截断，生成注入文本。
     */
    inject(deltas) {
        // 1. 排序：priority DESC → energy_score DESC
        const sorted = [...deltas].sort((a, b) => {
            if (b.priority !== a.priority)
                return b.priority - a.priority;
            return b.energy_score - a.energy_score;
        });
        // 2. 硬截断
        const injected = [];
        let totalTokens = 0;
        let truncated = false;
        for (const d of sorted) {
            const deltaTokens = this.estimateTokens(d);
            if (injected.length >= this.MAX_DELTA_COUNT || totalTokens + deltaTokens > this.MAX_TOKENS) {
                truncated = true;
                break;
            }
            injected.push(d);
            totalTokens += deltaTokens;
        }
        return { injected, totalTokens, truncated };
    }
    /**
     * 将注入结果渲染为注入文本块。
     */
    render(injection) {
        if (injection.injected.length === 0)
            return '';
        const lines = [
            `[PARAMETRIC MEMORY ACTIVE — ${injection.injected.length} deltas injected]`
        ];
        let idx = 1;
        for (const d of injection.injected) {
            const prefix = d.type === 'constraint' ? `[C-${idx}]` : `[P-${idx}]`;
            const en = d.enforcement.toUpperCase();
            let body = '';
            if (d.type === 'constraint') {
                body = d.rule;
            }
            else if (d.type === 'prompt') {
                body = d.prompt_delta;
            }
            else if (d.type === 'pattern') {
                body = d.pattern_template;
            }
            // 截断单行显示
            const summary = body.replace(/\n/g, ' ').substring(0, 200);
            lines.push(`${prefix} ${d.id} (${en}): ${summary}`);
            idx++;
        }
        lines.push('---');
        return lines.join('\n') + '\n';
    }
    /**
     * 防污染检测：检查 Agent 输出是否泄露了 [C- 或 [P- 标记。
     */
    checkPollution(agentOutput) {
        const violations = [];
        const pattern = /\[C-\d+\]|\[P-\d+\]/g;
        let match;
        while ((match = pattern.exec(agentOutput)) !== null) {
            violations.push(match[0]);
        }
        return { clean: violations.length === 0, violations };
    }
    /**
     * 简单 token 估算（1 token ≈ 0.75 英文单词，或 ≈ 1 中文字符）
     */
    estimateTokens(d) {
        let text = '';
        if (d.type === 'constraint')
            text = d.rule;
        else if (d.type === 'prompt')
            text = d.prompt_delta;
        else if (d.type === 'pattern')
            text = d.pattern_template;
        // 粗略估算：中文按字符，英文按空格分词
        const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const englishWords = text.split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;
        return Math.ceil(chineseChars + englishWords * 0.75);
    }
}
exports.DeltaInjector = DeltaInjector;
//# sourceMappingURL=injector.js.map