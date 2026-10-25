export type FileAction = 'read' | 'edit' | 'create' | 'commit'

export type Touched = {
  path: string
  action: FileAction
  active: number
  verb?: 'reading' | 'editing' | 'creating'
  at: number
}

export type Activity = {
  phase: 'idle' | 'thinking' | 'done'
  commit?: { sha: string; count: number }
}

export type GitFile = { code: string; adds: number; dels: number }

export type GitInfo = {
  isRepo: boolean
  top: string
  branch: string
  ahead: number
  changed: Record<string, GitFile>
  adds: number
  dels: number
}

export type Entry = { name: string; isDir: boolean; size: number; mtimeMs: number }

export type View = {
  root: string
  expanded: string[]
  hideHidden: boolean
  showSizes: boolean
  query: string
}

export type Preview = {
  path: string
  from: 'touched' | 'tree' | 'search'
  mode: 'diff' | 'file' | 'note'
  text: string
  split?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'live-filetree': {
      project: string
      activity: Activity
      touched: Touched[]
      git: GitInfo
      view: View
      dirs: Record<string, Entry[]>
      files: string[]
      preview: Preview | null
    }
  }
}
