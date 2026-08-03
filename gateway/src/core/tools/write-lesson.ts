import { log } from '../utils/logger';
/**
 * Write Lesson Tool 鈥?鍐欏叆 Lesson tool 鍑芥暟
 *
 * 鑱岃矗锛?
 *   1. 灏?Review 澶辫触缁撴灉鍐欏叆 lessons/{goalId}-loop{loop}.md
 *   2. 鏍煎紡鍖?Lesson 缁撴瀯
 *
 * 琚?mafw-review/entry.ts 璋冪敤銆?
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
 * 鍐欏叆 Lesson 鏂囦欢
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
  log.info(`[write-lesson] Written: ${lessonPath}`);
  
  return lessonPath;
}

/**
 * 鏍煎紡鍖?Lesson 鍐呭
 */
function formatLesson(data: LessonData): string {
  const { goalId, loop, reason, metrics, domain, task } = data;
  
  return `# Lesson: ${goalId} 鈥?Loop ${loop}

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



