import * as fs from 'fs';
import * as path from 'path';

export interface L5Axiom {
  id: string;
  content: string;
  source: 'manual' | 'distilled';
  energy: number;
  created_at: string;
}

export interface L5Heuristic {
  id: string;
  pattern: string;
  trigger_context: string[];
  success_rate: number;
  source_goal_ids: string[];
  energy: number;
  created_at: string;
}

function generateId(): string {
  return `l5_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class L5Store {
  private baseDir: string;

  constructor(baseDir?: string) {
    const { findGlobalMafwDir } = require('../utils/global-path');
    this.baseDir = baseDir || path.join(findGlobalMafwDir(), 'l5');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private axiomsPath(): string {
    return path.join(this.baseDir, 'axioms.json');
  }

  private heuristicsPath(): string {
    return path.join(this.baseDir, 'heuristics.json');
  }

  loadAxioms(): L5Axiom[] {
    try {
      if (fs.existsSync(this.axiomsPath())) {
        return JSON.parse(fs.readFileSync(this.axiomsPath(), 'utf-8'));
      }
    } catch {}
    return [];
  }

  addAxiom(content: string, source: 'manual' | 'distilled' = 'manual'): L5Axiom {
    const axioms = this.loadAxioms();
    const existing = axioms.find(a => a.content === content);
    if (existing) {
      existing.energy = Math.min(1, existing.energy + 0.1);
      this.saveAxioms(axioms);
      return existing;
    }
    const axiom: L5Axiom = {
      id: generateId(),
      content,
      source,
      energy: 0.8,
      created_at: new Date().toISOString(),
    };
    axioms.push(axiom);
    this.saveAxioms(axioms);
    return axiom;
  }

  private saveAxioms(axioms: L5Axiom[]): void {
    this.ensureDir();
    const tmpPath = this.axiomsPath() + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(axioms, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.axiomsPath());
  }

  loadHeuristics(): L5Heuristic[] {
    try {
      if (fs.existsSync(this.heuristicsPath())) {
        return JSON.parse(fs.readFileSync(this.heuristicsPath(), 'utf-8'));
      }
    } catch {}
    return [];
  }

  addHeuristic(
    pattern: string,
    triggerContext: string[],
    sourceGoalIds: string[]
  ): L5Heuristic {
    const heuristics = this.loadHeuristics();
    const existing = heuristics.find(h => h.pattern === pattern);
    if (existing) {
      existing.success_rate = Math.min(1, existing.success_rate + 0.05);
      existing.energy = Math.min(1, existing.energy + 0.05);
      this.saveHeuristics(heuristics);
      return existing;
    }
    const heuristic: L5Heuristic = {
      id: generateId(),
      pattern,
      trigger_context: triggerContext,
      success_rate: 0.9,
      source_goal_ids: sourceGoalIds,
      energy: 0.8,
      created_at: new Date().toISOString(),
    };
    heuristics.push(heuristic);
    this.saveHeuristics(heuristics);
    return heuristic;
  }

  private saveHeuristics(heuristics: L5Heuristic[]): void {
    this.ensureDir();
    const tmpPath = this.heuristicsPath() + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(heuristics, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.heuristicsPath());
  }

  getTop(topK: number = 3): { axioms: L5Axiom[]; heuristics: L5Heuristic[] } {
    const axioms = this.loadAxioms()
      .sort((a, b) => b.energy - a.energy)
      .slice(0, topK);
    const heuristics = this.loadHeuristics()
      .sort((a, b) => b.energy - a.energy)
      .slice(0, topK);
    return { axioms, heuristics };
  }
}
