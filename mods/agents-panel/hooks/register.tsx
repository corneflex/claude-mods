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

const CHARACTERS = ['digger', 'cowboy', 'police', 'nurse', 'biker', 'worker', 'astronaut', 'detective', 'writer', 'teacher'] as const
type Character = (typeof CHARACTERS)[number]

type Sprites = { character: string; motion: boolean; body: string; animateFinished: boolean }

// Colours come from user settings and go into SVG markup: accept hex only.
function hexOr(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : fallback
}

function spritesFrom(options: Record<string, unknown>): Sprites {
  return {
    character: typeof options.character === 'string' ? options.character : 'auto',
    motion: options.motion !== false,
    body: hexOr(options.bodyColor, BODY),
    animateFinished: options.animateFinished === true,
  }
}

// Which character suits an agent, from words in its type and description. First match wins.
const ROLES: [RegExp, Character][] = [
  [/explor|research|search|scout|investigat|find|web/, 'detective'],
  [/plan|architect|coordinat|orchestrat|design|strateg/, 'astronaut'],
  [/review|check|audit|verif|security|lint|master|inspect/, 'police'],
  [/test|qa\b|quality|debug|diagnos/, 'nurse'],
  [/writ|doc|book|author|content|copy|blog|readme/, 'writer'],
  [/train|teach|tutor|guide|lab|quiz|learn/, 'teacher'],
  [/setup|config|deploy|devops|ops\b|infra|statusline|install|release/, 'cowboy'],
  [/fork|teammate|fast|speed|haiku/, 'biker'],
  [/build|refactor|migrat|fix|implement|construct/, 'worker'],
  [/dev|engineer|code|general|claude/, 'digger'],
]

function characterOf(agent: { type: string; description: string; avatar: number }, sprites: Sprites): Character {
  const fixed = CHARACTERS.find(c => c === sprites.character)
  if (fixed) return fixed
  if (sprites.character === 'mixed') return CHARACTERS[agent.avatar % CHARACTERS.length] ?? 'digger'
  const text = `${agent.type} ${agent.description}`.toLowerCase()
  const role = ROLES.find(([pattern]) => pattern.test(text))
  if (role) return role[1]
  // Unknown roles still get the same character every time.
  let hash = 0
  for (const ch of agent.type || agent.description) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return CHARACTERS[hash % CHARACTERS.length] ?? 'digger'
}

// What an agent is doing, from the tool it is running (or ran in the last few seconds).
type Activity = 'thinking' | 'reading' | 'writing' | 'running' | 'web' | 'delegating' | 'tooling'
const ACTIVITY_LINGER_MS = 4000

function activityOf(tool: string | undefined): Activity {
  if (!tool) return 'thinking'
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(tool)) return 'reading'
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return 'writing'
  if (/^(Bash|BashOutput|KillShell|KillBash|PowerShell|Monitor)$/.test(tool)) return 'running'
  if (/^(WebSearch|WebFetch)$/.test(tool)) return 'web'
  if (/^(Agent|Task|SendMessage)$/.test(tool)) return 'delegating'
  return 'tooling'
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
const word = (x: number, y: number, text: string, fill: string, size = 1.8) =>
  `<text x="${x}" y="${y}" font-family="monospace" font-weight="bold" font-size="${size}" fill="${fill}">${text}</text>`

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

// Canvas is 16×14; the critter's head starts at (3, 6). `props` is the character's signature gear.
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
        body: a(move('0 0;0 -0.8;0 0', 0.5) + move('-0.3 0;0.3 0;-0.3 0', 1, ' additive="sum"')),
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
        body: a(move('-0.4 0;0.4 0;-0.4 0', 1.6)),
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
        body: a(move('0 0;0 -0.3;0 0', 0.3)),
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
        body: a(move('0 0;0 -1.2;0 0', 2.4) + move('-0.4 0;0.4 0;-0.4 0', 3.2, ' additive="sum"')),
        arm: a(move('0 0;0 -1;0 0', 2.4)),
      }
    case 'detective':
      return {
        // checked deerstalker with its ear flaps
        hat: ['..DdDdDd..', '.dDdDdDdD.', 'D........D'],
        hatColours: { D: '#8A6A3C', d: '#6B4F2A' },
        vest: '#8A6A3C',
        props:
          // a pipe at the mouth puffing smoke rings
          `<rect x="1.6" y="8.2" width="1.6" height="0.5" fill="#5A3A1E"/><rect x="1.2" y="7.4" width="0.8" height="1.2" fill="#5A3A1E"/>` +
          a([0, 1].map(i =>
            `<circle cx="1.6" cy="6.8" r="0.45" fill="none" stroke="#BBB" stroke-width="0.25" opacity="0">` +
            `${move('0 0;-0.8 -4', 2, ` begin="${i}s"`)}${fade('0;0.9;0', 2, ` begin="${i}s"`)}</circle>`).join('')),
        // tiptoes from side to side
        body: a(move('-0.6 0;-0.6 -0.3;0.6 0;0.6 -0.3;-0.6 0', 1.6)),
        arm: '',
      }
    case 'writer':
      return {
        // a purple beret with its little stalk, and a red scarf
        hat: ['......S...', '...PPPP...', '..PPPPPPP.'],
        hatColours: { P: '#7E5BC8', S: '#7E5BC8' },
        vest: '#E5534B',
        props:
          // a quill tucked behind the ear, bobbing
          `<g>${a(move('0 0;0 -0.4;0 0', 1.2))}<path d="M13 6 q2 -3 3 -5 q-1 3 -2.4 5.4z" fill="#F4F4F4"/></g>`,
        body: a(move('0 0;0 -0.3;0 0', 1.2)),
        arm: '',
      }
    case 'teacher':
      return {
        // a mortarboard whose tassel swings
        hat: ['KKKKKKKKKK', '...KKKK...'],
        hatColours: { K: '#1E1E24' },
        props:
          `<g>${a(move('-0.4 0;0.4 0;-0.4 0', 1))}<rect x="12.4" y="4.4" width="0.3" height="2" fill="#E8C547"/><rect x="12.2" y="6.2" width="0.7" height="0.8" fill="#E8C547"/></g>` +
          // a pointer stick tapping
          `<g>${a(move('0 0;0.6 -0.6;0 0', 0.8))}<rect x="13" y="5" width="0.4" height="5" fill="#8A5A3C"/></g>`,
        body: '',
        arm: a(move('0 0;0 -1;0 0', 0.8)),
      }
  }
}

// The props and moves of what the agent is doing right now. They play over any character.
type Act = { props: string; body: string; arm: string; eyes: string }

function activityParts(act: Activity): Act {
  switch (act) {
    case 'thinking':
      // taps its chin while a thought bubble goes ?, …, then a lightbulb
      return {
        props:
          `<path d="M12.6 -3.4h5.2a1.4 1.4 0 0 1 1.4 1.4v2.2a1.4 1.4 0 0 1-1.4 1.4h-3l-1.4 1.2v-1.2h-0.8a1.4 1.4 0 0 1-1.4-1.4v-2.2a1.4 1.4 0 0 1 1.4-1.4z" fill="#F4F4F4"/>` +
          [['?', 0, 0.33], ['…', 0.33, 0.66]].map(([t, a, b]) =>
            `<g opacity="0"><animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;${a};${Number(b) - 0.01};${b};1" dur="3s"${rep}/>${word(14.4, -0.9, String(t), '#2A1A14', 2.2)}</g>`).join('') +
          `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.66;0.67;1" dur="3s"${rep}/>` +
          `<circle cx="15.2" cy="-1.6" r="1.2" fill="#FFD54F"/><rect x="14.7" y="-0.5" width="1" height="0.6" fill="#9E9E9E"/></g>`,
        body: '',
        arm: move('0 0;0 -1.4;0 -1;0 -1.4;0 0', 1.2),
        eyes: move('0 0;0.4 -0.3;0.4 -0.3;-0.4 -0.3;0 0', 3),
      }
    case 'reading':
      // a magnifying glass sweeps a page line by line; a "?!" pops when it finds something
      return {
        props:
          `<rect x="13.4" y="5.6" width="4.4" height="6" fill="#F4F4F4"/>` +
          [6.8, 8, 9.2, 10.4].map(y => px(14, y, '#B0B0B0', 3.2, 0.4)).join('') +
          `<g>${move('0 0;2.4 0;0 1.2;2.4 1.2;0 2.4;2.4 2.4;0 0', 3, ` keyTimes="0;0.16;0.33;0.5;0.66;0.83;1"`)}` +
          `<circle cx="14.4" cy="7" r="1.3" fill="#7FD1FF" fill-opacity="0.35" stroke="#9AA3AD" stroke-width="0.4"/>` +
          `<rect x="15.2" y="7.8" width="0.5" height="1.8" fill="#8A5A3C"/></g>` +
          `<g opacity="0"><animate attributeName="opacity" values="0;0;1;0" keyTimes="0;0.7;0.75;0.95" dur="3s"${rep}/>${word(15.4, 4.6, '?!', '#E5534B', 2)}</g>`,
        body: move('0 0;0 0.3;0 0', 1.5),
        arm: move('0 0;0 -0.8;0 0', 1.5),
        eyes: move('0.6 0;0.6 0.3;0.6 0', 1.5),
      }
    case 'writing':
      // a pencil scribbles lines onto a sheet; every so often a crumpled draft flies over its shoulder
      return {
        props:
          `<rect x="13.4" y="6.4" width="4.4" height="5.4" fill="#F4F4F4"/>` +
          [7.4, 8.6, 9.8, 11].map((y, i) =>
            `<rect x="14" y="${y}" height="0.4" width="0" fill="#555"><animate attributeName="width" values="0;0;3.2;3.2" keyTimes="0;${(i * 0.22).toFixed(2)};${(i * 0.22 + 0.2).toFixed(2)};1" dur="3.4s"${rep}/></rect>`).join('') +
          `<g>${move('0 0;3 0;0 1.2;3 1.2;0 2.4;3 2.4;0 3.6;3 3.6;0 0', 3.4, ` keyTimes="0;0.2;0.22;0.42;0.44;0.64;0.66;0.86;1"`)}` +
          `<path d="M14.2 7.4 l1.2 -2.6 l0.7 0.3 l-1.2 2.6z" fill="#E8C547"/><path d="M14.2 7.4 l0.2 -0.6 l0.5 0.2z" fill="#333"/></g>` +
          // the crumpled draft, tossed over the shoulder near the end of each page
          `<circle cx="13" cy="7" r="0.9" fill="#D8D8D8" opacity="0">` +
          `${move('0 0;0 0;-7 -8;-14 2', 3.4, ' keyTimes="0;0.6;0.8;1"')}${fade('0;0;1;0', 3.4, ' keyTimes="0;0.6;0.62;1"')}</circle>`,
        body: move('0 0;0 0.2;0 0', 0.4),
        arm: move('0 0;0 -0.5;0 0', 0.3),
        eyes: move('0.5 0.3;0.5 0.3', 1),
      }
    case 'running':
      // hammers the keyboard while a little terminal scrolls, then smokes a bit
      return {
        props:
          `<rect x="11.6" y="-3.2" width="7.6" height="6" rx="0.4" fill="#1E1E1E" stroke="#3C3C3C" stroke-width="0.25"/>` +
          `<rect x="11.6" y="-3.2" width="7.6" height="1" rx="0.4" fill="#2D2D2D"/>` +
          `<circle cx="12.2" cy="-2.7" r="0.22" fill="#FF5F57"/><circle cx="12.9" cy="-2.7" r="0.22" fill="#FEBC2E"/><circle cx="13.6" cy="-2.7" r="0.22" fill="#28C840"/>` +
          // the output scrolls inside the window
          `<clipPath id="term"><rect x="11.6" y="-2.2" width="7.6" height="5"/></clipPath><g clip-path="url(#term)">` +
          `<g>${move('0 0;0 -1.2;0 -2.4;0 -3.6', 2.4, ' calcMode="discrete"')}` +
          [0, 1, 2, 3, 4, 5].map(i => word(12.1, -0.6 + i * 1.2, ['$ npm test', '✓ 12 pass', '$ git add', '$ make', '✓ built', '$ ls'][i] ?? '', i % 3 === 1 ? '#57C27A' : '#D4D4D4', 0.95)).join('') +
          `</g></g>` +
          `<rect x="18" y="1.6" width="0.5" height="0.9" fill="#D4D4D4">${fade('1;0;1', 0.6)}</rect>` +
          [0, 1].map(i =>
            `<circle cx="${15 + i}" cy="-3.4" r="0.6" fill="#888" opacity="0"><animate attributeName="r" values="0.4;1.4" dur="1.5s" begin="${1.5 + i * 0.3}s"${rep}/>` +
            `${move('0 0;0.5 -2.5', 1.5, ` begin="${1.5 + i * 0.3}s"`)}${fade('0;0.8;0', 1.5, ` begin="${1.5 + i * 0.3}s"`)}</circle>`).join('') +
          `<rect x="3" y="12.2" width="10" height="0.9" rx="0.2" fill="#3C3C3C"/>`,
        body: move('0 0;0 0.25;0 0', 0.24),
        arm: move('0 0;0 -0.8;0 0', 0.18),
        eyes: move('0.4 -0.4;0.4 -0.4', 1),
      }
    case 'web':
      // surfs the web: rides a wave on a surfboard under a "www" banner
      return {
        props:
          `<g>${move('0 0;-4 0', 1, ' calcMode="linear"')}<path d="M-6 13.4 q2 -1.6 4 0 t4 0 t4 0 t4 0 t4 0 t4 0 t4 0 V15 H-6z" fill="#4F86E0" opacity="0.85"/></g>` +
          `<rect x="2" y="11.8" width="12" height="0.9" rx="0.45" fill="#E8C547"/>` +
          `<g>${move('0 0;0 -0.6;0 0', 1.2)}${word(13.6, 1, 'www', '#56D4DD', 2)}</g>` +
          [0, 1].map(i => `<circle cx="${1 + i * 2}" cy="12.4" r="0.4" fill="#BFE3FF" opacity="0">${move('0 0;-2 -1.6', 0.8, ` begin="${i * 0.4}s"`)}${fade('0;1;0', 0.8, ` begin="${i * 0.4}s"`)}</circle>`).join(''),
        body: move('0 -0.6;0.8 -1.2;0 -0.6;-0.8 -1;0 -0.6', 1.6),
        arm: move('0 -1.2;0 -1.6;0 -1.2', 0.8),
        eyes: move('0.4 0;0.4 0', 1),
      }
    case 'delegating':
      // throws paper airplanes at the team
      return {
        props: [0, 1].map(i =>
          `<g opacity="0">${move(`0 0;5 -6;9 -9`, 1.4, ` begin="${i * 0.7}s"`)}${fade('1;1;0', 1.4, ` begin="${i * 0.7}s"`)}` +
          `<path d="M12.6 7.6 l3 -1.2 l-1.4 2.2z M12.6 7.6 l1.6 0.4" fill="#F4F4F4" stroke="#BBB" stroke-width="0.15"/></g>`).join('') +
          `<g opacity="0"><animate attributeName="opacity" values="0;1;0" dur="1.4s"${rep}/>${word(13.8, 3.4, '→', '#9A9A9A', 1.8)}</g>`,
        body: move('0 0;0.4 0;0 0', 0.7),
        arm: move('0 0;0 -2;0 0', 0.7),
        eyes: move('0.4 -0.3;0.4 -0.3', 1),
      }
    case 'tooling':
      // fiddles with a turning gear
      return {
        props:
          `<g transform="translate(15.4 4)"><g>${spin('0;360', 1.6)}<circle r="1.4" fill="#9AA3AD"/>` +
          [0, 60, 120].map(d => `<rect x="-0.35" y="-2" width="0.7" height="4" fill="#9AA3AD" transform="rotate(${d})"/>`).join('') +
          `<circle r="0.5" fill="#1E1E1E"/></g></g>`,
        body: move('0 0;0 0.2;0 0', 0.6),
        arm: move('0 0;0 -1;0 0', 0.6),
        eyes: move('0.4 -0.3;0.4 -0.3', 1),
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

// Running gags for long-running agents: a sweat drop after a minute, a steaming coffee after three.
function gagsSvg(elapsedMs: number) {
  let out = ''
  if (elapsedMs > 60_000) {
    out += `<path d="M12.2 4.6 q0.6 1 0 1.6 q-0.6 -0.6 0 -1.6z" fill="#7FD1FF" opacity="0">` +
      `${move('0 0;0 0;0 3', 2.4, ` keyTimes="0;0.5;1"`)}${fade('0;0;1;0', 2.4, ` keyTimes="0;0.5;0.55;1"`)}</path>`
  }
  if (elapsedMs > 180_000) {
    out += `<rect x="-1.6" y="10.6" width="2.2" height="2.4" rx="0.3" fill="#F4F4F4"/><rect x="-1.4" y="10.9" width="1.8" height="0.6" fill="#6B4F2A"/>` +
      `<path d="M0.6 11.2 h0.6 v1.2 h-0.6" fill="none" stroke="#F4F4F4" stroke-width="0.3"/>` +
      [0, 1].map(i => `<path d="M${-1 + i} 10.2 q0.4 -0.6 0 -1.2 q-0.4 -0.6 0 -1.2" fill="none" stroke="#BBB" stroke-width="0.2" opacity="0">` +
        `${fade('0;0.8;0', 2, ` begin="${i}s"`)}${move('0 0;0 -1', 2, ` begin="${i}s"`)}</path>`).join('')
  }
  return out
}

// Tricks play in two one-second windows of a 6 s loop, while the character is thinking.
const TRICK_LOOP = 6
const TRICK_WINDOWS = [[1, 2], [4, 5]] as const
type Trick = 'jump' | 'doublejump' | 'dance' | 'shuffle' | 'squat' | 'stomp'
const TRICKS: Record<Character, [Trick, Trick]> = {
  digger: ['jump', 'dance'],
  cowboy: ['doublejump', 'shuffle'],
  police: ['dance', 'squat'],
  nurse: ['shuffle', 'jump'],
  biker: ['jump', 'stomp'],
  worker: ['stomp', 'jump'],
  astronaut: ['doublejump', 'squat'],
  detective: ['shuffle', 'squat'],
  writer: ['jump', 'dance'],
  teacher: ['stomp', 'doublejump'],
}

// One animateTransform that rests at `rest` outside its window and plays `values` inside it.
function inWindow(type: string, rest: string, values: string[], [from, to]: readonly [number, number]) {
  const a = from / TRICK_LOOP
  const b = to / TRICK_LOOP
  const steps = values.map((_, i) => (a + ((b - a) * (i + 1)) / (values.length + 1)).toFixed(3))
  const keyTimes = ['0', a.toFixed(3), ...steps, b.toFixed(3), '1'].join(';')
  const all = [rest, rest, ...values, rest, rest].join(';')
  return `<animateTransform attributeName="transform" type="${type}" values="${all}" keyTimes="${keyTimes}" dur="${TRICK_LOOP}s" repeatCount="indefinite" additive="sum"/>`
}

// Every trick moves the character in straight lines only: no rotating or flipping.
function trickSvg(trick: Trick, w: readonly [number, number]) {
  switch (trick) {
    case 'jump':
      return inWindow('translate', '0 0', ['0 -2.2', '0 -3.2', '0 -2.2', '0 0.3'], w)
    case 'doublejump':
      return inWindow('translate', '0 0', ['0 -2.4', '0 0.2', '0 -3', '0 0.3'], w)
    case 'dance':
      return inWindow('translate', '0 0', ['-1.2 0', '0 -0.8', '1.2 0', '0 -0.8', '-1.2 0', '0 0'], w)
    case 'shuffle':
      return inWindow('translate', '0 0', ['-1.5 0', '1.5 0', '-1.5 0', '1.5 0'], w)
    case 'squat':
      return inWindow('translate', '0 0', ['0 0.8', '0 0.8', '0 -1.2', '0 0'], w)
    case 'stomp':
      return inWindow('translate', '0 0', ['0 -0.7', '0 0', '0 -0.7', '0 0', '0 -0.7', '0 0'], w)
  }
}

type AvatarOpts = { moving: boolean; event?: 'commit' | 'push'; activity?: Activity; elapsedMs?: number }

function avatarSvg(index: number, c: Character, sprites: Sprites, opts: AvatarOpts) {
  const live = opts.moving && sprites.motion
  const part = characterParts(c, live)
  // While the agent works, its activity drives the moves; its own gear stays for thinking and idling.
  const act = live && opts.activity ? activityParts(opts.activity) : undefined
  const busy = live && opts.activity !== undefined && opts.activity !== 'thinking'
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
  // Blink and breathe on every character; offsets keep a run's agents out of step with each other.
  const blink = live
    ? `<animate attributeName="opacity" values="1;1;0;1;1;0;1" keyTimes="0;0.6;0.63;0.66;0.85;0.88;1" dur="${3.2 + (index % 3) * 0.5}s"${rep}/>`
    : ''
  const breathe = live ? move('0 0;0 0.35;0 0', 1.6, ` begin="${(index % 4) * 0.3}s"`) : ''
  const figure =
    `<g>${breathe}<g>${busy ? act?.body ?? '' : part.body}${body.B ?? ''}${body.V ?? ''}<g>${body.E ?? ''}${blink}${act?.eyes ?? ''}</g>${body.L ?? ''}` +
    `<g>${act ? act.arm : part.arm}${body.R ?? ''}</g>${body.F ?? ''}${body.G ?? ''}${Object.values(hat).join('')}</g></g>`
  const [first, second] = TRICKS[c]
  const tricks = live && !busy ? trickSvg(first, TRICK_WINDOWS[0]) + trickSvg(second, TRICK_WINDOWS[1]) : ''
  const airborne = (t: Trick) => t === 'jump' || t === 'doublejump'
  const shadowShrink = live && !busy
    ? TRICK_WINDOWS.map((w, i) => {
        const t = i === 0 ? first : second
        if (!airborne(t)) return ''
        const a = (w[0] / TRICK_LOOP).toFixed(3)
        const m = (((w[0] + w[1]) / 2) / TRICK_LOOP).toFixed(3)
        const b = (w[1] / TRICK_LOOP).toFixed(3)
        return `<animate attributeName="rx" values="3;3;1.6;3;3" keyTimes="0;${a};${m};${b};1" dur="${TRICK_LOOP}s"${rep}/>`
      }).join('')
    : ''
  const shadow = `<ellipse cx="8" cy="13.6" rx="3" ry="0.5" fill="#000" opacity="0.35">${shadowShrink}</ellipse>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -4 22 19" shape-rendering="crispEdges">${shadow}` +
    `<g>${tricks}${figure}${busy ? '' : part.props}</g>${act?.props ?? ''}${live ? gagsSvg(opts.elapsedMs ?? 0) : ''}` +
    `${opts.event ? eventSvg(opts.event) : ''}</svg>`
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
    const startedAt = await $.clock.now()
    const tool = String(e.tool)
    await update($, agents, rows =>
      rows.map(r => (r.id === agentId ? { ...r, toolsStarted: r.toolsStarted + 1, tool, toolAt: startedAt } : r)),
    )
    const result = await next(e)
    const command = String(e.tool) === 'Bash' ? String((e as unknown as { command?: unknown }).command ?? '') : ''
    const kind = /\bgit\b[^|;&]*\bpush\b/.test(command) ? 'push' : /\bgit\b[^|;&]*\bcommit\b/.test(command) ? 'commit' : undefined
    const ok = !('deny' in result && result.deny) && !('isError' in result && result.isError)
    const at = await $.clock.now()
    await update($, agents, rows =>
      rows.map(r =>
        r.id !== agentId ? r : { ...r, toolsDone: r.toolsDone + 1, toolAt: at, ...(kind && ok ? { event: { kind, at } } : {}) },
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
                const character = characterOf(a, sprites)
                // A tool in flight shows its activity; a finished one lingers a few seconds; otherwise it thinks.
                const recent = a.tool !== undefined && now - (a.toolAt ?? 0) < ACTIVITY_LINGER_MS
                const activity: Activity | undefined = a.status !== 'running' ? undefined
                  : a.toolsStarted > a.toolsDone || recent ? activityOf(a.tool) : 'thinking'
                const label = fresh === 'commit' ? ', committed' : fresh === 'push' ? ', pushed' : ''
                return (
                  <Svg
                    source={avatarSvg(a.avatar, character, sprites, { moving, event: fresh, activity, elapsedMs: now - a.startedAt })}
                    alt={`agent avatar, ${character}, ${activity ?? 'done'}${label}`}
                    width={52}
                    height={46}
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
