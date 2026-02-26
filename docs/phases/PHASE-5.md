# Phase 5 - History and Summaries

Status: IN PROGRESS (5a History screen shipped)

## Goal

Expose workout history clearly and keep planning context bounded via summaries.

## 5a - History Screen (`src/screens/History.tsx`)

- [x] Load recent workouts via `listWorkouts(60)` (or configured window)
- [x] Group by date with nested session cards
- [x] Session card shows workout type + outcome summary
- [x] Delete affordance only for unstarted workouts
- [x] Empty state UX

## 5b - Lazy Summarization Validation

- [x] Verify week grouping via `getWeekKey`
- [x] Verify `getSummary`/`saveSummary` end-to-end
- [x] Confirm older periods use summary text in planning context
- [x] Add temporary dev trigger to run summary pass manually
  - `generateWeeklySummary(weekKey, workouts)` added to `context.ts`
  - "Developer > Run summary pass" button in Settings groups older workouts by week, generates summaries, saves to IndexedDB
  - 6 new tests in `context.test.ts` covering `generateWeeklySummary`

## 5c - Context Size Management

- [x] Add "Inspect system prompt" button to Settings dev section
- [x] Create `src/lib/dev-fixtures.ts` with 3 fixture history scenarios
- [x] Add "Load scenario" buttons to Settings dev section
- [ ] Manually validate: older weeks appear as summaries, recent weeks as full detail
- [ ] Manually validate: prompt character count stays reasonable across all scenarios

### Test Plan

**Goal:** Confirm that as workout history grows, the planning prompt stays bounded and the agent uses the history signal correctly.

#### Part 1 — Context correctness (no API needed)

Add an "Inspect system prompt" button to the Settings Developer section. When tapped it:
1. Fetches current goals, all workouts, and all saved summaries from IndexedDB
2. Builds the complete system prompt (same path as Chat.tsx uses)
3. Displays the full text in a scrollable `<pre>` block
4. Shows character count

**What to look for:**
- Workouts from the last 3 weeks appear with full set-level detail
- Workouts older than 3 weeks appear as compact week summaries (not full detail)
- Total prompt length stays under ~6000 chars with a realistic history

#### Part 2 — Agent behavior (requires API)

Create `src/lib/dev-fixtures.ts` with 3 fixture history sets. Each has 5 sessions spread across 5 weeks (3 recent / 2 older) so both code paths are exercised. Dates must be relative (`today - N days`) so fixtures always load into the correct recency buckets. Use real `exerciseId` values from `src/data/exercises.ts`.

**Scenario A — All progressing:**
All sets marked `too_easy`. User feedback notes like "felt very light, ready to add weight." The agent should recommend meaningfully higher weights.

**Scenario B — Mixed:**
Some exercises `too_easy`, some `completed`, one or two `could_not_complete`. The agent should adjust per-exercise — increase where easy, hold or reduce where struggling.

**Scenario C — Stuck / struggling:**
Most sets `could_not_complete` or hard `completed`. Notes about difficulty. The agent should recommend lower weights or a deload approach.

Add "Load scenario" buttons to the Settings Developer section. Each button:
1. Confirms (destructive — wipes workout history)
2. Seeds the chosen scenario's workouts into IndexedDB
3. Auto-runs the summary pass so older weeks are already summarized
4. Shows status on completion

**Manual test flow:**
1. Load a scenario
2. Use "Inspect system prompt" to verify the context looks right (older weeks summarized, recent full detail, char count reasonable)
3. Open Chat → start a new planning conversation → ask for a workout
4. Observe the proposed weights and note whether they reflect the history signal
5. Repeat for each scenario and compare outputs

#### Acceptance criteria

- "Inspect system prompt" shows correct structure (recent full detail, older summaries)
- Prompt char count stays under ~6000 characters with 5 weeks of history
- Scenario A proposals use higher weights than Scenario C for the same exercises
- Scenario B proposals show differential treatment across exercises

## Acceptance Criteria

- User can review prior sessions reliably
- Older periods are summarized and reflected in planning context
- Planning prompt stays bounded as history grows

