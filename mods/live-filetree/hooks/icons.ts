// File-type icons as emoji: they draw in colour in the desktop app and in most terminals with no special
// font, and they are plain text, which is all a Client row can hold. Each is a single code point with
// emoji presentation by default, so no variation selector is needed.

const NAMES: Record<string, string> = {
  dockerfile: '🐳',
  makefile: '🔨',
  license: '📜',
  'readme.md': '📖',
  'package.json': '📦',
  'package-lock.json': '🔒',
  'pnpm-lock.yaml': '🔒',
  'yarn.lock': '🔒',
  'cargo.lock': '🔒',
  '.gitignore': '🌿',
  '.gitattributes': '🌿',
  '.gitmodules': '🌿',
  '.env': '🔑',
}

const EXTS: Record<string, string> = {
  js: '🟨', mjs: '🟨', cjs: '🟨',
  ts: '🔷', mts: '🔷', cts: '🔷',
  jsx: '🔹', tsx: '🔹',
  md: '📝', mdx: '📝', txt: '📄', rst: '📄',
  json: '🧾', jsonc: '🧾',
  yaml: '🔧', yml: '🔧', toml: '🔧', ini: '🔧', conf: '🔧', cfg: '🔧', env: '🔑',
  sh: '🐚', bash: '🐚', zsh: '🐚', fish: '🐚', ps1: '🐚',
  py: '🐍', ipynb: '📓',
  rs: '🦀', go: '🐹', rb: '💎', php: '🐘', swift: '🐦',
  java: '☕', kt: '☕', kts: '☕', scala: '☕',
  c: '🔵', h: '🔵', cpp: '🔵', cc: '🔵', hpp: '🔵', cs: '🟣',
  html: '🌐', htm: '🌐', css: '🎨', scss: '🎨', sass: '🎨', less: '🎨',
  vue: '💚', svelte: '🧡',
  png: '🌄', jpg: '🌄', jpeg: '🌄', gif: '🌄', webp: '🌄', ico: '🌄', svg: '🌄', bmp: '🌄',
  pdf: '📕', doc: '📘', docx: '📘', odt: '📘', ppt: '📙', pptx: '📙',
  csv: '📊', tsv: '📊', xls: '📊', xlsx: '📊',
  sql: '💾', db: '💾', sqlite: '💾',
  zip: '📦', tar: '📦', gz: '📦', tgz: '📦', '7z': '📦', rar: '📦',
  mp3: '🎵', wav: '🎵', flac: '🎵', mp4: '🎬', mov: '🎬', webm: '🎬',
  lock: '🔒', log: '🪵', xml: '📰',
}

export const FOLDER = '📁'
export const FOLDER_OPEN = '📂'

export function iconFor(name: string): string {
  const lower = name.toLowerCase()
  if (NAMES[lower]) return NAMES[lower]
  if (/\.(test|spec)\.[a-z]+$/.test(lower)) return '🧪'
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  return EXTS[ext] ?? '📄'
}
