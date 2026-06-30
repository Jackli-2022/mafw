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
exports.ParametricStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("js-yaml"));
const DEFAULT_CONFIG = {
    baseDir: '.opencode/mafw/parametric',
    bannedDir: '.opencode/mafw/parametric/banned',
    manifestFile: '.opencode/mafw/parametric/base-skill-manifest.yaml'
};
/**
 * Parametric Memory Store
 *
 * L3 参数化记忆的 CRUD + 索引中心。
 * 负责 Constraint/Prompt/Pattern 三类 Δ 的持久化、检索、去重、熔断。
 *
 * 目录结构:
 *   parametric/
 *   ├── prompt-deltas/
 *   ├── constraint-deltas/
 *   ├── pattern-deltas/
 *   ├── banned/
 *   └── base-skill-manifest.yaml
 */
class ParametricStore {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.ensureDirs();
    }
    ensureDirs() {
        [this.config.baseDir, this.config.bannedDir].forEach(d => {
            if (!fs.existsSync(d))
                fs.mkdirSync(d, { recursive: true });
        });
        ['prompt-deltas', 'constraint-deltas', 'pattern-deltas'].forEach(sub => {
            const p = path.join(this.config.baseDir, sub);
            if (!fs.existsSync(p))
                fs.mkdirSync(p, { recursive: true });
        });
    }
    deltaDir(type) {
        return path.join(this.config.baseDir, `${type}-deltas`);
    }
    deltaPath(id, type) {
        return path.join(this.deltaDir(type), `${id}.yaml`);
    }
    /**
     * 保存一个 Δ。如果已存在且内容相同，跳过写入。
     */
    save(delta) {
        const p = this.deltaPath(delta.id, delta.type);
        const data = yaml.dump(delta, { lineWidth: -1 });
        if (fs.existsSync(p)) {
            const existing = fs.readFileSync(p, 'utf-8');
            if (existing === data)
                return; // 无变化，跳过
        }
        fs.writeFileSync(p, data, 'utf-8');
    }
    /**
     * 读取单个 Δ
     */
    load(id, type) {
        const p = this.deltaPath(id, type);
        if (!fs.existsSync(p))
            return null;
        return yaml.load(fs.readFileSync(p, 'utf-8'));
    }
    /**
     * 加载所有未熔断的 Δ
     */
    loadAll() {
        const deltas = [];
        const types = ['constraint', 'prompt', 'pattern'];
        for (const t of types) {
            const dir = this.deltaDir(t);
            if (!fs.existsSync(dir))
                continue;
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
            for (const f of files) {
                const d = yaml.load(fs.readFileSync(path.join(dir, f), 'utf-8'));
                deltas.push(d);
            }
        }
        return deltas;
    }
    /**
     * 根据 trigger_condition 匹配候选 Δ
     */
    match(context) {
        return this.loadAll().filter(d => {
            const tc = d.trigger_condition;
            if (tc.min_loop_count !== undefined && (context.loopCount ?? 0) < tc.min_loop_count)
                return false;
            if (tc.domain && context.domain && !tc.domain.includes(context.domain))
                return false;
            if (tc.task_type && context.taskType && !tc.task_type.includes(context.taskType))
                return false;
            if (tc.loop_stage && context.loopStage && !tc.loop_stage.includes(context.loopStage))
                return false;
            if (tc.keywords && context.goalKeywords) {
                const hasKeyword = tc.keywords.some(kw => context.goalKeywords.some(gk => gk.toLowerCase().includes(kw.toLowerCase())));
                if (!hasKeyword)
                    return false;
            }
            if (tc.affected_file_pattern && context.affectedFiles) {
                const hasPattern = tc.affected_file_pattern.some(pat => context.affectedFiles.some(f => this.matchPattern(f, pat)));
                if (!hasPattern)
                    return false;
            }
            return true;
        });
    }
    matchPattern(file, pattern) {
        // 简单 glob: *.test.ts -> 正则
        const regex = pattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
        return new RegExp(`^${regex}$`).test(file);
    }
    /**
     * 检测单个 Δ 是否震荡（连续 N 次参与 Loop 未通过验证）
     */
    detectOscillation(deltaId, history) {
        const last3 = history.slice(-3);
        const sameReason = last3.length === 3 && last3.every(l => l.result === 'review_fail');
        if (!sameReason)
            return { isOscillating: false };
        return {
            isOscillating: true,
            deltaId,
            reason: 'OSCILLATION: 连续 3 次参与 Loop 均未通过验证',
            suggestion: '该约束可能过于刚性或条件错误，建议手动审查'
        };
    }
    /**
     * 熔断（将 Δ 移入 banned/）
     */
    ban(deltaId, meta) {
        const types = ['constraint', 'prompt', 'pattern'];
        for (const t of types) {
            const src = this.deltaPath(deltaId, t);
            if (fs.existsSync(src)) {
                const dest = path.join(this.config.bannedDir, `${deltaId}.yaml`);
                const data = yaml.load(fs.readFileSync(src, 'utf-8'));
                data._banned = true;
                data._ban_reason = meta.reason;
                data._ban_suggestion = meta.suggestion;
                data._banned_at = new Date().toISOString();
                fs.writeFileSync(dest, yaml.dump(data), 'utf-8');
                fs.unlinkSync(src);
                return;
            }
        }
    }
    /**
     * 去重 + 冲突检测 + 震荡 Δ 自动熔断
     */
    merge(deltas, history) {
        const merged = [];
        const conflicts = [];
        const banned = [];
        const seen = new Map();
        for (const d of deltas) {
            // 1. 去重：相同 ID 保留 energy_score 更高的
            if (seen.has(d.id)) {
                const existing = seen.get(d.id);
                if (d.energy_score > existing.energy_score) {
                    seen.set(d.id, d);
                }
                continue;
            }
            // 2. 震荡检测
            const osc = this.detectOscillation(d.id, history);
            if (osc.isOscillating) {
                this.ban(d.id, { reason: osc.reason, suggestion: osc.suggestion });
                banned.push(d.id);
                conflicts.push({
                    deltaId: d.id,
                    reason: 'oscillation',
                    suggestion: osc.suggestion
                });
                continue;
            }
            seen.set(d.id, d);
        }
        merged.push(...seen.values());
        return { merged, conflicts, banned };
    }
    /**
     * 读取固化清单
     */
    loadManifest() {
        if (!fs.existsSync(this.config.manifestFile)) {
            return { manifest_version: 1, merged_deltas: [] };
        }
        return yaml.load(fs.readFileSync(this.config.manifestFile, 'utf-8'));
    }
    /**
     * 更新固化清单（Archive 阶段由 DeltaValidator 调用）
     */
    updateManifest(manifest) {
        fs.writeFileSync(this.config.manifestFile, yaml.dump(manifest), 'utf-8');
    }
}
exports.ParametricStore = ParametricStore;
//# sourceMappingURL=store.js.map