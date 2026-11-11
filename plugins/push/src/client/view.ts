/**
 * The button's view model: the enabling rule and its labels, kept free of
 * React so it is testable on its own.
 * @module
 */
import type { ButtonState } from './store.ts'

/** What the button shows and says for one state. */
export interface ButtonView {
  readonly enabled: boolean
  readonly state: 'ready' | 'idle' | 'running' | 'failed'
  readonly label: string
  readonly count: number | undefined
}

/**
 * Pure view model, so the enabling rule is testable without React.
 * @param button - the store state for one workspace.
 * @returns how the button renders.
 */
export function buttonView({ status, running }: ButtonState): ButtonView {
  if (running) return { enabled: false, state: 'running', label: 'Pulling and pushing…', count: undefined }
  if (status === undefined) return { enabled: false, state: 'idle', label: 'Push', count: undefined }
  switch (status.kind) {
    case 'ahead': {
      const commits = status.ahead === 1 ? '1 commit' : `${status.ahead} commits`
      return { enabled: true, state: 'ready', label: `Pull and push ${commits} on ${status.branch}`, count: status.ahead }
    }
    case 'error':
      return { enabled: false, state: 'failed', label: `Git status failed: ${status.message}`, count: undefined }
    case 'idle':
      return { enabled: false, state: 'idle', label: IDLE_LABELS[status.reason], count: undefined }
  }
}

const IDLE_LABELS = {
  'clean': 'Nothing to push',
  'no-repo': 'Not a git repository',
  'no-remote': 'No remote to push to',
  'detached': 'Detached HEAD',
} as const
