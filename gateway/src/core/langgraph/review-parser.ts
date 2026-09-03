export interface ParsedReviewVerdict {
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  feedback: string;
}

const FENCED_BLOCK_RE = /```mafw-review\s*\n([\s\S]*?)```/;

export function parseReviewVerdict(content: string): ParsedReviewVerdict {
  if (!content || content.trim().length === 0) {
    return { verdict: 'ERROR', feedback: 'Review response is empty' };
  }

  const fenced = content.match(FENCED_BLOCK_RE);
  if (fenced) {
    try {
      const data = JSON.parse(fenced[1].trim());
      if (typeof data.verdict !== 'string') {
        return { verdict: 'ERROR', feedback: 'mafw-review block missing verdict field' };
      }
      return {
        verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
        feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}),
      };
    } catch {
      return { verdict: 'ERROR', feedback: 'Malformed mafw-review JSON block' };
    }
  }

  try {
    const data = JSON.parse(content);
    return {
      verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
      feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}),
    };
  } catch {
    return { verdict: 'ERROR', feedback: 'Review report has no machine-readable verdict block' };
  }
}
