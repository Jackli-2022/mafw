// Legacy route inventory: groups index.ts's remaining if-chain dispatch checks
// (req.url?.match / startsWith / ===) by path prefix. --json emits machine-
// readable output consumed by tests/unit/architecture/legacy-route-inventory.test.ts.
// Every Phase D1 migration task updates the expected numbers DOWN as branches
// are deleted; the end state pins only the static/MCP/root transport branches.
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'src', 'index.ts');
const lines = fs.readFileSync(indexPath, 'utf-8').split('\n');
const hits = [];
lines.forEach((l, i) => {
  for (const re of [
    /req\.url\?\.match\(\s*(\/\^?[^\s)]*?\/[a-z]*)/g,
    /req\.url\?\.startsWith\(\s*['"]([^'"]+)['"]/g,
    /req\.url\?\.match\(\s*['"]([^'"]+)['"]/g,
  ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(l))) hits.push({ line: i + 1, raw: m[1], kind: 'match' });
  }
  for (const re of [/req\.url === ['"]([^'"]+)['"]/g, /req\.url\?\.=== ['"]([^'"]+)['"]/g]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(l))) hits.push({ line: i + 1, raw: m[1], kind: 'equals' });
  }
});

function norm(raw) {
  let p = raw;
  if (p.startsWith('/')) p = p.slice(1); // regex literal: strip the /pattern/ delimiter
  p = p.replace(/\\?\//g, '/');
  p = p.replace(/^\^/, '');
  p = p.split('?')[0].split('(')[0].split('[')[0];
  return p.replace(/\$$/, '');
}

const groups = {};
for (const h of hits) {
  const p = norm(h.raw);
  const seg = p.split('/').filter(Boolean);
  const g = '/' + (seg.slice(0, seg[0] === 'api' ? 2 : 1).join('/'));
  (groups[g] = groups[g] || []).push(h);
}

const out = {
  total: hits.length,
  byKind: {
    match: hits.filter((h) => h.kind === 'match').length,
    equals: hits.filter((h) => h.kind === 'equals').length,
  },
  groups: Object.entries(groups)
    .map(([prefix, list]) => ({ prefix, count: list.length, lines: [list[0].line, list[list.length - 1].line] }))
    .sort((a, b) => b.count - a.count),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const g of out.groups) {
    console.log(String(g.count).padStart(3), g.prefix.padEnd(24), 'lines', g.lines[0] + '-' + g.lines[1]);
  }
  console.log('TOTAL', out.total, `(match ${out.byKind.match}, equals ${out.byKind.equals})`);
}
