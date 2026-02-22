# Phase 2 - Goals and Onboarding

Status: DONE (with active reliability tuning carried into Phase 3)

## Goal

Goals can be established through onboarding conversation, edited manually, reviewed periodically, and persisted.

## 2a - OpenRouter API Client (`src/lib/api.ts`)

- [x] `streamChat(...)` client abstraction
- [x] `MODELS` defaults and settings integration
- [x] 401 handling integration (`handle401`)
- [x] Prompt caching header usage
- [x] Error extraction for API/network failures
- [x] Debug non-stream mode switch added for tool-call diagnostics

## 2b - Context Builder (`src/lib/context.ts`)

- [x] `buildSystemPrompt(goals, mode, historyContext)`
- [x] `buildHistoryContext(workouts, summaries)`
- [x] `getWeekKey(date)`
- [x] `getPlanningWindow()`
- [x] `needsGoalReview(goals)`

## 2c - Goals Screen (`src/screens/Goals.tsx`)

- [x] Load current goals
- [x] Show goals text + last-updated date
- [x] Edit and save path
- [x] Save marks `pendingReview`
- [x] "Due for review" indicator

## 2d - Onboarding and Goal Review Flow (`src/screens/Chat.tsx`)

- [x] First-launch mode detection (`onboarding` when goals absent)
- [x] Goal review mode detection (`pendingReview` or stale goals)
- [x] Auto-start assistant turn for onboarding/goal-review
- [x] Conversation persistence across turns

## 2e - `propose_goals` Tool Handling

- [x] Tool definition passed to model calls
- [x] Parse + validate tool call payload
- [x] Render proposal card with Accept / Request changes
- [x] On Accept: save goals and clear pending review
- [x] On Request changes: continue conversation
- [x] Error card path for malformed payloads

## Tests

- [x] `api.test.ts`
- [x] `context.test.ts`
- [x] Existing auth/schemas/db tests still passing

## Acceptance Criteria Met

- [x] Onboarding works end-to-end
- [x] Goals persist and display correctly
- [x] Goal review trigger logic exists

## Notes

- Model/provider selection strongly impacts tool-call reliability.
- Remaining chat/tool robustness work moved to Phase 3 tracker.

