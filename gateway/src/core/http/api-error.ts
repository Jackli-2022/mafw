/**
 * 框架边界机器可读错误码（E3-3）。
 *
 * 只用于框架层（transport auth/loopback/outer catch、registry dispatch auth、
 * kernel capability guard、schema epoch handshake）。路由内业务错误的信封不在此
 * 迁移——错误格式按层收敛，避免改变既有 handler 的 wire 形状。
 *
 * `error` 字段始终保留（既有客户端按字符串消费），`code` 为 additive。
 */
export const API_ERROR_CODES = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  capability_unavailable: 'capability_unavailable',
  schema_epoch_mismatch: 'schema_epoch_mismatch',
  not_found: 'not_found',
  internal: 'internal',
} as const;

export type ApiErrorCode = typeof API_ERROR_CODES[keyof typeof API_ERROR_CODES];

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  retryable?: boolean;
}

/** 统一框架错误信封：`{ error: <原字符串>, code, retryable? }`。 */
export function errorBody(
  message: string,
  code: ApiErrorCode,
  retryable?: boolean,
): ApiErrorBody {
  const body: ApiErrorBody = { error: message, code };
  if (retryable !== undefined) body.retryable = retryable;
  return body;
}
