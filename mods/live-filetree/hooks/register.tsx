import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Activity, Entry, FileAction, GitFile, GitInfo, Preview, Touched, View } from '../types'
import type { RowSpec, RowsProps, Seg } from './rows'
import { folderIcon, iconFor } from './icons'
import type { IconStyle } from './icons'

const PANE = 'live-filetree'

const project = atom({ plugin: 'live-filetree', key: 'project' } as const, '')
const activity = atom({ plugin: 'live-filetree', key: 'activity' } as const, { phase: 'idle' } as Activity)
const touched = atom({ plugin: 'live-filetree', key: 'touched' } as const, [] as Touched[])
const git = atom({ plugin: 'live-filetree', key: 'git' } as const, {
  isRepo: false,
  top: '',
  branch: '',
  ahead: 0,
  changed: {},
  adds: 0,
  dels: 0,
} as GitInfo)
const view = atom({ plugin: 'live-filetree', key: 'view' } as const, {
  root: '',
  expanded: [],
  hideHidden: false,
  showSizes: false,
  query: '',
} as View)
const dirs = atom({ plugin: 'live-filetree', key: 'dirs' } as const, {} as Record<string, Entry[]>)
const files = atom({ plugin: 'live-filetree', key: 'files' } as const, [] as string[])
const preview = atom({ plugin: 'live-filetree', key: 'preview' } as const, null as Preview | null)

const C = {
  read: '#A87BF0',
  edit: '#F0883E',
  create: '#4CC38A',
  commit: '#4CC38A',
  uncommitted: '#E5C07B',
  add: '#57C27A',
  del: '#E5534B',
  folder: '#5A9BEF',
  ahead: '#3FC1C9',
  dim: '#9A9A9A',
  card: '#1E1E1E',
  border: '#343434',
}


// What Claude did to a file, as a coloured text badge (no background).
const BADGE: Record<FileAction, [string, string]> = {
  read: ['◉ Opened', C.read],
  edit: ['✎ Edited', C.edit],
  create: ['✚ Created', C.create],
  commit: ['✓ Committed', C.commit],
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const FONT = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif"
const MAX_ROWS = 400

// Module variables start over on a reload; what is drawn lives in $.state.
let polling: { cancel: () => void } | undefined
let gitBusy = false

function dirname(p: string) {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

function basename(p: string) {
  return p.slice(p.lastIndexOf('/') + 1)
}

function joinPath(dir: string, name: string) {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`
}

function absolute(base: string, p: string) {
  if (p.startsWith('/')) return normalise(p)
  return normalise(joinPath(base, p))
}

function normalise(p: string) {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

function relative(base: string, p: string) {
  if (p === base) return ''
  return p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p
}

function isUnder(dir: string, p: string) {
  return p === dir || p.startsWith(dir === '/' ? '/' : `${dir}/`)
}


function dateText(ms: number) {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()] ?? ''}`
}

function sizeText(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textWidth(s: string, px: number) {
  let w = 0
  for (const ch of s) w += /[mwMW@]/.test(ch) ? 0.85 : /[il.,'|!:;]/.test(ch) ? 0.3 : /[A-Z]/.test(ch) ? 0.68 : 0.56
  return Math.ceil(w * px) + 4
}

// The live name: a bright band sweeps across the letters, a scan line runs under them, and
// edits get a blinking caret while new files type themselves in.
function iconSvg(kind: 'thinking' | 'reading' | 'editing' | 'creating' | 'committed' | 'idle' | 'answered') {
  const map = {
    thinking: ['#2C2C2C', '#D8D8D8'],
    idle: ['#2C2C2C', '#9A9A9A'],
    answered: ['#2C2C2C', '#D8D8D8'],
    reading: ['#2E2442', C.read],
    editing: ['#3A2A1C', C.edit],
    creating: ['#1B3328', C.create],
    committed: ['#1B3328', C.commit],
  } as const
  const [bg, fg] = map[kind]
  const glyphs: Record<typeof kind, string> = {
    thinking: `<g transform="translate(26 26)"><g><path d="M0-10V10M-8.7-5L8.7 5M-8.7 5L8.7-5" stroke="${fg}" stroke-width="2.6" stroke-linecap="round"/><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite"/></g></g>`,
    idle: `<circle cx="26" cy="26" r="4" fill="${fg}"/>`,
    answered: `<path d="M18 27l5 5 11-12" fill="none" stroke="${fg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    reading: `<g><path d="M14 26c4-7 20-7 24 0-4 7-20 7-24 0z" fill="none" stroke="${fg}" stroke-width="2.4"/><circle cx="26" cy="26" r="3.6" fill="${fg}"><animate attributeName="cx" values="23;29;23" dur="1.6s" repeatCount="indefinite"/></circle></g>`,
    editing: `<g><path d="M19 33l1.5-5.5L31 17l4 4-10.5 10.5z M29 19l4 4" fill="none" stroke="${fg}" stroke-width="2.4" stroke-linejoin="round"/><animateTransform attributeName="transform" type="translate" values="0 0;1.5 -1.5;0 0" dur="0.9s" repeatCount="indefinite"/></g>`,
    creating: `<path d="M26 17v18M17 26h18" stroke="${fg}" stroke-width="3" stroke-linecap="round"><animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite"/></path>`,
    committed: `<path d="M18 27l5 5 11-12" fill="none" stroke="${fg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  }
  const ring = kind === 'reading' || kind === 'editing' || kind === 'creating' || kind === 'thinking'
    ? `<circle cx="26" cy="26" r="24" fill="none" stroke="${fg}" stroke-opacity="0.5" stroke-width="1.5"><animate attributeName="r" values="22;25;22" dur="1.6s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.5;0;0.5" dur="1.6s" repeatCount="indefinite"/></circle>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="${bg}"/>${ring}${glyphs[kind]}</svg>`
}

// Shimmer palettes, darkest to brightest, and the tint behind a row Claude is working on.
const PALETTES: Record<string, string[]> = {
  reading: ['#7A5CB0', '#A87BF0', '#CDB4FF', '#FFFFFF'],
  editing: ['#B0602A', '#F0883E', '#FFC08A', '#FFFFFF'],
  creating: ['#2E8A5C', '#4CC38A', '#9BE8C2', '#FFFFFF'],
}
const VERB_COLOUR: Record<string, string> = { reading: '#A87BF0', editing: '#F0883E', creating: '#4CC38A' }

// VS Code dark diff colours.
const DIFF = {
  editorBg: '#1E1E1E',
  barBg: '#252526',
  tabBg: '#2D2D2D',
  gutter: '#6E7681',
  text: '#D4D4D4',
  delBg: '#4B1E1E',
  addBg: '#1F3A26',
  empty: '#252526',
  hunkBg: '#1E2A3A',
  hunk: '#79B8FF',
}

type DiffLine = { kind: 'ctx' | 'del' | 'add' | 'hunk'; text: string; old?: number; new?: number }

function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const raw of text.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw)
    if (h) {
      oldNo = Number(h[1])
      newNo = Number(h[2])
      inHunk = true
      out.push({ kind: 'hunk', text: raw })
    } else if (!inHunk || raw.startsWith('\\')) {
      continue
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), old: oldNo++ })
    } else if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), new: newNo++ })
    } else {
      out.push({ kind: 'ctx', text: raw.slice(1), old: oldNo++, new: newNo++ })
    }
  }
  return out
}

// Side by side: context on both sides; a run of removals faces the run of additions that follows it.
function pairLines(lines: DiffLine[]) {
  const out: { l?: DiffLine; r?: DiffLine; hunk?: string }[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i] as DiffLine
    if (l.kind === 'hunk') {
      out.push({ hunk: l.text })
      i++
    } else if (l.kind === 'ctx') {
      out.push({ l, r: l })
      i++
    } else {
      const dels: DiffLine[] = []
      const adds: DiffLine[] = []
      while (lines[i]?.kind === 'del') dels.push(lines[i++] as DiffLine)
      while (lines[i]?.kind === 'add') adds.push(lines[i++] as DiffLine)
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ l: dels[k], r: adds[k] })
    }
  }
  return out
}

async function run($: EngineInterface, argv: string[], cwd: string) {
  try {
    return await $.process.run(argv, { cwd, timeoutMs: 15_000 })
  } catch {
    return { exitCode: -1, stdout: '', stderr: '' }
  }
}

async function refreshGit($: EngineInterface) {
  if (gitBusy) return
  gitBusy = true
  try {
    const cwd = await read($, project)
    if (!cwd) return
    const top = await run($, ['git', 'rev-parse', '--show-toplevel'], cwd)
    if (top.exitCode !== 0) {
      await setIfChanged($, { isRepo: false, top: '', branch: '', ahead: 0, changed: {}, adds: 0, dels: 0 })
      return
    }
    const root = top.stdout.trim()
    const [branch, ahead, status, numstat] = await Promise.all([
      run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], root),
      run($, ['git', 'rev-list', '--count', '@{u}..HEAD'], root),
      run($, ['git', 'status', '--porcelain=v1', '-uall'], root),
      run($, ['git', 'diff', 'HEAD', '--numstat'], root),
    ])
    const changed: Record<string, GitFile> = {}
    for (const line of status.stdout.split('\n')) {
      if (line.length < 4) continue
      const code = line.slice(0, 2).trim() || 'M'
      let path = line.slice(3)
      if (path.includes(' -> ')) path = path.slice(path.indexOf(' -> ') + 4)
      path = path.replace(/^"|"$/g, '')
      changed[joinPath(root, path)] = { code: code === '??' ? 'U' : code[0] ?? 'M', adds: 0, dels: 0 }
    }
    let adds = 0
    let dels = 0
    for (const line of numstat.stdout.split('\n')) {
      const [a, d, ...rest] = line.split('\t')
      if (!rest.length) continue
      const abs = joinPath(root, rest.join('\t'))
      const fa = Number(a) || 0
      const fd = Number(d) || 0
      adds += fa
      dels += fd
      const entry = changed[abs]
      if (entry) changed[abs] = { ...entry, adds: fa, dels: fd }
    }
    // Untracked files count as all-added lines.
    for (const [abs, entry] of Object.entries(changed)) {
      if (entry.code !== 'U') continue
      try {
        const text = await $.fs.read(abs)
        const n = typeof text === 'string' && !text.includes('\u0000') ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0
        changed[abs] = { ...entry, adds: n }
        adds += n
      } catch {}
    }
    await setIfChanged($, {
      isRepo: true,
      top: root,
      branch: branch.stdout.trim() || 'HEAD',
      ahead: ahead.exitCode === 0 ? Number(ahead.stdout.trim()) || 0 : 0,
      changed,
      adds,
      dels,
    })
  } finally {
    gitBusy = false
  }
}

async function setIfChanged($: EngineInterface, next: GitInfo) {
  const now = await read($, git)
  if (JSON.stringify(now) !== JSON.stringify(next)) await update($, git, () => next)
}

async function refreshFileList($: EngineInterface) {
  const cwd = await read($, project)
  const out = await run($, ['git', 'ls-files', '-co', '--exclude-standard'], cwd)
  if (out.exitCode !== 0) return
  const list = out.stdout.split('\n').filter(Boolean).slice(0, 8000).map(p => joinPath(cwd, p))
  await update($, files, () => list)
}

async function loadDir($: EngineInterface, dir: string) {
  let entries: Entry[] = []
  try {
    const raw = await $.fs.list(dir)
    entries = raw
      .filter(e => e.kind !== 'other')
      .map(e => ({ name: e.name, isDir: e.kind === 'dir', size: e.size, mtimeMs: e.mtimeMs }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  } catch {}
  const known = (await read($, dirs))[dir]
  if (known && JSON.stringify(known) === JSON.stringify(entries)) return
  await update($, dirs, all => ({ ...all, [dir]: entries }))
}

async function toggleDir($: EngineInterface, path: string) {
  const v = await read($, view)
  const isOpen = v.expanded.includes(path)
  await update($, view, cur => ({
    ...cur,
    expanded: isOpen ? cur.expanded.filter(d => d !== path) : [...cur.expanded, path],
  }))
  if (!isOpen) await loadDir($, path)
}

async function reloadOpenDirs($: EngineInterface) {
  const v = await read($, view)
  const roots = [v.root, ...v.expanded.filter(d => isUnder(v.root, d))]
  await Promise.all([...new Set(roots)].map(d => loadDir($, d)))
}

async function revealPath($: EngineInterface, file: string) {
  const v = await read($, view)
  if (!isUnder(v.root, file)) return
  const chain: string[] = []
  for (let d = dirname(file); isUnder(v.root, d) && d !== v.root; d = dirname(d)) chain.push(d)
  const missing = chain.filter(d => !v.expanded.includes(d))
  if (missing.length === 0) return
  await update($, view, cur => ({ ...cur, expanded: [...cur.expanded, ...missing] }))
  const known = await read($, dirs)
  await Promise.all(missing.filter(d => !known[d]).map(d => loadDir($, d)))
}

async function markStart($: EngineInterface, path: string, action: FileAction, verb: Touched['verb']) {
  const at = await $.clock.now()
  await update($, touched, list => {
    const found = list.find(t => t.path === path)
    if (!found) return [...list, { path, action, active: 1, verb, at }]
    return list.map(t => (t.path === path ? { ...t, active: t.active + 1, verb, at } : t))
  })
  await revealPath($, path)
}

async function markEnd($: EngineInterface, path: string, action: FileAction, ok: boolean) {
  // Keep the strongest thing Claude did to a file this turn.
  const rank: Record<FileAction, number> = { read: 0, edit: 1, create: 2, commit: 3 }
  await update($, touched, list =>
    list.map(t => {
      if (t.path !== path) return t
      const active = Math.max(0, t.active - 1)
      const kept = ok && rank[action] > rank[t.action] ? action : t.action
      return { ...t, active, verb: active ? t.verb : undefined, action: kept }
    }),
  )
}

async function loadPreview($: EngineInterface, path: string, from: Preview['from']) {
  const g = await read($, git)
  const cwd = await read($, project)
  let result: Preview = { path, from, mode: 'note', text: 'Nothing to show.' }
  const change = g.changed[path]
  if (g.isRepo && change) {
    const out = change.code === 'U'
      ? await run($, ['git', 'diff', '--no-index', '--', '/dev/null', path], g.top)
      : await run($, ['git', 'diff', 'HEAD', '--', path], g.top)
    const text = out.stdout.trim()
    result = text.includes('Binary files')
      ? { path, from, mode: 'note', text: 'Binary file changed.' }
      : text
        ? { path, from, mode: 'diff', text: text.split('\n').slice(0, 1500).join('\n') }
        : result
  } else {
    try {
      const text = await $.fs.read(path)
      if (typeof text !== 'string' || text.includes('\u0000')) {
        result = { path, from, mode: 'note', text: 'Binary file, no changes.' }
      } else {
        const lines = text.split('\n')
        result = {
          path,
          from,
          mode: 'file',
          text: lines.slice(0, 300).join('\n') + (lines.length > 300 ? `\n… ${lines.length - 300} more lines` : ''),
        }
      }
    } catch {
      result = { path, from, mode: 'note', text: `Can't open ${relative(cwd, path)}.` }
    }
  }
  await update($, preview, () => result)
}

function startPolling($: EngineInterface) {
  if (polling) return
  polling = $.clock.every(5000, () => {
    void refreshGit($)
  })
}

const READ_TOOLS = new Set(['Read'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit'])

export const register: Register = (on, options) => {
  const iconSetting = typeof options.icons === 'string' ? options.icons : 'auto'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const cwd = e.cwd
    await update($, project, () => cwd)
    await update($, view, v => (v.root ? v : { ...v, root: cwd }))
    await $.command.register({ name: 'live-files', description: 'Show the live Files pane' }).catch(() => undefined)
    await $.tool.register({
      name: 'state',
      description: 'Returns what the live Files pane holds (activity, touched files, git status) as JSON. Read-only.',
      inputSchema: { type: 'object', properties: {} },
    }).catch(() => undefined)
    void (async () => {
      await loadDir($, cwd)
      await reloadOpenDirs($)
      await refreshGit($)
      await refreshFileList($)
    })()
    startPolling($)
    const isDocked = e.surface === 'desktop' || e.surface === 'vscode'
    if (isDocked) void $.ui.open({ id: PANE, title: `Files: ${basename(cwd)}` })
    return started
  })

  on('command.run', { command: 'live-files' }, async $ => {
    const cwd = await read($, project)
    await $.ui.open({ id: PANE, title: `Files: ${basename(cwd)}` })
    return { text: 'Files pane opened.' }
  })

  on('tool.call', { tool: 'mcp__live-filetree__state' }, async $ => {
    const state = {
      project: await read($, project),
      activity: await read($, activity),
      touched: await read($, touched),
      git: await read($, git),
      view: await read($, view),
      preview: await read($, preview),
    }
    const text = JSON.stringify(state, null, 2)
    return { result: text, text }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, activity, (): Activity => ({ phase: 'thinking' }))
      await update($, touched, list => list.filter(t => t.active > 0))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, activity, (a): Activity => ({ ...a, phase: 'done' }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const cwd = await read($, project)
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const rawPath = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''

    if (rawPath && (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool) || tool === 'Write' || tool === 'NotebookEdit')) {
      const path = absolute(cwd, rawPath)
      let action: FileAction = 'read'
      let verb: Touched['verb'] = 'reading'
      if (EDIT_TOOLS.has(tool) || tool === 'NotebookEdit') {
        action = 'edit'
        verb = 'editing'
      } else if (tool === 'Write') {
        const exists = await $.fs.exists(path).catch(() => true)
        action = exists ? 'edit' : 'create'
        verb = exists ? 'editing' : 'creating'
      }
      await markStart($, path, action, verb)
      let ok = false
      try {
        const result = await next(e)
        ok = !('deny' in result && result.deny) && !('isError' in result && result.isError)
        return result
      } finally {
        await markEnd($, path, action, ok)
        if (action !== 'read') {
          await loadDir($, dirname(path))
          void refreshGit($)
          if (action === 'create') void refreshFileList($)
        }
      }
    }

    if (tool === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : ''
      const result = await next(e)
      const isCommit = /\bgit\b[^|;&]*\bcommit\b/.test(command)
      const ok = !('deny' in result && result.deny) && !('isError' in result && result.isError)
      if (isCommit && ok) {
        const g = await read($, git)
        const top = g.top || cwd
        const sha = await run($, ['git', 'log', '-1', '--format=%h'], top)
        const names = await run($, ['git', 'show', '--name-only', '--format=', 'HEAD'], top)
        const committed = names.stdout.split('\n').filter(Boolean).map(p => joinPath(top, p))
        const at = await $.clock.now()
        if (sha.exitCode === 0 && committed.length) {
          await update($, touched, list => {
            const kept = list.map(t => (committed.includes(t.path) ? { ...t, action: 'commit' as const } : t))
            const extra = committed
              .filter(p => !list.some(t => t.path === p))
              .map(p => ({ path: p, action: 'commit' as const, active: 0, at }))
            return [...kept, ...extra]
          })
          await update($, activity, (a): Activity => ({ ...a, commit: { sha: sha.stdout.trim(), count: committed.length } }))
        }
      }
      void refreshGit($)
      void reloadOpenDirs($)
      return result
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE || !['touched', 'tree', 'search'].includes(e.element)) return next(e)
    const press = (e.data as { press?: unknown } | null)?.press
    if (typeof press !== 'string' || press.length < 3) return {}
    const path = press.slice(2)
    if (press.startsWith('d:')) await toggleDir($, path)
    else await loadPreview($, path, e.element as Preview['from'])
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Code } = ui
    const Client = e.surface === 'desktop' || e.surface === 'terminal' ? $.ui.resolve(e).Client : undefined
    const iconStyle: IconStyle = iconSetting === 'nerd' || (iconSetting === 'auto' && e.surface === 'terminal') ? 'nerd' : 'emoji'
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const cwd = await read($, project)
    const act = await read($, activity)
    const list = await read($, touched)
    const g = await read($, git)
    const v = await read($, view)
    const listing = await read($, dirs)
    const allFiles = await read($, files)
    const shown = await read($, preview)

    const svg = (source: string, alt: string, live = false) =>
      Svg ? <Svg source={source} alt={alt} isInteractive={live ? true : undefined} /> : null

    const active = list.filter(t => t.active > 0)
    const activeByPath = new Map(active.map(t => [t.path, t]))
    const touchedByPath = new Map(list.map(t => [t.path, t]))

    // --- Right now / Done card -------------------------------------------------------------
    type Kind = Parameters<typeof iconSvg>[0]
    let kind: Kind = 'idle'
    let label = 'RIGHT NOW'
    let labelColor = C.dim
    let headline = 'Waiting for you'
    let sub: RenderChildren = <Text dimColor>no files touched yet</Text>
    const statsOf = (path: string) => g.changed[path]
    const statText = (adds: number, dels: number) => [
      <Text color={C.add}>{` +${adds}`}</Text>,
      <Text color={C.del}>{` -${dels}`}</Text>,
    ]

    if (active.length) {
      const verb = active.some(t => t.verb === 'editing') ? 'editing' : active.some(t => t.verb === 'creating') ? 'creating' : 'reading'
      const group = active.filter(t => t.verb === verb)
      kind = verb
      labelColor = verb === 'reading' ? C.read : verb === 'editing' ? C.edit : C.create
      headline = group.length === 1
        ? `Claude is ${verb} ${basename(group[0]?.path ?? '')}`
        : `Claude is ${verb} ${plural(group.length, 'file')}`
      sub = group.length === 1
        ? <Text dimColor>{relative(cwd, group[0]?.path ?? '')}</Text>
        : <Text dimColor wrap="truncate-end">{group.map(t => basename(t.path)).join(', ')}</Text>
    } else if (act.phase === 'thinking') {
      kind = 'thinking'
      headline = 'Claude is thinking'
      sub = <Text dimColor>{list.length ? `${plural(list.length, 'file')} touched so far` : 'no files touched yet'}</Text>
    } else if (act.phase === 'done') {
      label = 'DONE'
      const changedFiles = list.filter(t => t.action === 'edit' || t.action === 'create')
      if (act.commit) {
        kind = 'committed'
        labelColor = C.commit
        headline = `Claude committed ${plural(act.commit.count, 'file')}`
        sub = <Text dimColor>{act.commit.sha}</Text>
      } else if (changedFiles.length) {
        const created = changedFiles.filter(t => t.action === 'create').length
        const edited = changedFiles.length - created
        kind = edited ? 'editing' : 'creating'
        labelColor = edited ? C.edit : C.create
        headline = edited && created
          ? `Claude edited ${edited} and created ${created}`
          : edited
            ? `Claude edited ${plural(edited, 'file')}`
            : `Claude created ${plural(created, 'file')}`
        const one = changedFiles.length === 1 ? changedFiles[0] : undefined
        const s = one ? statsOf(one.path) : undefined
        const sum = changedFiles.reduce(
          (acc, t) => ({ a: acc.a + (statsOf(t.path)?.adds ?? 0), d: acc.d + (statsOf(t.path)?.dels ?? 0) }),
          { a: 0, d: 0 },
        )
        sub = one
          ? <Text><Text dimColor>{relative(cwd, one.path)}</Text>{s ? statText(s.adds, s.dels) : null}</Text>
          : <Text><Text dimColor>across {plural(changedFiles.length, 'file')}</Text>{statText(sum.a, sum.d)}</Text>
      } else if (list.length) {
        kind = 'reading'
        labelColor = C.read
        headline = `Claude read ${plural(list.length, 'file')}`
        sub = <Text dimColor wrap="truncate-end">{list.map(t => basename(t.path)).join(', ')}</Text>
      } else {
        kind = 'answered'
        headline = 'Claude answered'
        sub = <Text dimColor>no files touched</Text>
      }
    }

    const changedCount = Object.keys(g.changed).length
    const branchRight = !g.isRepo
      ? <Text dimColor>not a git repository</Text>
      : changedCount === 0
        ? <Text dimColor>clean, nothing changed</Text>
        : (
          <Text>
            <Text color={C.add}>{`+${g.adds}`}</Text>
            <Text color={C.del}>{` -${g.dels}`}</Text>
            <Text dimColor> · </Text>
            <Text color={C.uncommitted} bold>{`${changedCount} changed`}</Text>
          </Text>
        )

    const legend = (color: string, text: string) => (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={color}>●</Text>
        <Text dimColor>{text}</Text>
      </Box>
    )

    const statusCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.border} backgroundColor={Svg ? C.card : undefined} padding={1} gap="sm">
        <Box flexDirection="row" gap={2} alignItems="center">
          {Svg ? svg(iconSvg(kind), kind, kind !== 'idle' && kind !== 'answered' && kind !== 'committed') : <Text color={labelColor}>{kind === 'thinking' ? '✳' : '●'}</Text>}
          <Box flexDirection="column" flexShrink={1}>
            <Text color={labelColor} bold size="caption">{label}</Text>
            <Text bold weight="bold" size="heading">{headline}</Text>
            {sub}
          </Box>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" borderStyle="single" borderColor={C.border} paddingTop={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color={C.folder} bold>⎇</Text>
            <Text bold weight="bold">{g.isRepo ? g.branch : basename(cwd)}</Text>
            {g.ahead > 0 && <Text color={C.ahead} bold>{`↑${g.ahead}`}</Text>}
          </Box>
          {branchRight}
        </Box>
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {legend(C.read, 'Claude read')}
          {legend(C.edit, 'Claude edited')}
          {legend(C.uncommitted, 'Not committed')}
        </Box>
      </Box>
    )

    // --- Rows for the animated Client (touched list, search results, tree) -----------------
    const rowFor = (path: string, opts: { indent?: number; dir?: boolean }): RowSpec => {
      const t = activeByPath.get(path)
      const done = touchedByPath.get(path)
      const c = g.changed[path]
      const n = basename(path)
      const icon = iconFor(n, iconStyle)
      const left: Seg[] = [{ t: '  '.repeat(opts.indent ?? 0) }, { t: `${icon.t} `, c: icon.c }]
      if (t?.verb) left.push({ t: n, sh: t.verb, b: true })
      else left.push({ t: n, b: true, c: c ? C.uncommitted : done?.action === 'read' ? C.read : undefined })
      if (opts.dir) left.push({ t: `  ${relative(cwd, dirname(path)) || '.'}`, dim: true })
      const right: Seg[] = []
      if (t?.verb) {
        right.push({ t: `${t.verb} `, c: VERB_COLOUR[t.verb], spin: true, b: true })
      } else {
        if (c && done?.action !== 'commit' && (c.adds || c.dels)) {
          if (!done) right.push({ t: `${c.code} `, c: C.uncommitted, b: true })
          right.push({ t: `+${c.adds}`, c: C.add }, { t: ` -${c.dels} `, c: C.del })
        }
        if (done) {
          const [txt, colour] = BADGE[done.action]
          right.push({ t: txt, c: colour, b: true })
        } else if (!c && opts.indent !== undefined) {
          const entry = listing[dirname(path)]?.find(x => x.name === n)
          if (entry) right.push({ t: v.showSizes ? sizeText(entry.size) : dateText(entry.mtimeMs), dim: true })
        }
      }
      return { id: `f:${path}`, left, right }
    }

    // Rows animate inside a Client, so a shimmer never redraws the pane. Surfaces without Client get them still.
    const rowsClient = (key: 'touched' | 'tree' | 'search', rows: RowSpec[], empty: string) => {
      // Client props must be plain data: the JSON round trip drops the fields left undefined.
      const props: RowsProps = JSON.parse(JSON.stringify({ rows, hoverBg: '#2A2D2E', palettes: PALETTES, empty }))
      if (Client) return <Client key={key} module="./rows.tsx" props={props} />
      if (rows.length === 0) return <Text dimColor>{empty}</Text>
      const seg = (x: Seg) => <Text color={x.sh ? VERB_COLOUR[x.sh] : x.c} bold={x.b} dimColor={x.dim}>{x.t}</Text>
      return (
        <Box flexDirection="column">
          {rows.map((r, i) => {
            const path = r.id.slice(2)
            const open = r.id.startsWith('d:') ? () => void toggleDir($, path) : () => void loadPreview($, path, key)
            return (
              <Box key={`${key}${i}`} flexDirection="row">
                {r.id ? <Button key={`${key}:${r.id}`} plain onPress={open}>{r.left.map(seg)}</Button> : <Text>{r.left.map(seg)}</Text>}
                <Box flexGrow={1} />
                <Text>{r.right.map(seg)}</Text>
              </Box>
            )
          })}
        </Box>
      )
    }

    // --- Full-screen diff, VS Code style --------------------------------------------------
    if (shown) {
      const c = g.changed[shown.path]
      const width = e.props.bodyColumns
      const split = shown.split ?? width >= 110
      const lines = shown.mode === 'diff' ? parseDiff(shown.text) : []
      const num = (n?: number) => (n === undefined ? '' : String(n)).padStart(5) + ' '
      const line = (key: string, l: DiffLine | undefined, side: 'old' | 'new' | 'both') => {
        const bg = !l ? DIFF.empty : l.kind === 'del' ? DIFF.delBg : l.kind === 'add' ? DIFF.addBg : undefined
        const mark = !l ? ' ' : l.kind === 'del' ? '-' : l.kind === 'add' ? '+' : ' '
        const gutter = !l ? '' : side === 'both' ? `${num(l.old)}${num(l.new)}` : num(side === 'old' ? l.old : l.new)
        return (
          <Box key={key} flexDirection="row" height={1} overflow="hidden" backgroundColor={bg} flexGrow={1} width={side === 'both' ? undefined : '50%'}>
            <Text color={DIFF.gutter}>{gutter.padEnd(side === 'both' ? 12 : 6)}</Text>
            <Text color={l?.kind === 'del' ? C.del : l?.kind === 'add' ? C.add : DIFF.gutter}>{`${mark} `}</Text>
            <Text color={DIFF.text} wrap="truncate-end">{l?.text ?? ''}</Text>
          </Box>
        )
      }
      const hunk = (key: string, text: string) => (
        <Box key={key} flexDirection="row" height={1} backgroundColor={DIFF.hunkBg} paddingX={1}>
          <Text color={DIFF.hunk} wrap="truncate-end">{text}</Text>
        </Box>
      )
      const body: RenderChildren[] = []
      if (shown.mode === 'diff' && split) {
        pairLines(lines).forEach((p, i) =>
          body.push(
            p.hunk !== undefined
              ? hunk(`h${i}`, p.hunk)
              : <Box key={`p${i}`} flexDirection="row">{line(`l${i}`, p.l, 'old')}{line(`r${i}`, p.r, 'new')}</Box>,
          ),
        )
      } else if (shown.mode === 'diff') {
        lines.forEach((l, i) => body.push(l.kind === 'hunk' ? hunk(`h${i}`, l.text) : line(`i${i}`, l, 'both')))
      }
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1} backgroundColor={DIFF.barBg} paddingX={1}>
            <Button key="back" label="← Files" hotkey="b" onPress={() => void update($, preview, () => null)} />
            <Text color={iconFor(basename(shown.path), iconStyle).c}>{iconFor(basename(shown.path), iconStyle).t}</Text>
            <Text bold>{basename(shown.path)}</Text>
            <Text dimColor wrap="truncate-end">{relative(cwd, dirname(shown.path)) || '.'}</Text>
            <Box flexGrow={1} />
            {c ? <Text><Text color={C.add}>{`+${c.adds}`}</Text><Text color={C.del}>{` -${c.dels}`}</Text></Text> : null}
            {shown.mode === 'diff' && (
              <Button
                key="layout"
                label={split ? 'Inline' : 'Side by side'}
                hotkey="v"
                onPress={() => void update($, preview, p => (p ? { ...p, split: !split } : p))}
              />
            )}
          </Box>
          <Box flexDirection="row" backgroundColor={DIFF.tabBg} paddingX={1}>
            <Text dimColor>
              {shown.mode === 'diff'
                ? split ? `${relative(cwd, shown.path)} (HEAD)  ↔  ${relative(cwd, shown.path)} (working tree)` : `git diff HEAD -- ${relative(cwd, shown.path)}`
                : shown.mode === 'file' ? `${relative(cwd, shown.path)} · no changes` : relative(cwd, shown.path)}
            </Text>
          </Box>
          <Box flexDirection="column" backgroundColor={DIFF.editorBg}>
            {shown.mode === 'diff' ? body : null}
            {shown.mode === 'file' ? <Code source={shown.text} path={shown.path} startLine={1} wrap="truncate-end" /> : null}
            {shown.mode === 'note' ? <Box padding={1}><Text dimColor>{shown.text}</Text></Box> : null}
          </Box>
        </Box>
      )
    }

    // --- Search and tools --------------------------------------------------------------------
    const setView = (fn: (cur: View) => View) => update($, view, fn)
    const toolButton = (key: string, label: string, onPress: () => void) => (
      <Button key={key} label={label} onPress={onPress} />
    )

    const search = Input ? (
      <Input
        key="find"
        placeholder="Find a file"
        value={v.query}
        onInput={value => void setView(cur => ({ ...cur, query: value }))}
        onSubmit={value => void setView(cur => ({ ...cur, query: value }))}
      />
    ) : null

    const tools = (
      <Box flexDirection="column" gap="xs">
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {toolButton('refresh', 'Refresh', () => {
            void (async () => {
              await reloadOpenDirs($)
              await refreshGit($)
              await refreshFileList($)
            })()
          })}
          {toolButton('collapse', 'Collapse all', () => void setView(cur => ({ ...cur, expanded: [] })))}
          {toolButton('sizes', v.showSizes ? 'Show dates' : 'Show sizes', () => void setView(cur => ({ ...cur, showSizes: !cur.showSizes })))}
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {toolButton('up', 'Up a folder', () => {
            void (async () => {
              const parent = dirname(v.root)
              await setView(cur => ({ ...cur, root: parent }))
              await loadDir($, parent)
            })()
          })}
          {toolButton('home', 'Back to project', () => {
            void (async () => {
              await setView(cur => ({ ...cur, root: cwd }))
              await loadDir($, cwd)
            })()
          })}
          {toolButton('hidden', v.hideHidden ? 'Show hidden files' : 'Hide hidden files', () => void setView(cur => ({ ...cur, hideHidden: !cur.hideHidden })))}
        </Box>
      </Box>
    )

    // --- Claude touched ----------------------------------------------------------------------
    const touchedCard = (
      <Box flexDirection="column" borderStyle="round" borderColor={C.border} backgroundColor={Svg ? C.card : undefined} paddingX={1} paddingY="sm">
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor bold>CLAUDE TOUCHED</Text>
          <Text dimColor bold>{`${list.length} FILE${list.length === 1 ? '' : 'S'}`}</Text>
        </Box>
        {rowsClient('touched', list.map(t => rowFor(t.path, { dir: true })), '  Nothing yet')}
      </Box>
    )

    // --- Search results or the tree ------------------------------------------------------------
    const q = v.query.trim().toLowerCase()
    let lower: RenderChildren
    if (q) {
      const results = allFiles.filter(p => relative(cwd, p).toLowerCase().includes(q)).slice(0, 60)
      lower = (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
            <Text dimColor bold>MATCHES</Text>
            <Text dimColor bold>{results.length === 60 ? '60+' : String(results.length)}</Text>
          </Box>
          {rowsClient('search', results.map(p => rowFor(p, { dir: true })), `  No file matches “${v.query}”`)}
        </Box>
      )
    } else {
      const rows: RowSpec[] = []
      const hasLive = (dir: string) => active.some(t => isUnder(dir, t.path))
      const hasChanges = (dir: string) => Object.keys(g.changed).some(p => isUnder(dir, p))
      const walk = (dir: string, depth: number) => {
        const entries = listing[dir]
        if (!entries) {
          rows.push({ id: '', left: [{ t: `${'  '.repeat(depth + 1)}loading…`, dim: true }], right: [] })
          return
        }
        for (const entry of entries) {
          if (rows.length >= MAX_ROWS) return
          if (v.hideHidden && entry.name.startsWith('.')) continue
          const path = joinPath(dir, entry.name)
          if (entry.isDir) {
            const isOpen = v.expanded.includes(path)
            const colour = hasLive(path) ? C.read : hasChanges(path) ? C.uncommitted : C.folder
            rows.push({
              id: `d:${path}`,
              left: [{ t: '  '.repeat(depth) }, { t: isOpen ? '▾ ' : '▸ ', dim: true }, { t: `${folderIcon(isOpen, iconStyle).t} `, c: folderIcon(isOpen, iconStyle).c }, { t: entry.name, c: colour, b: true }],
              right: [],
            })
            if (isOpen) walk(path, depth + 1)
          } else {
            rows.push(rowFor(path, { indent: depth + 1 }))
          }
        }
      }
      walk(v.root, 0)
      if (rows.length >= MAX_ROWS) rows.push({ id: '', left: [{ t: '… more files hidden, use Find a file', dim: true }], right: [] })
      lower = (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
            <Text dimColor bold>ALL FILES</Text>
            <Text dimColor bold>{basename(v.root).toUpperCase() || '/'}</Text>
          </Box>
          {rowsClient('tree', rows, '  Empty folder')}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {statusCard}
        {search}
        {tools}
        {touchedCard}
        {lower}
      </Box>
    )
  })
}
