import { log } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { WaveDigest } from '../types/compression';

/**
 * Wave Executor —Wave 璋冨害 + Task 骞惰鎵ц鍣?(v2.1)
 *
 * 鎸?Goal 闅旂锛氭墍鏈?Wave/Task 鍦ㄥ悓涓€涓?Goal 鍒嗘敮涓婃墽琛屻€?
 * 涓嶅啀涓烘瘡涓?Task 鍒涘缓鐙珛鍒嗘敮銆?
 *
 * 鑱岃矗锛?
 *   1. 涓茶鎵ц Wave锛圵ave 闂存湁渚濊禆锛?
 *   2. 姣忎釜 Wave 鍐呭苟琛屾墽琛?Task锛堝叡浜悓涓€涓?Goal 鍒嗘敮锛?
 *   3. 宸ュ叿杈撳嚭 > 1000 tokens 鏃舵埅鏂?
 */
export class WaveExecutor {
  private projectDir: string;

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
  }

  async run(waves: any[], goalId: string, loopCount: number): Promise<any> {
    const results: any[] = [];
    const digests: WaveDigest[] = [];

    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i];
      log.info(`  [WaveExecutor] Wave ${i + 1}/${waves.length}: ${wave.name}`);

      // Wave 鍐?Task 骞惰锛堝湪鍚屼釜 Goal 鍒嗘敮涓婏級
      const waveResult = await this.executeWave(wave, goalId, loopCount);
      results.push(waveResult);

      // 鐢熸垚 Wave 鎽樿
      const digest = this.createDigest(wave, waveResult, i + 1);
      digests.push(digest);

      // 宸ュ叿杈撳嚭鎴柇
      this.truncateToolOutputs(waveResult);
    }

    return {
      waves: results,
      digests,
      loopCount,
      domain: waves[0]?.domain || 'general',
      currentTask: waves[waves.length - 1]?.tasks?.[waves[waves.length - 1].tasks.length - 1]?.id || 'unknown',
      filesChanged: this.collectFilesChanged(results)
    };
  }

  private async executeWave(wave: any, goalId: string, loopCount: number): Promise<any> {
    const tasks = wave.tasks || [];
    // 鎵€鏈?Task 鍦ㄥ悓涓?Goal 鍒嗘敮涓婂苟琛屾墽琛?
    const taskResults = await Promise.all(
      tasks.map((task: any) => this.executeTask(task, goalId, loopCount))
    );
    return { waveId: wave.id, tasks: taskResults, status: 'completed' };
  }

  private async executeTask(task: any, goalId: string, loopCount: number): Promise<any> {
    log.info(`    [Task] ${task.id} (goal ${goalId}): ${task.description}`);

    // 妯℃嫙鎵ц
    const result = {
      taskId: task.id,
      status: 'completed',
      filesChanged: task.affected_files || [],
      metrics: {
        coverage: Math.floor(Math.random() * 40) + 60,
        lint_errors: 0
      },
      output: ''
    };

    return result;
  }

  /**
   * L1 瀹炴椂锛氬伐鍏疯緭鍑烘埅鏂?
   */
  private truncateToolOutputs(waveResult: any): void {
    for (const task of waveResult.tasks || []) {
      if (task.output && task.output.length > 1000) {
        const lines = task.output.split('\n');
        const lastLines = lines.slice(-10);
        task.output = `[TRUNCATED: ${lines.length} lines 鈫?last 10]\n${lastLines.join('\n')}`;
        task._truncated = true;
      }
    }
  }

  private createDigest(wave: any, waveResult: any, waveNum: number): WaveDigest {
    return {
      id: `wave-${waveNum}`,
      status: waveResult.tasks.every((t: any) => t.status === 'completed') ? 'PASS' : 'FAIL',
      tokens_saved: 0,
      domain: wave.domain || 'general',
      completed_tasks: waveResult.tasks.map((t: any) => t.taskId),
      key_decisions: wave.key_decisions || [],
      metrics: {
        coverage: waveResult.tasks.reduce((sum: number, t: any) => sum + (t.metrics?.coverage || 0), 0) / (waveResult.tasks.length || 1),
        lint_errors: waveResult.tasks.reduce((sum: number, t: any) => sum + (t.metrics?.lint_errors || 0), 0)
      },
      blockers: waveResult.tasks.filter((t: any) => t.status !== 'completed').map((t: any) => t.taskId),
      files_changed: this.collectFilesChanged([waveResult])
    };
  }

  private collectFilesChanged(results: any[]): string[] {
    const files = new Set<string>();
    for (const r of results) {
      for (const task of r.tasks || []) {
        for (const f of task.filesChanged || []) files.add(f);
      }
    }
    return Array.from(files);
  }

  /**
   * Goal 瀹屾垚鍚庡悎骞跺埌 main
   */
  async mergeToMain(goalId: string): Promise<void> {
    log.info(`[WaveExecutor] Goal ${goalId} completed, merging to main`);
  }
}



