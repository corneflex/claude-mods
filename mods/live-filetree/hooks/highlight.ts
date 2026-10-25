import Prism from './vendor/prism.js'
import type { PrismToken } from './vendor/prism'

// A coloured run of text on one line.
export type Tok = { t: string; c: string }

const PLAIN = '#D4D4D4'

// VS Code's Dark+ theme, keyed by Prism token type (the innermost type or alias wins).
const DARK_PLUS: Record<string, string> = {
  comment: '#6A9955', prolog: '#6A9955', doctype: '#6A9955', cdata: '#6A9955',
  keyword: '#569CD6', boolean: '#569CD6', atrule: '#C586C0', rule: '#C586C0', important: '#569CD6',
  'control-flow': '#C586C0',
  string: '#CE9178', char: '#CE9178', 'template-string': '#CE9178', 'attr-value': '#CE9178', url: '#CE9178',
  number: '#B5CEA8', unit: '#B5CEA8', hexcode: '#B5CEA8',
  function: '#DCDCAA', 'function-variable': '#DCDCAA', method: '#DCDCAA', 'function-definition': '#DCDCAA',
  'class-name': '#4EC9B0', builtin: '#4EC9B0', namespace: '#4EC9B0', 'maybe-class-name': '#4EC9B0',
  property: '#9CDCFE', 'attr-name': '#9CDCFE', parameter: '#9CDCFE', variable: '#9CDCFE', key: '#9CDCFE',
  constant: '#4FC1FF', symbol: '#4FC1FF',
  regex: '#D16969',
  tag: '#569CD6', selector: '#D7BA7D',
  title: '#569CD6', bold: '#569CD6', italic: '#CE9178', code: '#CE9178', 'code-snippet': '#CE9178', list: '#6796E6',
  operator: PLAIN, punctuation: PLAIN,
  // Code inside `${…}` reads as code again, with the braces in keyword blue.
  interpolation: PLAIN, 'interpolation-punctuation': '#569CD6',
}

// VS Code colours control-flow and module keywords purple, other keywords blue.
const CONTROL = new Set([
  'if', 'else', 'return', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'await', 'yield', 'import', 'export', 'from', 'default', 'match', 'loop', 'elif',
  'except', 'raise', 'with', 'pass', 'goto',
])

const LANGS: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown',
  py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', sql: 'sql',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', css: 'css', scss: 'css',
}

export function langFor(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (name === 'dockerfile' || name === 'makefile') return 'bash'
  return LANGS[name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '']
}

function colourOf(types: string[], text: string) {
  for (let i = types.length - 1; i >= 0; i--) {
    const type = types[i] ?? ''
    if (type === 'keyword' && CONTROL.has(text.trim())) return '#C586C0'
    const c = DARK_PLUS[type]
    if (c) return c
  }
  return PLAIN
}

// Flattens Prism's nested tokens into coloured runs, then splits them into lines.
function walk(tokens: (string | PrismToken)[], types: string[], out: Tok[][]) {
  for (const tok of tokens) {
    if (typeof tok === 'string') {
      const colour = colourOf(types, tok)
      tok.split('\n').forEach((part, i) => {
        if (i > 0) out.push([])
        if (part) out[out.length - 1]?.push({ t: part, c: colour })
      })
      continue
    }
    const aliases = tok.alias === undefined ? [] : Array.isArray(tok.alias) ? tok.alias : [tok.alias]
    const inner = [...types, ...aliases, tok.type]
    walk(typeof tok.content === 'string' ? [tok.content] : Array.isArray(tok.content) ? tok.content : [tok.content], inner, out)
  }
}

// The few highlighted texts in view, so a redraw does not tokenize them again.
const cache = new Map<string, Tok[][]>()

// One array of coloured runs per line of `text`; plain runs when the language is unknown.
export function highlightLines(text: string, lang: string | undefined): Tok[][] {
  const key = `${lang ?? ''}\u0000${text}`
  const hit = cache.get(key)
  if (hit) return hit
  const grammar = lang ? Prism.languages[lang] : undefined
  let lines: Tok[][]
  if (!grammar) {
    lines = text.split('\n').map(l => (l ? [{ t: l, c: PLAIN }] : []))
  } else {
    lines = [[]]
    walk(Prism.tokenize(text, grammar), [], lines)
  }
  cache.set(key, lines)
  if (cache.size > 12) cache.delete(cache.keys().next().value as string)
  return lines
}
