import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { AgentRow, RunRow } from '../types'

const PANE = 'agents-panel'
const agents = atom({ plugin: 'agents-panel', key: 'agents' } as const, [])
const runs = atom({ plugin: 'agents-panel', key: 'runs' } as const, [])
const collapsed = atom({ plugin: 'agents-panel', key: 'collapsed' } as const, [])
const clock = atom({ plugin: 'agents-panel', key: 'now' } as const, 0)

// Rough list prices in USD per million tokens; cache reads bill at 0.1x input, cache writes at 1.25x.
type Price = { match: RegExp; input: number; output: number }
const DEFAULT_PRICE: Price = { match: /opus/i, input: 5, output: 25 }
const PRICES: Price[] = [
  { match: /opus/i, input: 5, output: 25 },
  { match: /sonnet/i, input: 3, output: 15 },
  { match: /haiku/i, input: 1, output: 5 },
  { match: /fable/i, input: 5, output: 25 },
]
const CONTEXT_WINDOW = 200_000

const TAGS: Record<string, { word: string; color: string }> = {
  low: { word: 'light', color: '#5BB37F' },
  medium: { word: 'medium', color: '#4F86E0' },
  high: { word: 'careful', color: '#D9A13A' },
  xhigh: { word: 'heavy', color: '#D9704A' },
  max: { word: 'heavy', color: '#D9704A' },
}
const PLAIN_TAG = { word: 'default', color: '#9A9A9A' }

const HATS = ['#8A5A3C', '#B8B8C8', '#C8453A', '#E2B93B', '#7E5BC8', '#3FA7A0']
const BODY = '#E07F63'

// Module variables start over on a reload; everything drawn lives in $.state.
let mainTurn: { id: string; title: string } | undefined
let lastPrompt = ''
let ticking: { cancel: () => void } | undefined

function priceFor(model: string) {
  return PRICES.find(p => p.match.test(model)) ?? DEFAULT_PRICE
}

function costOf(usage: TurnUsage) {
  const p = priceFor(usage.model)
  return (
    (usage.input_tokens * p.input +
      usage.cache_creation_input_tokens * p.input * 1.25 +
      usage.cache_read_input_tokens * p.input * 0.1 +
      usage.output_tokens * p.output) /
    1_000_000
  )
}

function modelName(model: string) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  const name = m?.[1]
  if (!m || !name) return model || 'model'
  const family = name.charAt(0).toUpperCase() + name.slice(1)
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`
}

function titleOf(text: string, at: number) {
  const line = text.replace(/<[^>]+>/g, ' ').split('\n').map(s => s.trim()).find(Boolean)
  if (!line) {
    const d = new Date(at)
    return `Agents · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return line.length > 48 ? `${line.slice(0, 47)}…` : line
}

function blank(id: string, at: number): AgentRow {
  return {
    id,
    runId: '',
    description: 'Subagent',
    type: '',
    model: '',
    status: 'running',
    startedAt: at,
    steps: 0,
    toolsStarted: 0,
    toolsDone: 0,
    tokens: 0,
    contextTokens: 0,
    cost: 0,
    avatar: 0,
  }
}

function tokensShort(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function clockText(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${m}:${String(s % 60).padStart(2, '0')}`
}

function money(n: number) {
  return `≈$${n < 10 ? n.toFixed(2) : n.toFixed(1)}`
}

const ANIMATIONS = ['bob', 'wave', 'hop', 'blink', 'hat', 'wiggle', 'walk'] as const
type Animation = (typeof ANIMATIONS)[number]

type Sprites = { animation: string; body: string; hats: string[]; animateFinished: boolean }

// Colours come from user settings and go into SVG markup: accept hex only.
function hexOr(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback
}

function spritesFrom(options: Record<string, unknown>): Sprites {
  const hats = typeof options.hatColors === 'string'
    ? options.hatColors.split(',').map(c => hexOr(c, '')).filter(Boolean)
    : []
  return {
    animation: typeof options.animation === 'string' ? options.animation : 'mixed',
    body: hexOr(options.bodyColor, BODY),
    hats: hats.length ? hats : HATS,
    animateFinished: options.animateFinished === true,
  }
}

function animationFor(index: number, sprites: Sprites): Animation | undefined {
  if (sprites.animation === 'off') return undefined
  const fixed = ANIMATIONS.find(a => a === sprites.animation)
  return fixed ?? ANIMATIONS[index % ANIMATIONS.length]
}

const loop = (attr: string, values: string, dur: number, extra = '') =>
  `<animateTransform attributeName="transform" type="${attr}" values="${values}" dur="${dur}s" repeatCount="indefinite"${extra}/>`

function avatarSvg(index: number, sprites: Sprites, animation?: Animation) {
  const hat = sprites.hats[index % sprites.hats.length] ?? sprites.body
  const caps = [
    ['..HHHHHH..', '.HHHHHHHH.'],
    ['...HHHH...', '.HHHHHHHH.'],
    ['..HHHHHH..', 'HHHHHHHH..'],
  ][Math.floor(index / sprites.hats.length) % 3] ?? []
  const rows = [
    ...caps,
    '.BBBBBBBB.',
    '.BEBBBBEB.',
    'LBBBBBBBBR',
    '.BBBBBBBB.',
    '.F.F..G.G.',
    '.F.F..G.G.',
  ]
  // Each letter is a layer the animations move on its own: H hat, E eyes, L/R arms, F/G legs.
  const colour: Record<string, string> = { H: hat, E: '#2A1A14' }
  const layers: Record<string, string> = {}
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '.') return
      layers[c] = (layers[c] ?? '') + `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${colour[c] ?? sprites.body}"/>`
    }),
  )
  const anim: Partial<Record<string, string>> = {}
  if (animation === 'bob') anim.all = loop('translate', '0 0;0 -0.7;0 0', 0.8)
  if (animation === 'hop') anim.all = loop('translate', '0 0;0 -1.9;0 0;0 0', 1, ' keyTimes="0;0.3;0.6;1"')
  if (animation === 'wiggle') anim.all = loop('rotate', '-9 5 4;9 5 4;-9 5 4', 0.7)
  if (animation === 'wave') anim.R = loop('translate', '0 0;0 -2;0 -1;0 -2;0 0', 0.9)
  if (animation === 'hat') anim.H = loop('rotate', '-14 5 2;14 5 2;-14 5 2', 0.9)
  if (animation === 'walk') {
    anim.F = loop('translate', '0 0;0 -0.8;0 0', 0.5)
    anim.G = loop('translate', '0 0;0 -0.8;0 0', 0.5, ' begin="0.25s"')
    anim.all = loop('translate', '0 0;0 -0.3;0 0', 0.25)
  }
  const blink = animation === 'blink'
    ? '<animate attributeName="opacity" values="1;1;0;1" keyTimes="0;0.88;0.94;1" dur="2.4s" repeatCount="indefinite"/>'
    : ''
  const layer = (key: string, extra = '') => `<g>${layers[key] ?? ''}${anim[key] ?? ''}${extra}</g>`
  const body = layer('B') + layer('H') + layer('E', blink) + layer('L') + layer('R') + layer('F') + layer('G')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -2 12 10" shape-rendering="crispEdges"><g>${body}${anim.all ?? ''}</g></svg>`
}

function barSvg(fraction: number, color: string) {
  const w = Math.max(0, Math.min(1, fraction)) * 1000
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 6" preserveAspectRatio="none" width="1000" height="6"><rect width="1000" height="6" rx="3" fill="#2E2E2E"/><rect width="${w}" height="6" rx="3" fill="${color}"/></svg>`
}

const DIVIDER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1" preserveAspectRatio="none" width="1000" height="1"><rect width="1000" height="1" fill="#3A3A3A"/></svg>'

function startTicking($: EngineInterface) {
  if (ticking) return
  ticking = $.clock.every(1000, () => {
    void (async () => {
      const rows = await read($, agents)
      if (rows.some(r => r.status === 'running')) {
        const now = await $.clock.now()
        await update($, clock, () => now)
      } else {
        ticking?.cancel()
        ticking = undefined
      }
    })()
  })
}

export const register: Register = (on, options) => {
  const sprites = spritesFrom(options as Record<string, unknown>)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agents-panel',
      description: 'Show the Agents pane (add "clear" to forget past runs)',
    })
    await $.tool.register({
      name: 'state',
      description: 'Returns what the Agents pane shows: each tracked subagent and run, as JSON. Read-only.',
      inputSchema: { type: 'object', properties: {} },
    })
    startTicking($)
    return next(e)
  })

  on('command.run', { command: 'agents-panel' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, agents, () => [])
      await update($, runs, () => [])
      return { text: 'Agents pane cleared.' }
    }
    await $.ui.open({ id: PANE, title: 'Agents' })
    return { text: 'Agents pane opened.' }
  })

  on('tool.call', { tool: 'mcp__agents-panel__state' }, async $ => {
    const state = { runs: await read($, runs), agents: await read($, agents) }
    const text = JSON.stringify(state, null, 2)
    return { result: text, text }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta && !e.command && e.text.trim()) lastPrompt = e.text
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) mainTurn = { id: e.turnId, title: titleOf(lastPrompt, await $.clock.now()) }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || result.agentId === undefined) return result
    const id = result.agentId
    const at = await $.clock.now()
    const list = await read($, agents)
    const parent = e.parentAgentId ? list.find(a => a.id === e.parentAgentId) : undefined
    let runId = parent?.runId ?? mainTurn?.id ?? `run-${at}`
    let isNewRun = false
    await update($, runs, rs => {
      // With no turn known (a reload forgets it), agents started close together share the latest run.
      const latest = rs[rs.length - 1]
      if (!parent && !mainTurn && latest && at - latest.startedAt < 30_000) runId = latest.id
      isNewRun = !rs.some(r => r.id === runId)
      if (!isNewRun) return rs
      const run: RunRow = { id: runId, title: mainTurn?.id === runId ? mainTurn.title : titleOf('', at), startedAt: at }
      return [...rs, run].slice(-8)
    })
    await update($, agents, rows => {
      const index = rows.filter(r => r.runId === runId).length
      const existing = rows.find(r => r.id === id)
      const row: AgentRow = {
        ...(existing ?? blank(id, at)),
        runId,
        description: e.description || existing?.description || 'Subagent',
        type: e.subagentType,
        model: existing?.model || result.model,
        avatar: index,
      }
      return existing ? rows.map(r => (r.id === id ? row : r)) : [...rows, row].slice(-60)
    })
    startTicking($)
    if (isNewRun) void $.ui.open({ id: PANE, title: 'Agents' })
    return result
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    const agentId = e.agentId
    if (agentId === undefined) return response
    const at = await $.clock.now()
    const usage = response.usage
    await update($, agents, rows => {
      const existing = rows.find(r => r.id === agentId)
      const row = existing ?? blank(agentId, at)
      const context = usage
        ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
        : row.contextTokens
      const updated: AgentRow = {
        ...row,
        steps: row.steps + 1,
        model: usage?.model ?? e.model ?? row.model,
        effort: e.effort === undefined ? row.effort : String(e.effort),
        contextTokens: context,
        // The latest request's whole context, which is what the Agent tool reports as subagent_tokens.
        tokens: context,
        cost: row.cost + (usage ? costOf(usage) : 0),
      }
      return existing ? rows.map(r => (r.id === agentId ? updated : r)) : [...rows, updated]
    })
    return response
  })

  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) return next(e)
    await update($, agents, rows => rows.map(r => (r.id === agentId ? { ...r, toolsStarted: r.toolsStarted + 1 } : r)))
    const result = await next(e)
    await update($, agents, rows => rows.map(r => (r.id === agentId ? { ...r, toolsDone: r.toolsDone + 1 } : r)))
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const at = await $.clock.now()
      const status = e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, rows =>
        rows.map(r => (r.id === agentId ? { ...r, status, endedAt: at } : r)),
      )
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const isTerminal = e.surface === 'terminal'
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const rows = await read($, agents)
    const runList = (await read($, runs)).filter((r, i, all) => all.findIndex(o => o.id === r.id) === i)
    const folded = await read($, collapsed)
    const tick = await read($, clock)
    const now = Math.max(tick, ...rows.map(r => r.endedAt ?? r.startedAt))
    const width = e.props.bodyColumns

    const toggle = (key: string) =>
      update($, collapsed, keys => (keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]))

    if (runList.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>No subagents yet. Rows appear here when the Agent tool starts one.</Text>
        </Box>
      )
    }

    const tile = (label: string, value: string) => (
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor="#3A3A3A"
        backgroundColor={isTerminal ? undefined : '#262626'}
        paddingX={1}
      >
        <Text dimColor size="footnote">{label}</Text>
        <Text bold weight="bold" size="title">{value}</Text>
      </Box>
    )

    const bar = (fraction: number, color: string) =>
      Svg ? (
        <Svg source={barSvg(fraction, color)} alt={`${Math.round(fraction * 100)}% done`} height={5} />
      ) : (
        <Text color={color}>
          {'━'.repeat(Math.round(Math.max(0, Math.min(1, fraction)) * Math.max(4, width - 6)))}
        </Text>
      )

    const agentRow = (a: AgentRow, isLast: boolean) => {
      const tag = TAGS[a.effort ?? ''] ?? PLAIN_TAG
      const elapsed = (a.endedAt ?? now) - a.startedAt
      const ctx = Math.round((a.contextTokens / CONTEXT_WINDOW) * 100)
      const fraction =
        a.status === 'running' ? Math.min(0.92, 1 - Math.exp(-elapsed / 45_000)) : a.status === 'done' ? 1 : 0.5
      const progress = a.status === 'running' ? `${a.toolsDone}/${Math.max(a.toolsStarted, a.toolsDone)}` : `${a.toolsDone}/${a.toolsDone}`
      const color = a.status === 'failed' ? '#D9534F' : tag.color
      return (
        <Box flexDirection="column" key={a.id}>
          <Box flexDirection="row" gap={1} paddingY={isTerminal ? 0 : 'sm'}>
            {Svg ? (
              (() => {
                const moving = a.status === 'running' || sprites.animateFinished
                const animation = moving ? animationFor(a.avatar, sprites) : undefined
                return (
                  <Svg
                    source={avatarSvg(a.avatar, sprites, animation)}
                    alt={animation ? `agent avatar, ${animation} animation` : 'agent avatar'}
                    width={34}
                    height={28}
                    isInteractive={animation ? true : undefined}
                  />
                )
              })()
            ) : (
              <Text color={sprites.hats[a.avatar % sprites.hats.length]}>▟▙</Text>
            )}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold weight="bold" wrap="truncate-end">{a.description}</Text>
                {a.status === 'done' && <Text color="#5BB37F" bold>✓</Text>}
                {a.status === 'failed' && <Text color="#D9534F" bold>✗</Text>}
              </Box>
              <Text>
                <Text color={tag.color}>{tag.word}</Text>
                <Text dimColor>{` ${modelName(a.model)}${a.effort ? ` · ${a.effort}` : ''}${a.type ? ` · ${a.type}` : ''}`}</Text>
              </Text>
              <Box flexDirection="row" justifyContent="space-between">
                <Text tabular>{progress}</Text>
                <Text dimColor tabular>
                  {`ctx ${ctx}% · ${tokensShort(a.tokens)} ${money(a.cost)} ${clockText(elapsed)}`}
                </Text>
              </Box>
              {bar(fraction, color)}
            </Box>
          </Box>
          {!isLast &&
            (Svg ? <Svg source={DIVIDER} alt="" height={1} /> : <Text dimColor>{'─'.repeat(Math.max(4, width - 2))}</Text>)}
        </Box>
      )
    }

    const group = (run: RunRow, label: string, list: AgentRow[]) => {
      if (list.length === 0) return null
      const key = `${run.id}:${label}`
      const isOpen = !folded.includes(key) && !folded.includes(`${run.id}:*`)
      return (
        <Box flexDirection="column" key={key}>
          <Button key={`g-${key}`} plain onPress={() => void toggle(key)}>
            <Text dimColor>{`${isOpen ? '▾' : '▸'} ${label} · ${list.length}`}</Text>
          </Button>
          {isOpen && list.map((a, i) => agentRow(a, i === list.length - 1))}
        </Box>
      )
    }

    const runView = (run: RunRow) => {
      const list = rows.filter(r => r.runId === run.id)
      if (list.length === 0) return null
      const cost = list.reduce((s, a) => s + a.cost, 0)
      const tokens = list.reduce((s, a) => s + a.tokens, 0)
      const start = Math.min(...list.map(a => a.startedAt))
      const end = Math.max(...list.map(a => a.endedAt ?? now))
      const isFolded = folded.includes(`${run.id}:*`)
      return (
        <Box flexDirection="column" key={run.id} gap={isTerminal ? 0 : 'sm'} marginBottom={1}>
          <Text bold weight="bold" size="heading">{run.title}</Text>
          <Box flexDirection="row" gap={1}>
            {tile('Cost', money(cost))}
            {tile('Tokens', tokensShort(tokens))}
            {tile('Time', clockText(end - start))}
          </Box>
          <Button key={`c-${run.id}`} plain onPress={() => void toggle(`${run.id}:*`)}>
            <Text dimColor>{isFolded ? 'Expand' : 'Collapse'}</Text>
          </Button>
          {group(run, 'Running', list.filter(a => a.status === 'running'))}
          {group(run, 'Finished', list.filter(a => a.status !== 'running'))}
        </Box>
      )
    }

    return <Box flexDirection="column" paddingX={1}>{[...runList].reverse().map(runView)}</Box>
  })
}
