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

test('each running agent gets its own sprite animation', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(s => (s.props as { alt?: string }).alt)
  expect(alts).toContain('agent avatar, bob animation')
  expect(alts).toContain('agent avatar, wave animation')
  await ui.unmount()
})

test('the animation option sets one style for every sprite', { options: { animation: 'hop' } }, async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const alts = (await ui.findAll({ type: 'Svg' })).map(s => (s.props as { alt?: string }).alt)
  expect(alts.filter(a => a === 'agent avatar, hop animation')).toHaveLength(2)
  expect(alts).not.toContain('agent avatar, bob animation')
  await ui.unmount()
})
