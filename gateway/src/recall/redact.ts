// Secret redaction for the observation pipeline. Applied once at capture time
// (before t1_observations insert) so every downstream consumer (turnCompress
// transcripts, worker prompts, archives) only ever sees redacted content.
// Deterministic regex pass — no LLM, no false-negative risk beyond pattern
// coverage; deliberately conservative about false positives (prose like
// "token budget" or "the secret sauce" must survive).

const PLACEHOLDER = '[REDACTED]';

// Ordered: specific token formats first, generic key=value forms last.
const PATTERNS: RegExp[] = [
  // Bearer tokens in Authorization-style headers
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g,
  // OpenAI / DashScope / OpenRouter / Anthropic style: sk-..., sk-or-v1-..., sk-ant-...
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // GitHub tokens
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // AWS access key ids
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  // JWTs (header.payload.signature)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
  // Generic key=value / "key": "value" secret forms. Keys are explicit
  // (optionally wrapped in quotes); values must be >= 8 non-delimiter chars so
  // prose ("password length", short numerics) is untouched. Quoted values
  // keep their quotes.
  // group1 keeps everything through the opening value quote; the closing
  // quote stays outside the match so it survives in place.
  /((?:"?)\b(?:api[_-]?key|apikey|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret|password|passwd)\b"?\s*[=:]\s*")[^"\s]{8,}/gi,
  // "[" excluded from values so an already-written [REDACTED] placeholder is
  // never re-matched by this pass.
  /((?:"?)\b(?:api[_-]?key|apikey|api[_-]?secret|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret|password|passwd)\b"?\s*[=:]\s*)[^\s"',\][]{8,}/gi,
];

export function redactSecrets(content: string): string {
  if (!content) return content;
  let out = content;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match, ...rest: unknown[]) => {
      // Group-free patterns: first rest arg is the numeric offset, replace
      // wholesale. Patterns with one capture group keep the captured prefix
      // (e.g. "Bearer ", "api_key=").
      const group1 = rest[0];
      return typeof group1 === 'string' ? `${group1}${PLACEHOLDER}` : PLACEHOLDER;
    });
  }
  return out;
}
