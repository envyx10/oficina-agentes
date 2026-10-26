export type FloorStatus = 'working' | 'needs' | 'review' | 'sleeping'

/** One session of Claude Code on this machine: one floor of the tower. */
export type Floor = {
  id: string
  name: string
  initials: string
  status: FloorStatus
  activity: string
  tokens: number
  costUsd: number
  startedAt: number
  changedAt: number
  /** the folder the session runs in */
  project?: string
  /** subagents of the session working right now */
  subagents?: number
}

export type Weather = { tempC: number; label: string; city?: string; timeZone?: string }

declare module 'claude-code' {
  interface PluginState {
    'oficina-agentes': {
      me: Floor | null
      floors: Floor[]
      weather: Weather | null
      historic: number
      tpm: number
    }
  }
}
