import { context, Dealer } from 'zeromq'
async function main() {
  const a = new Dealer()
  const b = new Subscriber = undefined as any
  const sub = new (require('zeromq').Subscriber)()
  await a.bind('tcp://127.0.0.1:0')
  await sub.connect('tcp://127.0.0.1:' + (a.lastEndpoint?.split(':').pop() || 0))
  sub.subscribe()
  console.log('created')
  await a.close()
  await sub.close()
  console.log('closed')
  setTimeout(() => {
    const h = (process as any)._getActiveHandles()
    console.log('handles after close:', h.length, h.map((x: any) => x.constructor?.name).join(', '))
    process.exit(0)
  }, 1500)
}
main().catch(e => { console.log('ERR', e.message); process.exit(1) })
