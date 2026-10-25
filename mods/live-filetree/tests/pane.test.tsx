import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'live-filetree',
  component: 'Pane',
  requestId: 'live-filetree',
  props: {
    title: 'Files: weather-app',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const ROOT = '/work/weather-app'

test('reads and edits show in the status card, touched list and tree', async ($, on) => {
  on('command.register', () => ({ value: { command: 'live-files' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.register', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1_790_000_000_000 }))
  on('clock.every', () => ({ value: { cancel: () => {} } }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: 'export const x = 1\n' }))
  on('fs.list', (_, e) => {
    const dir = String((e as { path?: string }).path ?? ROOT)
    const value = dir.endsWith('/src')
      ? [{ name: 'client.js', kind: 'file', size: 120, mtimeMs: 1_790_000_000_000, isLink: false }]
      : [
          { name: 'src', kind: 'dir', size: 0, mtimeMs: 1_790_000_000_000, isLink: false },
          { name: 'README.md', kind: 'file', size: 40, mtimeMs: 1_790_000_000_000, isLink: false },
        ]
    return { value }
  })
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv.join(' ')
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
    if (argv.includes('--show-toplevel')) return out(`${ROOT}\n`)
    if (argv.includes('--abbrev-ref')) return out('main\n')
    if (argv.includes('rev-list')) return out('0\n')
    if (argv.includes('status')) return out(' M src/client.js\n')
    if (argv.includes('--numstat')) return out('1\t1\tsrc/client.js\n')
    if (argv.includes('diff HEAD --') ) return out('diff --git a/src/client.js b/src/client.js\n--- a/src/client.js\n+++ b/src/client.js\n@@ -1 +1 @@\n-const a = 1\n+const b = 1\n')
    if (argv.includes('ls-files')) return out('README.md\nsrc/client.js\n')
    return out('')
  })
  on('tool.call', () => ({ result: 'ok' }))

  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/README.md` })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/client.js`, old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /CLAUDE TOUCHED/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^2 FILES$/ }))?.text).toBe('2 FILES')
    expect(await ui.find({ type: 'Text', text: /^main$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 changed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ALL FILES/ })).toBeDefined()
    await ui.press({ key: `touched:${ROOT}/src/client.js` })
    expect(await ui.find({ type: 'Text', text: /git diff · src\/client.js/ })).toBeDefined()
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    await ui.press({ key: `close:touched:${ROOT}/src/client.js` })
    await ui.unmount()
  }
})
