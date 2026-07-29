import * as fs from 'fs';
import * as yaml from 'js-yaml';

export interface OKFResult {
  unit: Record<string, any>;
  body: string;
  links: string[];
}

const LINK_REGEX = /\[\[([^\]]+)\]\]/g;

export function parseOKF(content: string): OKFResult {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Invalid OKF format: missing frontmatter');
  const frontmatter = yaml.load(match[1]) as Record<string, any>;
  const body = match[2].trim();
  const links: string[] = [...(frontmatter.links || [])];
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = LINK_REGEX.exec(body)) !== null) {
    links.push(linkMatch[1]);
  }
  return { unit: frontmatter, body, links: [...new Set(links)] };
}

export function readOKFFile(filePath: string): OKFResult {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseOKF(content);
}
