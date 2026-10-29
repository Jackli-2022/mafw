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

  renderContext(podId: string, node: 'plan' | 'execute' | 'review'): string | null {
    const dir = this.memoryDir(podId);
    const files = ['POD.md', 'POD_MEMORY.md', 'glossary.md'];
    const sections: string[] = [];
    for (const file of files) {
      const target = path.join(dir, file);
      if (!fs.existsSync(target)) continue;
      const content = fs.readFileSync(target, 'utf-8').trim();
      if (!content) continue;
      sections.push(`## ${file}\n${content}`);
    }
    if (sections.length === 0) return null;

    const block = `[POD CONTEXT]\nNode: ${node}\n\n${sections.join('\n\n')}`;
    return block.length <= MAX_CONTEXT_CHARS ? block : block.slice(0, MAX_CONTEXT_CHARS);
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
