const fs = require('fs');
const path = require('path');

const loggerFile = path.resolve('gateway/src/core/utils/logger.ts');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;

  content = content.replace(/console\.log\(/g, 'log.info(');
  content = content.replace(/console\.warn\(/g, 'log.warn(');
  content = content.replace(/console\.error\(/g, 'log.error(');

  if (content === original) return;

  const fileDir = path.dirname(filePath);
  const loggerDir = path.dirname(loggerFile);
  let rel = path.relative(fileDir, loggerDir).replace(/\\/g, '/');
  if (!rel.startsWith('../')) rel = './' + rel;
  if (!rel.endsWith('/logger')) rel += '/logger';
  const importLine = "import { log } from '" + rel + "';";

  const firstImport = content.match(/^(import\s.*?;\s*\n?)+/);
  if (firstImport) {
    content = content.replace(firstImport[0], firstImport[0] + '\n' + importLine + '\n');
  } else {
    content = importLine + '\n\n' + content;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(path.relative(process.cwd(), filePath) + ' -> ' + rel);
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && e.name !== 'public' && e.name !== 'dashboard') walk(p);
    } else if (e.isFile() && e.name.endsWith('.ts') && !p.endsWith('logger.ts')) {
      processFile(p);
    }
  }
}

walk('gateway/src');
console.log('Done');
