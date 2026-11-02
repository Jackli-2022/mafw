/**
 * 编译期探针：导出的 `MafwClient` 必须保留 `session` 的重载与 flat 返回类型。
 *
 * 由 `npm run typecheck`（`tsconfig.probes.json`）与包构建之外的独立 tsc 检查；
 * 主 `tsconfig.json` 排除 `*.probe.ts`，所以它不会进入 dist，也不会被
 * `node --test "src/*.test.ts"` 执行。
 *
 * `@ts-expect-error` 是反向断言：若某个返回类型塌缩成 `any`，被禁止的赋值会
 * 悄悄通过，expect-error 变成“未使用”并让 typecheck 失败。任何一条不成立都会
 * 阻止 `session` 退回对象字面量推断出的 `Promise<any>` 实现签名。
 */
import type { MafwClient } from './client'
import type { SessionMessageWire } from './types'
import type { MafwMessage } from './view-dto'

type IsAny<T> = 0 extends 1 & T ? true : false
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Expect<T extends true> = T

type HistoryReturn = Awaited<ReturnType<MafwClient['session']['history']>>
export type HistoryReturnIsNotAny = Expect<IsAny<HistoryReturn> extends false ? true : false>
export type HistoryDataIsNotAny = Expect<IsAny<HistoryReturn['data']> extends false ? true : false>
export type HistoryDataIsFlatDto = Expect<Equal<HistoryReturn['data'], MafwMessage[]>>

/** flat 与 wire 形状互斥（若返回是 any/wire，Extract 不会得到 never）。 */
export type FlatMessageIsNotWirePart = Expect<
  Equal<Extract<HistoryReturn['data'][number], SessionMessageWire>, never>
>

declare const client: MafwClient

/** 表达式级探针（永不调用；只为 tsc 提供真实的调用点推断）。 */
export async function probeSessionHistoryTypes(): Promise<void> {
  const history = await client.session.history({ sessionID: 'ses_1' })
  const flat: MafwMessage[] = history.data
  // @ts-expect-error flat 历史不能当成 wire 消息使用
  const wrongHistory: SessionMessageWire[] = history.data
  // @ts-expect-error flat 消息有 content，没有 wire info/parts
  void history.data[0]?.info

  const flatMessages = await client.session.messages({
    path: { id: 'ses_1' },
    query: { format: 'flat' },
  })
  const flatTyped: MafwMessage[] = flatMessages.data
  // @ts-expect-error format=flat 响应不是 wire
  const wrongFlatMessages: SessionMessageWire[] = flatMessages.data

  const wireMessages = await client.session.messages({ path: { id: 'ses_1' } })
  // 正向：默认 wire 出口必须能读 info.id 与 parts（旧类型把它说成 part[] 是谎报）
  const wireTyped: SessionMessageWire[] = wireMessages.data
  const wireID: string = wireMessages.data[0].info.id
  const wireParts: SessionMessageWire['parts'] = wireMessages.data[0].parts
  // @ts-expect-error wire 消息是信封，part 字段只在 info/parts 内
  void wireMessages.data[0].type
  // @ts-expect-error wire 消息没有 flat content
  void wireMessages.data[0].content
  // @ts-expect-error 默认 wire 响应不是 flat DTO
  const wrongWireMessages: MafwMessage[] = wireMessages.data

  void flat
  void wrongHistory
  void flatTyped
  void wrongFlatMessages
  void wireTyped
  void wireID
  void wireParts
  void wrongWireMessages
}
