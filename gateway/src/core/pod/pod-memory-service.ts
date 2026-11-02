import * as fs from 'fs';
import * as path from 'path';
import { PodError } from './pod-store';

const MAX_CONTEXT_CHARS = 4096;
const MEMORY_FILES: Record<'POD' | 'MEMORY' | 'GLOSSARY', string> = {
  POD: 'POD.md',
  MEMORY: 'POD_MEMORY.md',
  GLOSSARY: 'glossary.md',
};

export interface PodMemoryServiceDeps {
  memoryRoot: string;
  now(): string;
}

export class PodMemoryService {
  constructor(private readonly deps: PodMemoryServiceDeps) {}

  memoryDir(podId: string): string {
    const safePodId = podId.replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(this.deps.memoryRoot, safePodId, 'memory');
  }

  ensurePodMemory(podId: string, projectName: string): void {
    const dir = this.memoryDir(podId);
    fs.mkdirSync(dir, { recursive: true });
    const defaults: Record<string, string> = {
      'POD.md': `# ${projectName} Pod\n\n## Charter\n\nProject-scoped agent team.\n`,
      'POD_MEMORY.md': '# Pod Memory\n\n## Decisions\n\n_None yet._\n\n## Lessons\n\n_None yet._\n',
      'glossary.md': '# Glossary\n\n_Project-specific terms._\n',
    };
    for (const [file, content] of Object.entries(defaults)) {
      const target = path.join(dir, file);
      if (!fs.existsSync(target)) fs.writeFileSync(target, content, 'utf-8');
    }
  }

  writeMemory(podId: string, file: 'POD' | 'MEMORY' | 'GLOSSARY', content: string): string {
    const name = MEMORY_FILES[file];
    if (!name) throw new PodError(400, `unknown pod memory file: ${file}`);
    const dir = this.memoryDir(podId);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, name);
    fs.writeFileSync(target, content, 'utf-8');
    return target;
  }

  readMemoryFile(podId: string, file: 'POD' | 'MEMORY' | 'GLOSSARY'): string | null {
    const name = MEMORY_FILES[file];
    if (!name) throw new PodError(400, `unknown pod memory file: ${file}`);
    const target = path.join(this.memoryDir(podId), name);
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null;
  }

  renderContext(podId: string, node: 'plan' | 'execute' | 'review'): string | null {
    const dir = this.memoryDir(podId);
    const files = ['POD.md', 'POD_MEMORY.md', 'glossary.md'];
    const sections: string[] = [];
    const header = `[POD CONTEXT]\nNode: ${node}\n`;
    let remaining = MAX_CONTEXT_CHARS - header.length;

    const append = (title: string, raw: string, limit: number): void => {
      if (remaining <= 0) return;
      const content = raw.trim();
      if (!content) return;
      const prefix = `\n## ${title}\n`;
      const room = Math.min(remaining, limit);
      if (room <= prefix.length) return;
      const bodyRoom = room - prefix.length;
      if (content.length <= bodyRoom) {
        sections.push(`${prefix}${content}`);
        remaining -= prefix.length + content.length;
      } else {
        const marker = '…[truncated]';
        const take = Math.max(0, bodyRoom - marker.length);
        sections.push(`${prefix}${content.slice(0, take)}${marker}`);
        remaining -= prefix.length + take + marker.length;
      }
    };

    // Recent decisions have reserved priority over stable project files.
    let decisionBudget = Math.min(1600, remaining);
    const decisionsDir = path.join(dir, 'decisions');
    if (fs.existsSync(decisionsDir)) {
      const recent = fs.readdirSync(decisionsDir)
        .filter((name) => name.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 3);
      for (const name of recent) {
        if (decisionBudget <= 0) break;
        const target = path.join(decisionsDir, name);
        const content = fs.readFileSync(target, 'utf-8').trim();
        if (!content) continue;
        const before = remaining;
        append(`decision:${name}`, content, decisionBudget);
        decisionBudget -= Math.max(0, before - remaining);
      }
    }

    // Unused decision budget is returned to POD.md / POD_MEMORY.md / glossary.
    for (const file of files) {
      if (remaining <= 0) break;
      const target = path.join(dir, file);
      if (!fs.existsSync(target)) continue;
      append(file, fs.readFileSync(target, 'utf-8'), remaining);
    }

    if (sections.length === 0) return null;
    return `${header}${sections.join('')}`;
  }

  captureGoal(
    podId: string,
    input: { goalId: string; ok: boolean; reviewFeedback?: string; receiptPath?: string },
  ): string {
    const dir = path.join(this.memoryDir(podId), 'decisions');
    fs.mkdirSync(dir, { recursive: true });
    const date = this.deps.now().slice(0, 10);
    const safeGoalId = input.goalId.replace(/[^A-Za-z0-9._-]/g, '_');
    const target = path.join(dir, `${date}-${safeGoalId}.md`);
    const lines = [
      `# Goal ${input.goalId}`,
      '',
      `- ok: ${input.ok}`,
      `- review: ${input.reviewFeedback ?? ''}`,
      `- receipt: ${input.receiptPath ?? ''}`,
      '',
    ];
    fs.writeFileSync(target, lines.join('\n'), 'utf-8');
    return target;
  }
}
