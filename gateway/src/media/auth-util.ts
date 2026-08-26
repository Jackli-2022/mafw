import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RuntimeCredentials } from '../runtime/contract';

/**
 * opencode auth.json 默认路径（Windows: ~/.local/share/opencode/auth.json）。
 *
 * 本文件是 credential 回退路径：当 runtime 未提供 credentials 接口时，
 * 直接读取 opencode 的 auth.json。opencode runtime 已将此逻辑包装为
 * `credentials.getApiKey()`，其他 runtime 可提供自己的 credential source。
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

/**
 * 取指定 provider 的 API key。
 * 查找顺序：credentials.getApiKey(provider) → auth.json 回退。
 */
export function getProviderApiKey(
  provider: string,
  authPath?: string,
  credentials?: RuntimeCredentials,
): string | undefined {
  if (credentials) {
    const key = credentials.getApiKey(provider);
    if (key) return key;
  }
  const auth = readOpencodeAuth(authPath);
  const cred = auth[provider];
  if (cred && typeof cred.key === 'string' && cred.key) return cred.key;
  return undefined;
}
