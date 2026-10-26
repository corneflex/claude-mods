import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agents-panel',
  component: 'Pane',
  requestId: 'agents-panel',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a spawned agent shows as a running row with totals', async ($, on) => {
  on('command.register', () => ({ value: { command: 'agents-panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'Look around', description: 'Research competitor launches' })
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Research competitor launches/ }))?.text).toBe(
      'Research competitor launches',
    )
    expect(await ui.find({ type: 'Text', text: /Running · 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1\/1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Cost/ })).toBeDefined()
    await ui.unmount()
  }
})

const setup = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('command.register', () => ({ value: { command: 'agents-panel' } }))
  on('tool.register', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('clock.every', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ prompt: 'x', description: 'Search the repo for hooks', subagentType: 'Explore' })
  await $.agent.spawn({ prompt: 'y', description: 'Draft chapter 17', subagentType: 'book-writer' })
}

const avatarsOf = async (ui: { findAll: (q: { type: string }) => Promise<{ props: unknown }[]> }) =>
  (await ui.findAll({ type: 'Svg' }))
    .map(s => s.props as { alt?: string; source?: string; isInteractive?: boolean })
    .filter(p => String(p.alt).startsWith('agent avatar'))

test('each agent gets the character that suits its role, thinking until it uses a tool', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const avatars = await avatarsOf(ui)
  expect(avatars.map(p => p.alt)).toEqual(['agent avatar, detective, thinking', 'agent avatar, writer, thinking'])
  expect(avatars.every(p => p.isInteractive === true)).toBe(true)
  const source = String(avatars[0]?.source)
  expect(source.match(/additive="sum"/g)?.length).toBeGreaterThanOrEqual(2)
  expect(source).toContain('<ellipse')
  expect(source).not.toMatch(/type="rotate"[^>]*additive="sum"/)
  expect(source).toContain('fill="#FFD54F"')
  await ui.unmount()
})

test('a tool call shows what the agent is doing', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  await setup($, on)
  await $.tool.call({ tool: 'Read', file_path: '/x.md', agentId: 'a1' })
  await $.tool.call({ tool: 'WebSearch', query: 'claude code hooks', agentId: 'a2' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const avatars = await avatarsOf(ui)
  expect(avatars.map(p => p.alt)).toEqual(['agent avatar, detective, reading', 'agent avatar, writer, web'])
  expect(String(avatars[1]?.source)).toContain('www')
  await ui.unmount()
})

test('the character option dresses every sprite the same', { options: { character: 'police' } }, async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const avatars = await avatarsOf(ui)
  expect(avatars.filter(p => p.alt === 'agent avatar, police, thinking')).toHaveLength(2)
  await ui.unmount()
})

test('a commit by an agent pops the commit stamp on its sprite', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  await setup($, on)
  await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "wip"', agentId: 'a1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const alts = (await avatarsOf(ui)).map(p => p.alt)
  expect(alts).toContain('agent avatar, detective, running, committed')
  expect(alts).toContain('agent avatar, writer, thinking')
  await ui.unmount()
})

test('a busy character keeps its own tool and uses it on the work, over scrolling scenery', { options: { character: 'police' } }, async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  await setup($, on)
  await $.tool.call({ tool: 'Read', file_path: '/x.md', agentId: 'a1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const [reading, thinking] = await avatarsOf(ui)
  expect(reading?.alt).toBe('agent avatar, police, reading')
  const source = String(reading?.source)
  expect(source).toContain('#2A2D34')
  expect(source).toContain('BANG!')
  expect(source.match(/class="parallax"/g)).toHaveLength(1)
  expect(source).not.toMatch(/type="rotate"[^>]*additive="sum"/)
  expect(String(thinking?.source)).toContain('#2A2D34')
  await ui.unmount()
})
