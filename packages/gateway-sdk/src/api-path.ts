/**
 * P3 编译期路径漂移守卫。
 *
 * ApiPath 由 contract/openapi.json 经 openapi-typescript 生成的 paths 接口推导：
 * request()/fetchPath() 的 path 参数只能是 contract 内声明的路径（{param} 段放宽为
 * ${string} 模板，并允许路径后拼接 query）——写错路径/删路由未改 contract 直接 tsc 红。
 * 保护等级：路径静态前缀 + 参数段形状（后缀尾巴放行）；逐段精确校验由
 * contract.test.ts 运行时漂移测试互补兜底。
 */
import type { paths } from './api-schema.gen'

/** contract 路径中的 {param} 段 → ${string} 模板段。 */
type PathTemplate<S extends string> = S extends `${infer A}{${infer P}}${infer B}`
  ? `${A}${string}${PathTemplate<B>}`
  : S

export type ApiPath = {
  [K in keyof paths & string]: PathTemplate<K> | `${PathTemplate<K>}${string}`
}[keyof paths & string]

// 编译期漂移回归断言（tsconfig 排除 *.test.ts，故置于源文件；tsc --noEmit 守门）。
// 覆盖：两个已修漂移 bug 的路径、P2 新增 helper 出口、query 后缀变体、反代路径。
const regressionPaths: readonly ApiPath[] = [
  '/api/triage/t-1/dismiss',
  '/api/goals/control',
  '/api/goals/g-1/questions/q-1/respond',
  '/api/usage?window=7d',
  '/api/media/upload-and-create?type=image/png',
  '/a2a/artifacts/art-1',
  '/command?dir=x',
]
export const API_PATH_REGRESSION_CHECKS = regressionPaths
