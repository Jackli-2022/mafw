import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * opencode auth.json 默认路径（Windows: ~/.local/share/opencode/auth.json）。
 *
 * TODO(runtime-debt): this is a filesystem-level coupling to opencode's private
 * credential store. When supporting other runtimes, abstract behind a
 * "credential provider" interface (e.g., runtime.getCredential(providerName)).
 */
export const DEFAULT_AUTH_PATH = (): string =>
  path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');

export interface ProviderCredential {
  type?: string;
  key?: string;
}

/** 读取 opencode auth.json（provider → { type, key }）。失败返回空对象。 */
export function readOpencodeAuth(authPath?: string): Record<string, ProviderCredential> {
  try {
    const raw = fs.readFileSync(authPath ?? DEFAULT_AUTH_PATH(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    /* missing/corrupt → empty */
  }
  return {};
}

/** 取指定 provider 的 API key。 */
export function getProviderApiKey(provider: string, authPath?: string): string | undefined {
  const auth = readOpencodeAuth(authPath);
  const cred = auth[provider];
  if (cred && typeof cred.key === 'string' && cred.key) return cred.key;
  return undefined;
}
