import * as fs from 'fs';
import * as path from 'path';
import type { TaskEntity } from './task-service';

/** 每任务一个 JSON 文件（~/.mafw/tasks/<id>.json），tmp+rename 原子写。 */
export class TaskStore {
  constructor(private readonly dir: string) {}

  pathOf(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  loadAll(): TaskEntity[] {
    if (!this.dir || !fs.existsSync(this.dir)) return [];
    const out: TaskEntity[] = [];
    for (const file of fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'))) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf-8')) as TaskEntity;
        if (!task?.id || (task.kind !== 'shell' && task.kind !== 'subagent')) continue;
        if (!['working', 'input_required', 'completed', 'failed', 'cancelled'].includes(task.status)) continue;
        out.push(task);
      } catch {
        // Corrupt task files are skipped; they must not block gateway startup.
      }
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  save(task: TaskEntity): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.pathOf(task.id);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(task, null, 2), 'utf-8');
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
    }
  }
}
