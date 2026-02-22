# Phase 3 - Chat Interface and Tool Flow

Status: IN PROGRESS

## Goal

Make chat reliable for onboarding, goal review, and planning tool interactions.

## 3a - Chat Screen Reliability (`src/screens/Chat.tsx`)

- [x] Load most recent conversation for active mode
- [x] Message list render + auto-scroll
- [x] Streaming/typing indicators (present, now under re-evaluation)
- [x] Save conversation after exchanges
- [x] New conversation action
- [x] Conversation type update fix during mode transition persistence
- [ ] Remove temporary debug `console.log` noise
- [ ] Add explicit recovery UI for any pending-tool dead state

## 3b - Tool Card and Action UX

- [x] `ProposeGoalsCard` + `ToolErrorCard`
- [x] Pending tool state handling
- [x] Safety-net guard against stuck pending state
- [x] Moved goals proposal panel above input for visibility/clickability
- [ ] Validate panel behavior on small screens and keyboard open

## 3c - Tool Call Robustness

- [x] Synchronous `resolveToolCall` path
- [x] Single-pass final thread assembly before persist (race reduction)
- [x] Unknown tool auto-error path (non-deadlocking)
- [x] Fake tool narration detection + user-guided retry prompt
- [ ] Add quality gate rejecting placeholder/low-information goal proposals
- [ ] Add explicit test for fake tool narration scenario

## 3d - API Transport and Provider Behavior (`src/lib/api.ts`)

- [x] Non-stream debug mode toggle (`DEBUG_NON_STREAM`)
- [x] Non-stream tool-call extraction logging
- [ ] Decide final mode: non-stream baseline vs restored streaming
- [ ] If restoring stream: harden parser for provider-specific delta shapes
- [ ] Remove temporary debug mode and logs once stable

## 3e - Planning Tool Path (`propose_workout`)

- [ ] Define `propose_workout` tool schema and runtime validator
- [ ] Validate all proposed dates in D0-D6 window
- [ ] Render workout proposal card(s)
- [ ] On accept: save workouts via always-append policy
- [ ] On request changes: continue conversation naturally

## 3f - Context Assembly

- [x] Inject goals + history context into prompt builder
- [x] Load recent workouts + summaries for planning context
- [ ] Wire lazy summarization execution path for unsummarized older weeks

## Acceptance Criteria

- Tool card is always visible and actionable when a valid tool call arrives
- Chat stays interactive if tool call is invalid or missing
- Returning to Chat tab does not blank active thread
- End-to-end onboarding -> accepted goals -> planning transition works consistently
- `propose_workout` path works end-to-end

## Model Policy (for this phase)

- Premium: `anthropic/claude-sonnet-4.6`
- Affordable: `z-ai/glm-5`

