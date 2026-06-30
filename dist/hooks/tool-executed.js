"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolExecutedHook = toolExecutedHook;
async function toolExecutedHook(hookContext) {
    const { toolName, output, projectDir } = hookContext;
    // 检查输出长度
    if (output.length > 1000) {
        console.log(`[hook:tool-executed] Compressing output for ${toolName} (${output.length} chars)`);
        // 简化实现：直接截断输出
        const truncated = output.length > 2000 ? output.slice(0, 500) + '\n... [TRUNCATED] ...\n' + output.slice(-500) : output;
        console.log(`[hook:tool-executed] Output compressed for ${toolName} (${truncated.length} chars)`);
    }
}
//# sourceMappingURL=tool-executed.js.map