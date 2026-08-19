import { pythonGuideHook, _resetPythonGuideState } from '../../../src/hooks/bash-python-guide'

function userMsg(text: string): any {
  return { role: 'user', info: { role: 'user' }, parts: [{ type: 'text', text }] }
}

function toolMsg(text: string, name = 'bash'): any {
  return { role: 'assistant', info: { role: 'tool', name }, parts: [{ type: 'tool', name, text }] }
}

function hook(texts: string[], msgs?: any[], sessionID?: string) {
  const messages = msgs ?? texts.map((t) => userMsg(t))
  const output = { messages }
  pythonGuideHook({ sessionID: sessionID ?? 'ses-fixed' }, output)
  return output.messages
}

describe('pythonGuideHook', () => {
  beforeEach(() => _resetPythonGuideState())
  afterEach(() => _resetPythonGuideState())

  test('a long computational python -c script triggers the guide note', () => {
    const longScript = `python -c 'import numpy as np; data = [1,2,3,4,5]; print(sum(data)/len(data)); result = np.array(data) * 2; print(result.mean())'`
    const messages = hook([longScript])
    const note = messages.find((m: any) => JSON.stringify(m).includes('mafw_python'))
    expect(note).toBeDefined()
  })

  test('a short non-computational python -c does not trigger', () => {
    const messages = hook([`python -c 'print("hello")'`])
    expect(JSON.stringify(messages)).not.toContain('mafw_python')
  })

  test('a python heredoc with pandas triggers', () => {
    const script = `python <<'EOF'
import pandas as pd
import numpy as np
# a longer computational block so the heredoc length guard passes
df = pd.DataFrame({'a': [1, 2, 3, 4, 5], 'b': [10, 20, 30, 40, 50]})
df['c'] = df['a'] * df['b']
print(df.describe())
print(df['c'].mean())
print(df['c'].sum())
result = np.array(df['c']) / 2
print(result.mean())
EOF`
    const messages = hook([script])
    expect(JSON.stringify(messages)).toContain('mafw_python')
  })

  test('only once per session (dedup)', () => {
    const longScript = `python -c 'import numpy as np; x = [1,2,3]; print(np.mean(x))'`
    const messages1 = hook([longScript])
    expect(JSON.stringify(messages1)).toContain('mafw_python')
    const messages2 = hook([longScript])
    expect(JSON.stringify(messages2)).not.toContain('mafw_python')
  })

  test('bash tool result with a computational python block triggers', () => {
    const toolResult = `$ python -c 'import statistics; print(statistics.mean([10,20,30]))'\n20.0\n$`
    const messages = hook([], [toolMsg(toolResult, 'bash')])
    expect(JSON.stringify(messages)).toContain('mafw_python')
  })

  test('does not fire for plain shell commands', () => {
    const messages = hook([`git status && npm run build`])
    expect(JSON.stringify(messages)).not.toContain('mafw_python')
  })
})
