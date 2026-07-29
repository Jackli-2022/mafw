export class DiffCompressor {
  compress(fileChanges: any[]): any {
    if (!fileChanges || fileChanges.length === 0) {
      return {
        type: 'diff',
        facts: [],
        concepts: [],
        energy: 0,
        sourceLoops: [],
      };
    }

    const files = new Set<string>();
    let added = 0;
    let modified = 0;
    let deleted = 0;
    const keyPatterns = [/auth/i, /jwt/i, /security/i, /config/i, /api/i];
    const keyChanges: string[] = [];
    const sourceLoops = new Set<number>();
    const concepts = new Set<string>();

    for (const change of fileChanges) {
      if (change.filePath) {
        files.add(change.filePath);
      }

      if (change.type === 'add' || change.status === 'added') {
        added++;
      } else if (change.type === 'delete' || change.status === 'deleted') {
        deleted++;
      } else {
        modified++;
      }

      if (change.loopNum !== undefined) {
        sourceLoops.add(change.loopNum);
      }

      const checkText = `${change.filePath || ''} ${change.content || ''}`;
      for (const pattern of keyPatterns) {
        if (pattern.test(checkText)) {
          keyChanges.push(change.filePath || 'unknown');
          break;
        }
      }

      if (change.filePath) {
        const parts = change.filePath.replace(/\\/g, '/').split('/');
        for (const part of parts) {
          if (part.length > 2 && !concepts.has(part)) {
            concepts.add(part);
          }
        }
      }
    }

    const facts: string[] = [];
    facts.push(`Files changed: ${files.size} (${added} added, ${modified} modified, ${deleted} deleted)`);
    if (keyChanges.length > 0) {
      facts.push(`Key changes: ${[...new Set(keyChanges)].join(', ')}`);
    }

    return {
      type: 'diff',
      facts,
      concepts: [...concepts].slice(0, 10),
      energy: Math.min(1, fileChanges.length / 10),
      sourceLoops: [...sourceLoops],
    };
  }
}
