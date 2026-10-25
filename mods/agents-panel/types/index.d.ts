export type AgentRow = {
  id: string
  runId: string
  description: string
  type: string
  model: string
  effort?: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  steps: number
  toolsStarted: number
  toolsDone: number
  tokens: number
  contextTokens: number
  cost: number
  avatar: number
}

export type RunRow = { id: string; title: string; startedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'agents-panel': {
      agents: AgentRow[]
      runs: RunRow[]
      collapsed: string[]
      now: number
    }
  }
}
