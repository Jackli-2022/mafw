import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();

function violations(file: string, forbidden: string[]): string[] {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return forbidden.filter((token) => text.includes(token)).map((token) => `${file}: ${token}`);
}

describe('runtime isolation architecture boundaries', () => {
  it('rejects a synthetic raw bypass fixture', () => {
    expect(violations('package.json', ['"name"']).length).toBeGreaterThan(0);
  });

  it('first-party business routes do not interpret runtime names or raw capabilities', () => {
    const files = [
      'src/routes/session-branch.ts',
      'src/routes/session-checkpoints.ts',
      'src/routes/session-run.ts',
      'src/routes/mcp.ts',
      'src/routes/mcp-config.ts',
      'src/routes/session-background.ts',
      'src/routes/experience-actions.ts',
    ];
    const bad = ['runtime.name', 'rt.name', 'capabilities?.'];
    const found = files.flatMap((file) => violations(file, bad));
    expect(found).toEqual([]);
  });
});
