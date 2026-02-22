import { useState } from 'react'
import MarkdownText from './MarkdownText.tsx'

// ─── propose_goals card ────────────────────────────────────────────────────────

interface ProposeGoalsCardProps {
  proposedText: string
  onAccept: () => void
  onRequestChanges: (feedback: string) => void
}

export function ProposeGoalsCard({ proposedText, onAccept, onRequestChanges }: ProposeGoalsCardProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')

  function handleRequestChanges() {
    if (!showFeedback) {
      setShowFeedback(true)
      return
    }
    if (!feedback.trim()) return
    onRequestChanges(feedback.trim())
  }

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <span className="tool-card-label">Proposed Goals</span>
      </div>
      <div className="tool-card-content">
        <MarkdownText text={proposedText} />
      </div>
      {showFeedback && (
        <textarea
          className="tool-card-feedback"
          placeholder="What would you like to change?"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
          autoFocus
        />
      )}
      <div className="tool-card-actions">
        <button className="tool-card-btn tool-card-btn--accept" onClick={onAccept}>
          Accept
        </button>
        <button
          className="tool-card-btn tool-card-btn--reject"
          onClick={handleRequestChanges}
          disabled={showFeedback && !feedback.trim()}
        >
          {showFeedback ? 'Send feedback' : 'Request changes'}
        </button>
      </div>
    </div>
  )
}

// ─── Error card ────────────────────────────────────────────────────────────────

interface ToolErrorCardProps {
  toolName: string
  message: string
}

export function ToolErrorCard({ toolName, message }: ToolErrorCardProps) {
  return (
    <div className="tool-card tool-card--error">
      <div className="tool-card-header">
        <span className="tool-card-label">Tool error: {toolName}</span>
      </div>
      <div className="tool-card-content">
        <MarkdownText text={message} />
      </div>
    </div>
  )
}
