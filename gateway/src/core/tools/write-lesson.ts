/**
 * Write Lesson Tool — 写入 Lesson tool 函数
 *
 * 职责：
 *   1. 将 Review 失败结果写入 lessons/{goalId}-loop{loop}.md
 *   2. 格式化 Lesson 结构
 *
 * 被 mafw-review/entry.ts 调用。
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LessonData {
  goalId: string;
  loop: number;
  reason: string;
  metrics: Record<string, number>;
  domain?: string;
  task?: string;
}

/**
 * 写入 Lesson 文件
 */
export function writeLesson(data: LessonData, projectDir: string = '.'): string {
  const { goalId, loop, reason, metrics, domain = 'general', task = 'unknown' } = data;
  
  const lessonsDir = path.join(projectDir, '.mafw/lessons');
  if (!fs.existsSync(lessonsDir)) {
    fs.mkdirSync(lessonsDir, { recursive: true });
  }

  const lessonPath = path.join(lessonsDir, `${goalId}-loop${loop}.md`);
  const content = formatLesson(data);
  
  fs.writeFileSync(lessonPath, content, 'utf-8');
  console.log(`[write-lesson] Written: ${lessonPath}`);
  
  return lessonPath;
}

/**
 * 格式化 Lesson 内容
 */
function formatLesson(data: LessonData): string {
  const { goalId, loop, reason, metrics, domain, task } = data;
  
  return `# Lesson: ${goalId} — Loop ${loop}

## Trigger

Review failed: ${reason}

## Context

- Goal: ${goalId}
- Loop: ${loop}
- Domain: ${domain}
- Task: ${task}

## Metrics

${Object.entries(metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Root Cause

${reason}

## Recommendation

Address the above issues in the next loop.

---
_generated: ${new Date().toISOString()}_
`;
}
