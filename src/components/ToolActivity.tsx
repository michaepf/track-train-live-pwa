import type { ToolActivityStatus, ToolActivityViewModel } from '../lib/toolRuntime.ts'

export type { ToolActivityStatus, ToolActivityViewModel } from '../lib/toolRuntime.ts'

export interface ToolActivityRecoveryAction {
  label: string
  onSelect: () => void
  disabled?: boolean
}

export interface ToolActivityProps {
  activity: ToolActivityViewModel
  recoveryAction?: ToolActivityRecoveryAction
}

interface StatusPresentation {
  label: string
  symbol: string
  isActive: boolean
}

const STATUS_PRESENTATION: Record<ToolActivityStatus, StatusPresentation> = {
  running: { label: 'Working', symbol: '', isActive: true },
  correcting: { label: 'Correcting', symbol: '', isActive: true },
  awaiting_approval: { label: 'Review needed', symbol: '◇', isActive: false },
  succeeded: { label: 'Done', symbol: '✓', isActive: false },
  no_change: { label: 'No changes', symbol: '—', isActive: false },
  partially_succeeded: { label: 'Partially done', symbol: '!', isActive: false },
  failed: { label: 'Not completed', symbol: '!', isActive: false },
}

export function ToolActivity({ activity, recoveryAction }: ToolActivityProps) {
  const presentation = STATUS_PRESENTATION[activity.status]
  const isLive = activity.status === 'running' || activity.status === 'correcting'
  const isFailure = activity.status === 'failed'

  return (
    <div
      className={`tool-activity tool-activity--${activity.status}`}
      role={isFailure ? 'alert' : isLive ? 'status' : undefined}
      aria-live={isLive ? 'polite' : undefined}
      aria-atomic={isLive ? 'true' : undefined}
    >
      <span
        className={`tool-activity__icon${presentation.isActive ? ' tool-activity__icon--active' : ''}`}
        aria-hidden="true"
      >
        {presentation.symbol}
      </span>

      <div className="tool-activity__content">
        <div className="tool-activity__heading">
          <span className="tool-activity__state-label">{presentation.label}</span>
          <span className="tool-activity__message">{activity.message}</span>
        </div>
        {activity.detail && <div className="tool-activity__detail">{activity.detail}</div>}
        {activity.nextStep && (
          <div className="tool-activity__next-step">
            <span className="tool-activity__next-step-label">Next:</span> {activity.nextStep}
          </div>
        )}
      </div>

      {recoveryAction && (
        <button
          type="button"
          className="tool-activity__action"
          onClick={recoveryAction.onSelect}
          disabled={recoveryAction.disabled}
        >
          {recoveryAction.label}
        </button>
      )}
    </div>
  )
}
