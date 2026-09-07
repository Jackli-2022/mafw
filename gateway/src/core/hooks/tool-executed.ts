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

  if (output.length > 1000) {
    const truncated = output.length > 2000 ? output.slice(0, 500) + '\n... [TRUNCATED] ...\n' + output.slice(-500) : output;
  }

  await captureObservation({ toolName, output, args: '' });
}
