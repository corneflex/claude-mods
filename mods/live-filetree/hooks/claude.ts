// An animated pixel Claude for the status card, acting out what Claude is doing. One SVG per scene, all SMIL,
// drawn once per change of scene (the status card is the pane's one SVG). Claude itself only moves in straight
// lines: no rotating or flipping; props such as the hammer may turn.

export type Scene = 'thinking' | 'reading' | 'editing' | 'creating' | 'committed' | 'idle' | 'answered'

const ORANGE = '#DA7756'
const DARK = '#2A1A14'
const W = 44
const H = 28
const R = ' repeatCount="indefinite"'

const px = (x: number, y: number, fill: string, w = 1, h = 1, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w + 0.02}" height="${h + 0.02}" fill="${fill}"${extra}/>`
const move = (values: string, dur: number, extra = '') =>
  `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}s"${R}${extra} additive="sum"/>`
const fade = (values: string, dur: number, extra = '') => `<animate attributeName="opacity" values="${values}" dur="${dur}s"${R}${extra}/>`
const keys = (n: number) => Array.from({ length: n }, (_, i) => (i / (n - 1)).toFixed(3)).join(';')

type Pose = { body?: string; eyes?: string; eyeStyle?: 'open' | 'closed' | 'happy' | 'squint'; armL?: string; armR?: string; legs?: [string, string]; extra?: string }

// Claude is drawn 1.4 times its pixel size, so it stands 8.4 units tall on the ground line at y = 27.
const SIZE = 1.4
const TOP = 27 - 6 * SIZE

// The critter at (x, y): 10 wide, 6 tall. Each part is its own group so a scene can move it alone.
function claude(x: number, y: number, pose: Pose = {}) {
  const head = px(1, 0, ORANGE, 8) + px(1, 1, ORANGE, 8) + px(1, 2, ORANGE, 8) + px(1, 3, ORANGE, 8)
  const style = pose.eyeStyle ?? 'open'
  const eyes =
    style === 'closed' ? px(2, 1.5, DARK, 1, 0.35) + px(7, 1.5, DARK, 1, 0.35)
      : style === 'happy' ? px(2, 1, DARK, 0.5, 0.5) + px(2.5, 0.6, DARK, 0.5, 0.5) + px(3, 1, DARK, 0.5, 0.5) +
        px(7, 1, DARK, 0.5, 0.5) + px(7.5, 0.6, DARK, 0.5, 0.5) + px(8, 1, DARK, 0.5, 0.5)
        : style === 'squint' ? px(2, 1.3, DARK, 1, 0.5) + px(7, 1.3, DARK, 1, 0.5)
          : px(2, 1, DARK) + px(7, 1, DARK)
  const blink = style === 'open' ? `<animate attributeName="opacity" values="1;1;0;1" keyTimes="0;0.9;0.95;1" dur="3.1s"${R}/>` : ''
  const [legL, legR] = pose.legs ?? ['', '']
  return `<g transform="translate(${x} ${y}) scale(${SIZE})">${pose.body ?? ''}` +
    head +
    `<g>${eyes}${blink}${pose.eyes ?? ''}</g>` +
    `<g>${px(0, 2, ORANGE)}${pose.armL ?? ''}</g>` +
    `<g>${px(9, 2, ORANGE)}${pose.armR ?? ''}</g>` +
    `<g>${px(1, 4, ORANGE)}${px(1, 5, ORANGE)}${px(3, 4, ORANGE)}${px(3, 5, ORANGE)}${legL}</g>` +
    `<g>${px(6, 4, ORANGE)}${px(6, 5, ORANGE)}${px(8, 4, ORANGE)}${px(8, 5, ORANGE)}${legR}</g>` +
    (pose.extra ?? '') +
    `</g>`
}

const shadow = (x: number, extra = '') => `<ellipse cx="${x}" cy="27" rx="5" ry="0.7" fill="#000" opacity="0.35">${extra}</ellipse>`
const walkLegs = (dur: number): [string, string] => [move('0 0;0 -0.7;0 0', dur), move('0 -0.7;0 0;0 -0.7', dur)]

function thinking() {
  // Paces right and back, stops to look up and tap its chin; the bubble cycles ?, …, ! then a lightbulb.
  const pace = '0 0;9 0;9 0;9 0;0 0;0 0;0 0'
  const kt = ' keyTimes="0;0.2;0.35;0.5;0.7;0.85;1"'
  const body = move(pace, 6, kt)
  const eyes = move('0 0;0.5 0;0.5 -0.4;-0.5 -0.4;-0.5 0;0 -0.4;0 0', 6, kt)
  const chin = move('0 0;0 0;0 -1.4;0 -1;0 -1.4;0 0;0 0', 6, kt)
  const bubbleText = (t: string, from: number, to: number) =>
    `<text x="31" y="8.4" font-family="monospace" font-weight="bold" font-size="5" fill="#2A1A14" opacity="0">${t}` +
    `<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${from};${from + 0.01};${to};${to + 0.01};1" dur="6s"${R}/></text>`
  const bulb =
    `<g opacity="0"><animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.75;0.76;0.98;1" dur="6s"${R}/>` +
    `<circle cx="33" cy="5.5" r="3.6" fill="#FFE082" opacity="0.35">${fade('0.2;0.6;0.2', 0.4)}</circle>` +
    `<circle cx="33" cy="5.5" r="2" fill="#FFD54F"/>${px(32, 7.4, '#9E9E9E', 2, 1.2)}</g>`
  return shadow(11, move(pace, 6, kt)) +
    `<g>${claude(4, TOP, { body, eyes, armR: chin, legs: walkLegs(0.4) })}${move('0 0;0 -0.4;0 0', 0.4)}</g>` +
    // bubble trail and cloud
    `<circle cx="23" cy="17" r="0.8" fill="#EEE">${fade('0.3;1;0.3', 1.2)}</circle>` +
    `<circle cx="26" cy="13.5" r="1.2" fill="#EEE">${fade('0.3;1;0.3', 1.2, ' begin="0.3s"')}</circle>` +
    `<g>${move('0 0;0 -0.6;0 0', 1.5)}<rect x="28" y="2" width="12" height="9" rx="4" fill="#F4F4F4"/>` +
    bubbleText('?', 0, 0.3) + bubbleText('…', 0.3, 0.55) + bubbleText('!', 0.55, 0.75) + bulb + `</g>`
}

function reading() {
  // Glasses on, book open; eyes scan each line and drop to the next, pages flip, a slow nod along.
  const scan = move('-0.6 0;0.6 0;-0.6 0.4;0.6 0.4;-0.6 0.8;0.6 0.8;-0.6 0', 4.2, ` keyTimes="${keys(7)}"`)
  const glasses = `<rect x="1.4" y="0.4" width="2.2" height="2" fill="none" stroke="#333" stroke-width="0.35"/>` +
    `<rect x="6.4" y="0.4" width="2.2" height="2" fill="none" stroke="#333" stroke-width="0.35"/>${px(3.6, 1.2, '#333', 2.8, 0.3)}`
  const page = (x: number) => `<rect x="${x}" y="0" width="5" height="6" fill="#F4F4F4"/>` +
    [1.2, 2.4, 3.6, 4.8].map(y => px(x + 0.8, y, '#B0B0B0', 3.4, 0.4)).join('')
  const flip = `<rect x="22" y="18" width="5" height="6" fill="#FFFFFF" opacity="0">` +
    `<animate attributeName="width" values="5;0.4;5" keyTimes="0;0.5;1" dur="0.6s" begin="2s;flipEnd.end+3.6s" id="flipEnd" fill="freeze"/>` +
    `<animate attributeName="opacity" values="1;1;0" dur="0.6s" begin="2s;flipEnd.end+3.6s" fill="freeze"/></rect>`
  return shadow(12) +
    claude(5, TOP, { body: move('0 0;0 0.4;0 0', 1.4), eyes: scan, armL: move('0 0;1 -1;1 -1', 0.1, ' fill="freeze"'), armR: move('0 0;-1 -1;-1 -1', 0.1, ' fill="freeze"'), extra: glasses }) +
    `<g>${move('0 0;0 0.4;0 0', 1.4)}<g transform="translate(17 18)">${page(0)}</g><g transform="translate(22 18)">${page(0)}</g>` +
    `${px(21.8, 18, '#8A5A3C', 0.4, 6)}${flip}</g>` +
    `<text x="31" y="9" font-family="monospace" font-size="3.4" fill="#A87BF0" opacity="0">hmm…${fade('0;0;1;1;0', 4.2, ` keyTimes="0;0.5;0.55;0.85;1"`)}</text>`
}

function editing() {
  // Hunched at a keyboard, arms hammering; code types itself into a little editor; a sweat drop falls.
  const typingL = move('0 0;0 -1;0 0', 0.18)
  const typingR = move('0 -1;0 0;0 -1', 0.18)
  const lines = [['#569CD6', 6], ['#DCDCAA', 9], ['#CE9178', 5], ['#9CDCFE', 8], ['#6A9955', 7]] as const
  const code = lines.map(([c, w], i) =>
    `<rect x="27" y="${7 + i * 2}" height="0.9" width="0" fill="${c}">` +
    `<animate attributeName="width" values="0;0;${w};${w};${w}" keyTimes="0;${(i * 0.15).toFixed(2)};${(i * 0.15 + 0.14).toFixed(2)};0.92;1" dur="4s"${R}/></rect>`).join('')
  const cursor = `<rect x="27" y="7" width="0.6" height="0.9" fill="#FFFFFF">${fade('1;0;1', 0.6)}` +
    `${move('0 0;6 0;9 2;5 4;8 6;7 8;7 8', 4, ` keyTimes="0;0.14;0.29;0.44;0.59;0.74;1"`)}</rect>`
  const drop = `<path d="M8.4 0 q0.6 1 0 1.6 q-0.6 -0.6 0 -1.6z" fill="#7FD1FF" opacity="0">` +
    `${move('0 0;0 0;0 3;0 3', 3, ` keyTimes="0;0.6;0.9;1"`)}${fade('0;0;1;0', 3, ` keyTimes="0;0.6;0.62;1"`)}</path>`
  return shadow(10) +
    `<g>${claude(3, TOP - 0.4, { eyeStyle: 'squint', armL: typingL, armR: typingR, body: move('0 0;0 0.3;0 0', 0.36), extra: drop })}</g>` +
    `<rect x="2.5" y="25.6" width="15" height="1.4" rx="0.3" fill="#3C3C3C"/>` +
    [4, 6, 8, 10, 12, 14].map(x => `<rect x="${x}" y="25.9" width="1.2" height="0.6" fill="#777">${fade('1;0.3;1', 0.36, ` begin="${(x % 3) * 0.06}s"`)}</rect>`).join('') +
    `<rect x="25" y="2.5" width="17" height="16" rx="1" fill="#1E1E1E" stroke="#3C3C3C" stroke-width="0.3"/>` +
    `<rect x="25" y="2.5" width="17" height="2.4" rx="1" fill="#2D2D2D"/>` +
    `<circle cx="26.6" cy="3.7" r="0.5" fill="#FF5F57"/><circle cx="28.2" cy="3.7" r="0.5" fill="#FEBC2E"/><circle cx="29.8" cy="3.7" r="0.5" fill="#28C840"/>` +
    code + cursor
}

function creating() {
  // Hammer bonks, blocks drop onto a growing stack, sparks fly on each hit.
  const colours = ['#4CC38A', '#4F86E0', '#E8C547', '#F0883E']
  const blocks = colours.map((c, i) => {
    const t = (0.15 + i * 0.2).toFixed(2)
    return `<rect x="28" y="${23 - i * 3.2}" width="6" height="3" rx="0.4" fill="${c}" opacity="0">` +
      `${move(`0 -8;0 -8;0 0;0 0`, 4, ` keyTimes="0;${t};${(Number(t) + 0.05).toFixed(2)};1"`)}` +
      `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;${t};${(Number(t) + 0.01).toFixed(2)};0.95;1" dur="4s"${R}/></rect>`
  }).join('')
  const hammer = `<g>${'<animateTransform attributeName="transform" type="rotate" values="-60 17 22;10 17 22;-60 17 22" dur="0.8s" repeatCount="indefinite"/>'}` +
    `<rect x="16.6" y="15" width="0.8" height="7" fill="#8A5A3C"/><rect x="15" y="14" width="4" height="2" rx="0.3" fill="#9AA3AD"/></g>`
  const sparks = [[-1.5, -2], [1.5, -2.2], [0, -3]].map(([dx, dy]) =>
    `<rect x="22.5" y="24" width="0.8" height="0.8" fill="#FFE082" opacity="0">${move(`0 0;${dx} ${dy}`, 0.8, ' begin="0.3s"')}${fade('0;1;0', 0.8, ' begin="0.3s"')}</rect>`).join('')
  return shadow(9) + `<rect x="27" y="26" width="8" height="0.8" fill="#555"/>` + blocks +
    `<g>${claude(2, TOP, { body: move('0 0;0 0.5;0 0', 0.8), eyeStyle: 'open' })}</g>` + hammer + sparks
}

function committed() {
  // Leaps with both arms up, a green check stamp pops and confetti rains down.
  const jump = move('0 0;0 -5;0 0;0 0', 1.1, ' keyTimes="0;0.35;0.7;1"')
  const confetti = ['#E5534B', '#4F86E0', '#E8C547', '#4CC38A', '#A87BF0', '#F0883E', '#56D4DD'].map((c, i) =>
    `<rect x="${3 + i * 6}" y="-2" width="1" height="1" fill="${c}">${move(`0 0;${i % 2 ? 2 : -2} 30`, 1.6 + (i % 3) * 0.3, ` begin="${(i * 0.17).toFixed(2)}s"`)}</rect>`).join('')
  const stamp = `<g transform="translate(34 9)"><g>` +
    `<animateTransform attributeName="transform" type="scale" values="0;1.3;1;1;0" keyTimes="0;0.15;0.25;0.9;1" dur="2.2s"${R}/>` +
    `<circle r="5" fill="#2EA043"/><path d="M-2.4 0.2l1.6 1.7 3.4-3.6" fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/></g></g>`
  return shadow(13, `<animate attributeName="rx" values="5;2.5;5;5" keyTimes="0;0.35;0.7;1" dur="1.1s"${R}/>`) +
    claude(6, TOP, { body: jump, eyeStyle: 'happy', armL: move('0 -2;0 -1;0 -2', 0.3), armR: move('0 -2;0 -1;0 -2', 0.3, ' begin="0.15s"'), legs: [move('0 0;0 -0.6;0 0', 1.1), move('0 0;0 -0.6;0 0', 1.1)] }) +
    stamp + confetti
}

function idle() {
  // Dozing: eyes shut, slow breaths, a trail of Z's drifting up.
  const z = (i: number) =>
    `<text x="21" y="17" font-family="monospace" font-weight="bold" font-size="${3 + i}" fill="#9A9A9A" opacity="0">z` +
    `${move(`0 0;${6 + i * 2} ${-8 - i * 3}`, 3, ` begin="${i}s"`)}${fade('0;1;0', 3, ` begin="${i}s"`)}</text>`
  return shadow(13, `<animate attributeName="rx" values="5;5.6;5" dur="2.4s"${R}/>`) +
    claude(6, TOP, { eyeStyle: 'closed', body: move('0 0;0 0.6;0 0', 2.4) }) + z(0) + z(1) + z(2)
}

function answered() {
  // Waves hello with happy eyes, and a speech bubble says it's done.
  return shadow(13) +
    claude(5, TOP, { eyeStyle: 'happy', armR: move('0 0;0 -2.5;0 -1.5;0 -2.5;0 0', 1.2), body: move('0 0;0 -0.5;0 0', 0.6) }) +
    `<g>${move('0 0;0 -0.5;0 0', 1.6)}<rect x="22" y="6" width="17" height="8" rx="3" fill="#F4F4F4"/>` +
    `<path d="M24 14 l-2 3 l4 -3z" fill="#F4F4F4"/>` +
    `<text x="30.5" y="11.6" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="4" fill="#2EA043">Done!</text></g>`
}

const SCENES: Record<Scene, () => string> = { thinking, reading, editing, creating, committed, idle, answered }

export function claudeScene(scene: Scene) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 3}" height="${H * 3}" shape-rendering="crispEdges">${SCENES[scene]()}</svg>`
}
