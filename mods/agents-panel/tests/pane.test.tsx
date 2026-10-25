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
  await $.agent.spawn({ prompt: 'x', description: 'First agent' })
  await $.agent.spawn({ prompt: 'y', description: 'Second agent' })
}

test('each agent in a run is a different animated character', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const avatars = (await ui.findAll({ type: 'Svg' })).filter(s => String((s.props as { alt?: string }).alt).startsWith('agent avatar'))
  expect(avatars.map(s => (s.props as { alt?: string }).alt)).toEqual(['agent avatar, digger, thinking', 'agent avatar, cowboy, thinking'])
  expect(avatars.every(s => (s.props as { isInteractive?: boolean }).isInteractive === true)).toBe(true)
  const source = String((avatars[0]?.props as { source?: string }).source)
  expect(source.match(/additive="sum"/g)?.length).toBeGreaterThanOrEqual(2)
  expect(source).toContain('<ellipse')
  expect(source).toContain('fill="#F4F4F4"')
  await ui.unmount()
})

test('the character option dresses every sprite the same', { options: { character: 'police' } }, async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(s => (s.props as { alt?: string }).alt)
  expect(alts.filter(a => a === 'agent avatar, police, thinking')).toHaveLength(2)
  await ui.unmount()
})

test('a commit by an agent pops the commit stamp on its sprite', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  await setup($, on)
  await $.tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "wip"', agentId: 'a1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(s => (s.props as { alt?: string }).alt)
  expect(alts).toContain('agent avatar, digger, committed, thinking')
  expect(alts).toContain('agent avatar, cowboy, thinking')
  await ui.unmount()
})
