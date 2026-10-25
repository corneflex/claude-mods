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

const CHARACTERS = ['digger', 'cowboy', 'police', 'nurse', 'biker', 'worker', 'astronaut'] as const
type Character = (typeof CHARACTERS)[number]

type Sprites = { character: string; motion: boolean; body: string; animateFinished: boolean }

// Colours come from user settings and go into SVG markup: accept hex only.
function hexOr(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback
}

function spritesFrom(options: Record<string, unknown>): Sprites {
  return {
    character: typeof options.character === 'string' ? options.character : 'mixed',
    motion: options.motion !== false,
    body: hexOr(options.bodyColor, BODY),
    animateFinished: options.animateFinished === true,
  }
}

function characterFor(index: number, sprites: Sprites): Character {
  return CHARACTERS.find(c => c === sprites.character) ?? CHARACTERS[index % CHARACTERS.length] ?? 'digger'
}

const rep = ' repeatCount="indefinite"'
const spin = (values: string, dur: number, extra = '') =>
  `<animateTransform attributeName="transform" type="rotate" values="${values}" dur="${dur}s"${rep}${extra}/>`
const move = (values: string, dur: number, extra = '') =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}s"${rep}${extra}/>`
const fade = (values: string, dur: number, extra = '') =>
  `<animate attributeName="opacity" values="${values}" dur="${dur}s"${rep}${extra}/>`
const px = (x: number, y: number, fill: string, w = 1, h = 1) =>
  `<rect x="${x}" y="${y}" width="${w + 0.02}" height="${h + 0.02}" fill="${fill}"/>`

// Pixel rows: each letter is drawn in its colour; the layer letters move on their own.
function pixels(rows: string[], x0: number, y0: number, colours: Record<string, string>) {
  const layers: Record<string, string> = {}
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const fill = colours[c]
      if (fill) layers[c] = (layers[c] ?? '') + px(x0 + x, y0 + y, fill)
    }),
  )
  return layers
}

type Part = { hat: string[]; hatColours: Record<string, string>; vest?: string; props: string; body: string; arm: string }

// Canvas is 16×14; the critter's head starts at (3, 6).
function characterParts(c: Character, moving: boolean): Part {
  const a = (s: string) => (moving ? s : '')
  switch (c) {
    case 'digger':
      return {
        hat: ['..YYYYYY..', '.YYYWYYYY.'],
        hatColours: { Y: '#E8C547', W: '#FFF6C8' },
        props:
          // lamp beam, then a pickaxe swinging from the right hand, then dirt kicked up
          `<polygon points="7.5,5.5 1,3 1,8" fill="#FFF6C8" opacity="0.35">${a(fade('0.15;0.45;0.15', 0.8))}</polygon>` +
          `<g>${a(spin('10 13 9;-55 13 9;15 13 9;10 13 9', 0.8, ' keyTimes="0;0.45;0.6;1"'))}` +
          `<rect x="12.6" y="3" width="0.8" height="6.5" fill="#8A5A3C"/><rect x="10.6" y="2.4" width="5" height="1.1" rx="0.5" fill="#9AA3AD"/></g>` +
          a([0, 1, 2].map(i =>
            `<rect x="14" y="12" width="0.7" height="0.7" fill="#7A4E2D" opacity="0">` +
            `${move(`0 0;${0.6 + i * 0.7} ${-2 - i}`, 0.8, ` begin="${0.45 + i * 0.05}s"`)}${fade('0;1;0', 0.8, ` begin="${0.45 + i * 0.05}s"`)}</rect>`).join('')),
        body: a(move('0 0;0 0.4;0 0', 0.8)),
        arm: '',
      }
    case 'cowboy':
      return {
        hat: ['...HHHH...', '..HHHHHH..', 'HHHHHHHHHH'],
        hatColours: { H: '#8A5A3C' },
        props:
          // lasso loop spinning over the head on a rope from the raised hand
          `<line x1="13" y1="8" x2="13.5" y2="2.5" stroke="#C9A36B" stroke-width="0.4"/>` +
          `<ellipse cx="13.5" cy="2" rx="2.4" ry="0.8" fill="none" stroke="#C9A36B" stroke-width="0.45">` +
          `${a('<animate attributeName="rx" values="2.4;0.4;2.4" dur="0.6s" repeatCount="indefinite"/>')}</ellipse>`,
        body: a(move('0 0;0 -0.8;0 0', 0.5) + spin('-3 8 10;3 8 10;-3 8 10', 1, ' additive="sum"')),
        arm: a(move('0 0;0 -1.5;0 0', 0.6)),
      }
    case 'police':
      return {
        hat: ['..NNNNNN..', '.NNNYNNNN.', 'KKKKKKKKKK'],
        hatColours: { N: '#2D3E7A', Y: '#E8C547', K: '#14182A' },
        vest: '#2D3E7A',
        props:
          // siren flashing red/blue with a glow, a badge on the chest
          `<circle cx="8" cy="2.6" r="2.2" fill="#E5534B" opacity="0.35">${a('<animate attributeName="fill" values="#E5534B;#4F86E0;#E5534B" dur="0.5s" repeatCount="indefinite"/>')}${a(fade('0.1;0.6;0.1', 0.25))}</circle>` +
          `<rect x="7" y="2" width="2" height="1.4" rx="0.3" fill="#E5534B">${a('<animate attributeName="fill" values="#E5534B;#4F86E0;#E5534B" dur="0.5s" repeatCount="indefinite" calcMode="discrete"/>')}</rect>` +
          px(9, 11, '#E8C547'),
        body: '',
        arm: a(move('0 0;0 -2;0 0;0 -2;0 0', 1)),
      }
    case 'nurse':
      return {
        hat: ['..WWRWWW..', '.WWRRRWWW.'],
        hatColours: { W: '#F4F4F4', R: '#E5534B' },
        props:
          // hearts rising and beating beside the nurse
          [0, 1].map(i =>
            `<g opacity="0">${a(move(`0 0;${-0.5 + i} -6`, 2, ` begin="${i}s"`))}${a(fade('0;1;0', 2, ` begin="${i}s"`))}` +
            `<path d="M1.5 12 l-1.2 -1.2 a0.7 0.7 0 0 1 1.2 -0.9 a0.7 0.7 0 0 1 1.2 0.9 z" fill="#F07178"/></g>`).join(''),
        body: a(spin('-4 8 10;4 8 10;-4 8 10', 1.6)),
        arm: '',
      }
    case 'biker':
      return {
        hat: ['.KKKKKKKK.', 'KKKKKKKKKK', '.CCCCCCCC.'],
        hatColours: { K: '#1E1E24', C: '#4FC3E8' },
        props:
          // wheels with spinning spokes, speed lines streaming behind
          [5, 12].map(cx =>
            `<g transform="translate(${cx} 12.6)"><circle r="1.4" fill="none" stroke="#2A2A2A" stroke-width="0.6"/>` +
            `<g>${a(spin('0;360', 0.4))}<path d="M-1.1 0H1.1M0 -1.1V1.1" stroke="#9AA3AD" stroke-width="0.25"/></g></g>`).join('') +
          `<rect x="5" y="11.8" width="7" height="0.5" fill="#C8453A"/>` +
          a([9.6, 11, 12.4].map((y, i) =>
            `<rect x="0" y="${y - 3}" width="2" height="0.3" fill="#9AA3AD">${move('2 0;-2 0', 0.5, ` begin="${i * 0.15}s"`)}${fade('0;1;0', 0.5, ` begin="${i * 0.15}s"`)}</rect>`).join('')),
        body: a(spin('-8 8 12;-5 8 12;-8 8 12', 0.4) + move('0 0;0 -0.3;0 0', 0.3, ' additive="sum"')),
        arm: '',
      }
    case 'worker':
      return {
        hat: ['..OOOOOO..', 'OOOOOOOOOO'],
        hatColours: { O: '#F08A24' },
        vest: '#E8E04A',
        props:
          // jackhammer at the right hand, shaking, with dust puffs at its tip
          `<g>${a(move('0 0;0.3 0.2;-0.2 -0.2;0.2 0.3;0 0', 0.15))}<rect x="13" y="7" width="1.6" height="1" fill="#555"/><rect x="13.5" y="8" width="0.7" height="4" fill="#9AA3AD"/></g>` +
          a([0, 1].map(i =>
            `<circle cx="13.8" cy="12.6" r="0.4" fill="#C9B79C" opacity="0"><animate attributeName="r" values="0.4;1.6" dur="0.7s" begin="${i * 0.35}s"${rep}/>${fade('0.8;0', 0.7, ` begin="${i * 0.35}s"`)}</circle>`).join('')),
        body: a(move('0 0;0.2 0;-0.2 0.1;0 0', 0.15)),
        arm: '',
      }
    case 'astronaut':
      return {
        hat: ['..AAAAAA..', '.AA....AA.'],
        hatColours: { A: '#DDE3EA' },
        vest: '#DDE3EA',
        props:
          // visor bubble, antenna light and twinkling stars
          `<circle cx="8" cy="7.6" r="3.6" fill="#7FD1FF" fill-opacity="0.18" stroke="#DDE3EA" stroke-width="0.4"/>` +
          `<rect x="7.8" y="2.6" width="0.4" height="2" fill="#DDE3EA"/><circle cx="8" cy="2.4" r="0.5" fill="#E5534B">${a(fade('1;0.2;1', 1))}</circle>` +
          [[1, 2], [14, 4], [2, 10], [15, 11]].map(([x, y], i) =>
            `<circle cx="${x}" cy="${y}" r="0.35" fill="#FFF6C8">${a(fade('0.2;1;0.2', 1.4, ` begin="${i * 0.35}s"`))}</circle>`).join(''),
        body: a(move('0 0;0 -1.2;0 0', 2.4) + spin('-6 8 9;6 8 9;-6 8 9', 3.2, ' additive="sum"')),
        arm: a(move('0 0;0 -1;0 0', 2.4)),
      }
  }
}

// A commit pops a green stamp with confetti; a push launches an arrow. Each plays a few times, then hides.
function eventSvg(kind: 'commit' | 'push') {
  const once = ' repeatCount="3" fill="freeze"'
  if (kind === 'commit') {
    const confetti = ['#E5534B', '#4F86E0', '#E8C547', '#5BB37F', '#A87BF0'].map((c, i) =>
      `<rect x="${2 + i * 2.8}" y="0" width="0.8" height="0.8" fill="${c}"><animateTransform attributeName="transform" type="translate" values="0 -1;${i % 2 ? 1 : -1} 13" dur="1.2s" begin="${i * 0.12}s"${once}/></rect>`).join('')
    return `<g>${confetti}<g transform="translate(3 2.6)"><g><animateTransform attributeName="transform" type="scale" values="0;1.3;1;1" keyTimes="0;0.2;0.3;1" dur="1.6s"${once}/>` +
      `<circle r="2.4" fill="#2EA043"/><path d="M-1.2 0.1l0.8 0.8 1.6-1.7" fill="none" stroke="#fff" stroke-width="0.6" stroke-linecap="round"/></g></g>` +
      `<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.9;1" dur="4.8s" fill="freeze"/></g>`
  }
  return `<g><g><animateTransform attributeName="transform" type="translate" values="0 6;0 -10" dur="1.2s"${once}/>` +
    `<rect x="1.4" y="5" width="1.2" height="3" fill="#3FC1C9" opacity="0.5"/><path d="M2 1.5l2 2.5h-1.3v2h-1.4v-2H0z" fill="#3FC1C9"/></g>` +
    `<animate attributeName="opacity" values="1;1;0" keyTimes="0;0.9;1" dur="3.6s" fill="freeze"/></g>`
}

function avatarSvg(index: number, sprites: Sprites, moving: boolean, event?: 'commit' | 'push') {
  const c = characterFor(index, sprites)
  const part = characterParts(c, moving && sprites.motion)
  const dark = '#2A1A14'
  const hatTop = 6 - part.hat.length
  const hat = pixels(part.hat, 3, hatTop, part.hatColours)
  const bodyRows = [
    '.BBBBBBBB.',
    '.BEBBBBEB.',
    'LBVVVVVVBR',
    '.BBBBBBBB.',
    '.F.F..G.G.',
  ]
  const body = pixels(bodyRows, 3, 6, { B: sprites.body, E: dark, L: sprites.body, R: sprites.body, V: part.vest ?? sprites.body, F: sprites.body, G: sprites.body })
  const figure =
    `<g>${part.body}${body.B ?? ''}${body.V ?? ''}${body.E ?? ''}${body.L ?? ''}<g>${part.arm}${body.R ?? ''}</g>${body.F ?? ''}${body.G ?? ''}` +
    `${Object.values(hat).join('')}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 14" shape-rendering="crispEdges">${figure}${part.props}${event ? eventSvg(event) : ''}</svg>`
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
    const command = String(e.tool) === 'Bash' ? String((e as unknown as { command?: unknown }).command ?? '') : ''
    const kind = /\bgit\b[^|;&]*\bpush\b/.test(command) ? 'push' : /\bgit\b[^|;&]*\bcommit\b/.test(command) ? 'commit' : undefined
    const ok = !('deny' in result && result.deny) && !('isError' in result && result.isError)
    const at = kind && ok ? await $.clock.now() : 0
    await update($, agents, rows =>
      rows.map(r =>
        r.id !== agentId ? r : { ...r, toolsDone: r.toolsDone + 1, ...(kind && ok ? { event: { kind, at } } : {}) },
      ),
    )
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
                const fresh = a.event && now - a.event.at < 8000 ? a.event.kind : undefined
                const character = characterFor(a.avatar, sprites)
                const label = fresh === 'commit' ? ', committed' : fresh === 'push' ? ', pushed' : ''
                return (
                  <Svg
                    source={avatarSvg(a.avatar, sprites, moving, fresh)}
                    alt={`agent avatar, ${character}${label}`}
                    width={44}
                    height={38}
                    isInteractive={(moving && sprites.motion) || fresh ? true : undefined}
                  />
                )
              })()
            ) : (
              <Text color={sprites.body}>▟▙</Text>
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
