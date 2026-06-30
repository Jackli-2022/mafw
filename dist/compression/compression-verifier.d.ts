import { CompactedLesson } from '../types/compression';
/**
 * Compression Verifier — 压缩完整性验证器
 *
 * 职责：在 L2 Compaction 后，运行 5 项验证清单，确保压缩不丢失关键信息。
 *
 * 5 项验证：
 *   1. loop 不丢失
 *   2. result 不丢失
 *   3. domain 不丢失
 *   4. lesson 核心动作不丢失
 *   5. violation.rule 不丢失（若存在）
 */
export declare class CompressionVerifier {
    private checks;
    /**
     * 验证单个 CompactedLesson
     */
    verify(original: any, compacted: CompactedLesson): {
        pass: boolean;
        failures: string[];
    };
    /**
     * 批量验证 lessons 文件
     */
    verifyFile(lessons: CompactedLesson[]): {
        pass: boolean;
        failures: string[];
    };
}
//# sourceMappingURL=compression-verifier.d.ts.map