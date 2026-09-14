import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { defaultEditorCommand, editInExternalEditor, type SpawnFn } from '../src/external-editor.ts'

test('defaultEditorCommand resolves VISUAL > EDITOR > platform default', () => {
  assert.equal(defaultEditorCommand({}, 'win32'), 'notepad')
  assert.equal(defaultEditorCommand({}, 'linux'), 'nano')
  assert.equal(defaultEditorCommand({ EDITOR: 'vim' }, 'win32'), 'vim')
  assert.equal(defaultEditorCommand({ EDITOR: 'vim', VISUAL: 'code --wait' }, 'win32'), 'code --wait')
})

test('editInExternalEditor round-trips content edited by the fake editor', async () => {
  const spawnFn: SpawnFn = (editor, args) => {
    assert.equal(editor, 'fakeed')
    const filePath = args.at(-1)!
    writeFileSync(filePath, readFileSync(filePath, 'utf-8') + '\n+ appended')
    return { on(ev: string, cb: (code: any) => void) { if (ev === 'close') cb(0) } }
  }
  const r = await editInExternalEditor({ command: 'fakeed', content: 'original draft', spawnFn })
  assert.equal(r.status, 'complete')
  assert.equal(r.content, 'original draft\n+ appended')
})

test('editInExternalEditor reports failed on non-zero exit', async () => {
  const spawnFn: SpawnFn = () => ({ on(ev: string, cb: (code: any) => void) { if (ev === 'close') cb(1) } })
  const r = await editInExternalEditor({ command: 'ed', content: 'x', spawnFn })
  assert.equal(r.status, 'failed')
  assert.equal(r.content, undefined)
})

test('editInExternalEditor reports failed on spawn error', async () => {
  const spawnFn: SpawnFn = () => ({
    on(ev: string, cb: (code: any) => void) { if (ev === 'error') cb(new Error('ENOENT')) },
  })
  const r = await editInExternalEditor({ command: 'missing-ed', content: 'x', spawnFn })
  assert.equal(r.status, 'failed')
})
