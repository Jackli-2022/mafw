import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';
import { generateHarmonicId } from './harmonic-types';

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: string[];
}

export async function migrateV61(baseDir: string, indexManager: HarmonicIndexManager): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] };
  const memoryDir = path.join(baseDir, 'memory');

  for (const dir of ['tier2', 'tier3', 'tier4', 'l5']) {
    const d = path.join(memoryDir, dir);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  // lessons/ → tier2/ (episodic)
  const lessonsDir = path.join(baseDir, 'lessons');
  if (fs.existsSync(lessonsDir)) {
    const files = fs.readdirSync(lessonsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(lessonsDir, file), 'utf-8');
        const unit: HarmonicUnit = {
          id: generateHarmonicId(),
          type: 'episodic',
          primary_abstraction: file.replace(/\.[^.]+$/, '').slice(0, 50),
          cue_anchors: extractAnchors(content),
          memory_value: content.slice(0, 1000),
          energy: 0.5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const tier2File = path.join(memoryDir, 'tier2.json');
        const existing = fs.existsSync(tier2File) ? JSON.parse(fs.readFileSync(tier2File, 'utf-8')) : [];
        existing.push(unit);
        fs.writeFileSync(tier2File, JSON.stringify(existing, null, 2), 'utf-8');
        indexManager.addEntry(unit, 'tier2');
        result.migrated++;
      } catch (err: any) {
        result.errors.push(`lessons/${file}: ${err.message}`);
      }
    }
  }

  // parametric/ → tier3/ (semantic)
  const parametricDir = path.join(baseDir, 'parametric');
  if (fs.existsSync(parametricDir)) {
    const files = fs.readdirSync(parametricDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(parametricDir, file), 'utf-8');
        const unit: HarmonicUnit = {
          id: generateHarmonicId(),
          type: 'semantic',
          primary_abstraction: file.replace(/\.[^.]+$/, '').slice(0, 50),
          cue_anchors: extractAnchors(content),
          memory_value: content.slice(0, 1000),
          energy: 0.6,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const tier3File = path.join(memoryDir, 'tier3.json');
        const existing = fs.existsSync(tier3File) ? JSON.parse(fs.readFileSync(tier3File, 'utf-8')) : [];
        existing.push(unit);
        fs.writeFileSync(tier3File, JSON.stringify(existing, null, 2), 'utf-8');
        indexManager.addEntry(unit, 'tier3');
        result.migrated++;
      } catch (err: any) {
        result.errors.push(`parametric/${file}: ${err.message}`);
      }
    }
  }

  // Backup old directories
  const backupDir = path.join(baseDir, '.backup-v61');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  for (const oldDir of ['lessons', 'parametric']) {
    const src = path.join(baseDir, oldDir);
    if (fs.existsSync(src)) {
      const dest = path.join(backupDir, oldDir);
      if (!fs.existsSync(dest)) fs.renameSync(src, dest);
    }
  }

  return result;
}

function extractAnchors(content: string): string[] {
  const anchors = new Set<string>();
  const patterns = [
    /(jwt|oauth|bcrypt|auth)/gi, /(error|fail|exception)/gi,
    /(coverage|test|jest)/gi, /(api|endpoint|route)/gi,
    /(config|setting|env)/gi, /(async|await|promise)/gi
  ];
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) matches.forEach(m => anchors.add(m.toLowerCase()));
  }
  return Array.from(anchors).slice(0, 8);
}
