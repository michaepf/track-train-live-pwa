# Phase 3 - Chat Interface and Tool Flow

Status: IN PROGRESS (late-stage polish)

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
- [x] Add explicit recovery UI for pending-tool and missing-tool-call dead states

## 3b - Tool Card and Action UX

- [x] `ProposeGoalsCard` + `ToolErrorCard`
- [x] `ProposeWorkoutCard` + Accept/Request changes actions
- [x] Pending tool state handling
- [x] Safety-net guard against stuck pending state
- [x] Moved goals proposal panel above input for visibility/clickability
- [x] Accept-plan path now shows explicit save confirmation text
- [ ] Validate panel behavior on small screens and keyboard open

## 3c - Tool Call Robustness

- [x] Synchronous `resolveToolCall` path
- [x] Single-pass final thread assembly before persist (race reduction)
- [x] Unknown tool auto-error path (non-deadlocking)
- [x] Fake tool narration detection + user-guided retry prompt
- [x] Auto-retry invalid tool calls with schema-aware correction hints (bounded retries)
- [ ] Add quality gate rejecting placeholder/low-information goal proposals
- [ ] Add explicit test for fake tool narration scenario

## 3d - API Transport and Provider Behavior (`src/lib/api.ts`)

- [x] Non-stream debug mode toggle (`DEBUG_NON_STREAM`)
- [x] Non-stream tool-call extraction logging
- [x] Tool-choice support in API request payload for stricter planning turns
- [ ] Decide final mode: non-stream baseline vs restored streaming
- [ ] If restoring stream: harden parser for provider-specific delta shapes
- [ ] Remove temporary debug mode and logs once stable

## 3e - Planning Tool Path (`propose_workout`)

- [x] Define `propose_workout` tool schema and runtime validator
- [x] Validate all proposed dates in D0-D6 window
- [x] Render workout proposal card(s)
- [x] On accept: save workouts via always-append policy
- [x] On request changes: continue conversation naturally
- [x] Normalize loose provider payloads before strict validation
- [x] Stop auto-follow-up generation after accept (avoid confusing retry loops)
- [x] Add delete tools for planning cleanup (`delete_future_workouts`, `delete_workout_history`)

## 3f - Context Assembly

- [x] Inject goals + history context into prompt builder
- [x] Load recent workouts + summaries for planning context
- [x] Inject upcoming D0-D6 existing-workout context to avoid accidental duplicate plans
- [x] Include user notes (workout + exercise) in history context for future planning quality
- [ ] Wire lazy summarization execution path for unsummarized older weeks

## Acceptance Criteria

- Tool card is always visible and actionable when a valid tool call arrives
- Chat stays interactive if tool call is invalid or missing
- Returning to Chat tab does not blank active thread
- End-to-end onboarding -> accepted goals -> planning transition works consistently
- `propose_workout` path works end-to-end

## 3g - Navigation / IA Decisions (Locked)

- [x] Rename `Today` tab label to `Workouts` for the current list view
- [x] Add read-only workouts list UI to verify saved plans in-app
- [x] Reintroduce `Today` as a separate tab for day-of workout execution/logging
- [ ] Move goals editing from `Goals` tab into `Settings` (polish pass)
- [ ] Move model selector from `Settings` to `Chat` (polish pass)

## Model Policy (for this phase)

- Premium: `anthropic/claude-sonnet-4.6`
- Affordable: `z-ai/glm-5`

