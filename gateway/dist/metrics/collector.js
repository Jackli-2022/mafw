"use strict";
/**
 * Metrics Collector — Gateway 运行时指标收集
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsCollector = void 0;
class MetricsCollector {
    metrics = [];
    async record(data) {
        this.metrics.push(data);
        // 限制内存中的指标数量
        if (this.metrics.length > 1000) {
            this.metrics = this.metrics.slice(-500);
        }
    }
    async getSnapshot() {
        return {
            totalGoals: new Set(this.metrics.map(m => m.goalId)).size,
            activePhases: this.metrics.reduce((acc, m) => {
                acc[m.phase] = (acc[m.phase] || 0) + 1;
                return acc;
            }, {}),
            recent: this.metrics.slice(-50)
        };
    }
}
exports.MetricsCollector = MetricsCollector;
