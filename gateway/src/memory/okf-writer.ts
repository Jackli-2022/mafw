import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { HarmonicUnit } from '../core/memory/harmonic-types';

export function buildOKF(unit: HarmonicUnit): string {
  const frontmatter: Record<string, any> = {
    type: unit.type === 'semantic' && unit.granularity ? 'knowledge' : unit.type,
    id: unit.id,
    primary_abstraction: unit.primary_abstraction,
    cue_anchors: unit.cue_anchors,
    energy: unit.energy,
    created_at: unit.created_at,
    updated_at: unit.updated_at,
  };
  if (unit.granularity) frontmatter.granularity = unit.granularity;
  if (unit.salience !== undefined) frontmatter.salience = unit.salience;
  if (unit.abstraction_level !== undefined) frontmatter.abstraction_level = unit.abstraction_level;
  if (unit.merged_from?.length) frontmatter.merged_from = unit.merged_from;
  if (unit.superseded_by) frontmatter.superseded_by = unit.superseded_by;
  if (unit.pinned !== undefined) frontmatter.pinned = unit.pinned;
  if (unit.source_session_id) frontmatter.source_session_id = unit.source_session_id;

  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, quotingType: '"' });
  return `---\n${yamlStr}---\n${unit.memory_value}\n`;
}

export function getOKFFilename(unit: HarmonicUnit): string {
  const typeLabel = unit.type === 'semantic' && unit.granularity
    ? 'knowledge'
    : unit.type === 'procedural' ? 'procedural'
    : unit.type === 'episodic' ? 'episodic'
    : unit.type === 'global' ? 'global'
    : 'semantic';
  const slug = unit.primary_abstraction
    .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${typeLabel}-${unit.id}-${slug}.md`;
}

export function getOKFDirectory(unit: HarmonicUnit): string {
  if (unit.type === 'procedural') return 'concepts/procedural';
  if (unit.type === 'semantic' && unit.granularity) return 'concepts/knowledge';
  if (unit.type === 'semantic') return 'concepts/semantic';
  if (unit.type === 'episodic') return 'concepts/episodic';
  if (unit.type === 'global') return 'concepts/global';
  throw new Error(`unknown type ${unit.type} should not be written to OKF directly`);
}

export function writeOKFFile(baseDir: string, unit: HarmonicUnit): string {
  const dir = getOKFDirectory(unit);
  const fileName = getOKFFilename(unit);
  const fullDir = path.join(baseDir, 'memory', dir);
  if (!fs.existsSync(fullDir)) {
    fs.mkdirSync(fullDir, { recursive: true });
  }
  const fullPath = path.join(fullDir, fileName);
  const content = buildOKF(unit);
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fileName;
}
