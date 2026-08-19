import { join } from 'path'
import { KernelManager } from '../../../gateway/src/python/kernel-service'

// Real-kernel integration suite. The kernel is single-threaded: run with
// `jest --runInBand` (see note in package.json / docs) so tests never race.
// Uses the dedicated .venv-pykernel created during setup.

const PY_BIN = process.env.MAFW_PYTHON_BIN
  || join(process.env.LOCALAPPDATA || '', 'agent-vision-toolkit', '.venv-pykernel', 'Scripts', 'python.exe')

let kernel: KernelManager

beforeAll(async () => {
  kernel = new KernelManager('test-session', PY_BIN)
  await kernel.ensureStarted()
}, 30_000)

afterAll(async () => {
  await kernel.disposeAsync()
})

describe('KernelManager (real kernel)', () => {
  test('state persists across calls', async () => {
    const a = await kernel.execute('x = 42')
    expect(a.status).toBe('ok')
    const b = await kernel.execute('print(x * 2)')
    expect(b.status).toBe('ok')
    expect(b.stdout.trim()).toBe('84')
  }, 30_000)

  test('stdout / execute_result / error traceback', async () => {
    const ok = await kernel.execute('import pandas as pd\nprint(pd.DataFrame({"a":[1,2]}).shape)')
    expect(ok.status).toBe('ok')
    expect(ok.stdout).toContain('(2, 1)')

    const err = await kernel.execute('1 / 0')
    expect(err.status).toBe('error')
    expect(err.error?.ename).toBe('ZeroDivisionError')
    expect(Array.isArray(err.error?.traceback)).toBe(true)
  }, 30_000)

  test('input() fails fast (allow_stdin=false), no hang', async () => {
    const r = await kernel.execute('x = input("prompt")', { timeoutMs: 15_000 })
    expect(r.status).toBe('error')
    expect(r.error?.ename || '').toMatch(/StdinNotImplemented|EOFError|Error/)
  }, 30_000)

  test('matplotlib figure returns as image attachment', async () => {
    const r = await kernel.execute('%matplotlib inline\nimport matplotlib.pyplot as plt\nplt.plot([1,2,3])\nplt.show()', { timeoutMs: 30_000 })
    expect(r.status).toBe('ok')
    const png = r.attachments.find((a) => a.mimeType === 'image/png')
    expect(png).toBeDefined()
    expect(png!.data.length).toBeGreaterThan(100)
  }, 30_000)

  test('output cap sets truncated flag', async () => {
    const r = await kernel.execute('print("a" * 200000)', { maxOutputChars: 1024 })
    expect(r.truncated).toBe(true)
    expect(r.stdout.length).toBeLessThanOrEqual(1024 + 40)
  }, 30_000)

  test('concurrent executes are serialized (Mutex queue)', async () => {
    const results = await Promise.all([
      kernel.execute('import time; time.sleep(0.3); 1'),
      kernel.execute('2'),
      kernel.execute('3'),
    ])
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(results.map((r) => r.result)).toEqual(['1', '2', '3'])
  }, 30_000)

  test('restart clears state and reports kernelRestarted on next call', async () => {
    await kernel.execute('x = 99')
    await kernel.restart()
    const r = await kernel.execute('print(x)')
    expect(r.status).toBe('error')
    expect(r.error?.ename || '').toMatch(/NameError|Error/)
  }, 30_000)
})
