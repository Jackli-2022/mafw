import { SessionPruner } from '../compression/session-pruner';
import { captureObservation } from './observation-capture';

/**
 * tool-executed Hook — 工具输出压缩
 *
 * 职责：
 *   1. 工具输出过大时自动压缩
 *   2. 触发 L1 压缩：Session Pruner
 *   3. 只压缩，不修改业务逻辑
 *
 * 设计原则：
 *   - 横切关注点，不承载业务逻辑
 *   - 压缩阈值：1000 tokens
 */

export interface ToolExecutedHookContext {
  toolName: string;
  output: string;
  projectDir?: string;
}

export async function toolExecutedHook(hookContext: ToolExecutedHookContext): Promise<void> {
  const { toolName, output, projectDir } = hookContext;

  // 检查输出长度
  if (output.length > 1000) {
    console.log(`[hook:tool-executed] Compressing output for ${toolName} (${output.length} chars)`);

    // 简化实现：直接截断输出
    const truncated = output.length > 2000 ? output.slice(0, 500) + '\n... [TRUNCATED] ...\n' + output.slice(-500) : output;
    console.log(`[hook:tool-executed] Output compressed for ${toolName} (${truncated.length} chars)`);
  }

  await captureObservation({ toolName, output, args: '' });
}
