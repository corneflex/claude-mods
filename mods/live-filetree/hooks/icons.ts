// File-type labels as coloured text (no background), padded to one width so names line up.

export type Icon = { t: string; c?: string }

const LABELS: Record<string, [string, string]> = {
  js: ['JS', '#E8C46A'], mjs: ['JS', '#E8C46A'], cjs: ['JS', '#E8C46A'],
  ts: ['TS', '#6CB6FF'], mts: ['TS', '#6CB6FF'], cts: ['TS', '#6CB6FF'],
  jsx: ['JSX', '#56D4DD'], tsx: ['TSX', '#56D4DD'],
  json: ['{}', '#E8C46A'], jsonc: ['{}', '#E8C46A'],
  md: ['MD', '#6CB6FF'], mdx: ['MDX', '#6CB6FF'],
  txt: ['TXT', '#9A9A9A'], log: ['LOG', '#9A9A9A'],
  yaml: ['YML', '#F07178'], yml: ['YML', '#F07178'], toml: ['TML', '#F07178'], ini: ['INI', '#9A9A9A'],
  sh: ['SH', '#A8D86E'], bash: ['SH', '#A8D86E'], zsh: ['SH', '#A8D86E'],
  py: ['PY', '#6CB6FF'], rs: ['RS', '#F0883E'], go: ['GO', '#56D4DD'], rb: ['RB', '#F07178'],
  java: ['JV', '#F0883E'], kt: ['KT', '#A87BF0'], swift: ['SW', '#F0883E'], php: ['PHP', '#A87BF0'],
  c: ['C', '#6CB6FF'], h: ['H', '#6CB6FF'], cpp: ['C++', '#6CB6FF'], cs: ['C#', '#A87BF0'],
  html: ['<>', '#F0883E'], css: ['CSS', '#6CB6FF'], scss: ['SCS', '#F07178'], vue: ['VUE', '#A8D86E'],
  svg: ['SVG', '#E8C46A'], png: ['IMG', '#A87BF0'], jpg: ['IMG', '#A87BF0'], jpeg: ['IMG', '#A87BF0'], gif: ['IMG', '#A87BF0'], webp: ['IMG', '#A87BF0'],
  pdf: ['PDF', '#F07178'], doc: ['DOC', '#6CB6FF'], docx: ['DOC', '#6CB6FF'], csv: ['CSV', '#A8D86E'], xlsx: ['XLS', '#A8D86E'],
  sql: ['SQL', '#E8C46A'], xml: ['XML', '#F0883E'], lock: ['LCK', '#9A9A9A'], zip: ['ZIP', '#9A9A9A'],
}

export function iconFor(name: string): Icon {
  const lower = name.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  const [label, colour] = LABELS[ext] ?? [(ext || 'TXT').slice(0, 3).toUpperCase(), '#9A9A9A']
  return { t: label.padEnd(3), c: colour }
}
