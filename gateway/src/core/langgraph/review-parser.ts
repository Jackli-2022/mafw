export interface ParsedReviewVerdict {
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  feedback: string;
}

const FENCED_BLOCK_RE = /```mafw-review\s*\n([\s\S]*?)```/;

/** 兼容模型偶发的双重 stringify：对象被转成字符串后再写进围栏块。 */
function decodePayload(value: unknown): unknown {
  let payload = value;
  for (let i = 0; i < 3 && typeof payload === 'string'; i++) {
    try {
      payload = JSON.parse(payload);
    } catch {
      break;
    }
  }
  return payload;
}

export function parseReviewVerdict(content: string): ParsedReviewVerdict {
  if (!content || content.trim().length === 0) {
    return { verdict: 'ERROR', feedback: 'Review response is empty' };
  }

  const fenced = content.match(FENCED_BLOCK_RE);
  if (fenced) {
    try {
      const data: any = decodePayload(JSON.parse(fenced[1].trim()));
      if (typeof data?.verdict !== 'string') {
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
    const data: any = decodePayload(JSON.parse(content));
    if (typeof data?.verdict !== 'string') {
      return { verdict: 'ERROR', feedback: 'mafw-review block missing verdict field' };
    }
    return {
      verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
      feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}),
    };
  } catch {
    return { verdict: 'ERROR', feedback: 'Review report has no machine-readable verdict block' };
  }
}
