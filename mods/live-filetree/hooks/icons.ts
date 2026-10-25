// File-type icons. `nerd` draws Nerd Font Material Design glyphs (nf-md-*, code points U+F0001 and up)
// coloured in the Atom Material Icons palette; it needs a Nerd Font in the terminal. `emoji` needs no
// special font and is what the desktop app gets by default. Both are plain text, which a Client row holds.

export type IconStyle = 'nerd' | 'emoji'
export type Icon = { t: string; c?: string }

type Entry = [glyph: number, colour: string, emoji: string]

const JS: Entry = [0xf031e, '#FFCA28', '🟨']
const TS: Entry = [0xf06e6, '#0288D1', '🔷']
const REACT: Entry = [0xf0708, '#00BCD4', '🔹']
const MD: Entry = [0xf0354, '#42A5F5', '📝']
const JSON_: Entry = [0xf0626, '#FBC02D', '🧾']
const CONFIG: Entry = [0xf0493, '#78909C', '🔧']
const SHELL: Entry = [0xf018d, '#4CAF50', '🐚']
const IMAGE: Entry = [0xf021f, '#26A69A', '🌄']
const VIDEO: Entry = [0xf022b, '#FF7043', '🎬']
const AUDIO: Entry = [0xf0223, '#EF5350', '🎵']
const ARCHIVE: Entry = [0xf05c4, '#AFB42B', '📦']
const LOCK: Entry = [0xf033e, '#FFD54F', '🔒']
const DB: Entry = [0xf01bc, '#26A69A', '💾']
const TEXT: Entry = [0xf09aa, '#90A4AE', '📄']
const C_LANG: Entry = [0xf0671, '#5C6BC0', '🔵']
const CPP: Entry = [0xf0672, '#5C6BC0', '🔵']
const JAVA: Entry = [0xf0b37, '#EA2D2E', '☕']
const CSS: Entry = [0xf031c, '#42A5F5', '🎨']
const GIT: Entry = [0xf02a2, '#F4511E', '🌿']
const KEY: Entry = [0xf0306, '#FFCA28', '🔑']
const TEST: Entry = [0xf0668, '#8BC34A', '🧪']
const FILE: Entry = [0xf0214, '#90A4AE', '📄']

const NAMES: Record<string, Entry> = {
  dockerfile: [0xf0868, '#0288D1', '🐳'],
  makefile: [0xf1064, '#EF6C00', '🔨'],
  license: [0xf0124, '#FFB300', '📜'],
  'license.md': [0xf0124, '#FFB300', '📜'],
  'readme.md': [0xf0354, '#42A5F5', '📖'],
  'package.json': [0xf06f7, '#CB3837', '📦'],
  'package-lock.json': LOCK,
  'pnpm-lock.yaml': LOCK,
  'yarn.lock': LOCK,
  'cargo.lock': LOCK,
  '.gitignore': GIT,
  '.gitattributes': GIT,
  '.gitmodules': GIT,
  '.env': KEY,
}

const EXTS: Record<string, Entry> = {
  js: JS, mjs: JS, cjs: JS,
  ts: TS, mts: TS, cts: TS,
  jsx: REACT, tsx: REACT,
  md: MD, mdx: MD, markdown: MD,
  txt: TEXT, rst: TEXT, log: TEXT,
  json: JSON_, jsonc: JSON_,
  yaml: CONFIG, yml: CONFIG, toml: CONFIG, ini: CONFIG, conf: CONFIG, cfg: CONFIG,
  env: KEY,
  sh: SHELL, bash: SHELL, zsh: SHELL, fish: SHELL, ps1: SHELL,
  py: [0xf0320, '#4B8BBE', '🐍'], pyi: [0xf0320, '#4B8BBE', '🐍'],
  ipynb: [0xf082e, '#F57C00', '📓'],
  rs: [0xf1617, '#FF7043', '🦀'],
  go: [0xf07d3, '#00ADD8', '🐹'],
  rb: [0xf0d2d, '#E53935', '💎'],
  php: [0xf031f, '#8892BF', '🐘'],
  swift: [0xf06e5, '#F05138', '🐦'],
  java: JAVA, kt: [0xf1219, '#A97BFF', '☕'], kts: [0xf1219, '#A97BFF', '☕'],
  lua: [0xf08b1, '#42A5F5', '🌙'],
  c: C_LANG, h: C_LANG, cpp: CPP, cc: CPP, cxx: CPP, hpp: CPP,
  cs: [0xf031b, '#9575CD', '🟣'],
  html: [0xf031d, '#E44D26', '🌐'], htm: [0xf031d, '#E44D26', '🌐'],
  css: CSS, scss: [0xf07ec, '#EC407A', '🎨'], sass: [0xf07ec, '#EC407A', '🎨'], less: CSS,
  vue: [0xf0844, '#41B883', '💚'],
  svg: [0xf0721, '#FFB300', '🌄'],
  png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE, ico: IMAGE, bmp: IMAGE,
  pdf: [0xf0226, '#E53935', '📕'],
  doc: [0xf022c, '#2B579A', '📘'], docx: [0xf022c, '#2B579A', '📘'],
  xls: [0xf021b, '#217346', '📊'], xlsx: [0xf021b, '#217346', '📊'], csv: [0xf021b, '#217346', '📊'],
  ppt: [0xf0227, '#D24726', '📙'], pptx: [0xf0227, '#D24726', '📙'],
  sql: DB, db: DB, sqlite: DB,
  xml: [0xf05c0, '#FF7043', '📰'],
  zip: ARCHIVE, tar: ARCHIVE, gz: ARCHIVE, tgz: ARCHIVE, xz: ARCHIVE, '7z': ARCHIVE, rar: ARCHIVE,
  mp3: AUDIO, wav: AUDIO, flac: AUDIO,
  mp4: VIDEO, mov: VIDEO, mkv: VIDEO, webm: VIDEO,
  lock: LOCK,
}

function draw([glyph, colour, emoji]: Entry, style: IconStyle): Icon {
  return style === 'nerd' ? { t: String.fromCodePoint(glyph), c: colour } : { t: emoji }
}

export function iconFor(name: string, style: IconStyle): Icon {
  const lower = name.toLowerCase()
  const named = NAMES[lower]
  if (named) return draw(named, style)
  if (/\.(test|spec)\.[a-z]+$/.test(lower)) return draw(TEST, style)
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return draw(EXTS[ext] ?? FILE, style)
}

export function folderIcon(open: boolean, style: IconStyle): Icon {
  return style === 'nerd' ? { t: String.fromCodePoint(open ? 0xf0770 : 0xf024b), c: '#90A4AE' } : { t: open ? '📂' : '📁' }
}
