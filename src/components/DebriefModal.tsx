interface DebriefModalProps {
  workoutName: string
  onRequestChat?: (msg: string) => void
  onDismiss: () => void
}

export default function DebriefModal({ workoutName, onRequestChat, onDismiss }: DebriefModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h2 className="modal-title">Workout done!</h2>
        <p className="debrief-modal-subtitle">Nice work finishing {workoutName}.</p>
        <div className="debrief-modal-actions">
          {onRequestChat && (
            <button
              className="modal-btn"
              onClick={() => {
                onDismiss()
                onRequestChat(`I just finished ${workoutName}. Want to debrief?`)
              }}
            >
              Talk to my trainer
            </button>
          )}
          <button
            className="modal-btn modal-btn--secondary"
            onClick={onDismiss}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
