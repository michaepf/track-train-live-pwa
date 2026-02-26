# Handoff

Last updated: 2026-02-25

## Current Status

- Phase 1: DONE
- Phase 2: DONE
- Phase 3: IN PROGRESS (tool flow working, debug cleanup remains)
- Phase 4: DONE (all 4a/4b gaps closed; 4c componentization and AI tips deferred)
- Phase 5: IN PROGRESS (5a, 5b done; 5c tooling built, manual validation remains)
- Phase 6: IN PROGRESS (6e Settings/Data management complete)

## Current Defaults

- API mode: non-stream debug enabled (`DEBUG_NON_STREAM = true` in `src/lib/api.ts`)

## Known Working

- OpenRouter auth + `propose_workout` end-to-end (accept saves to IndexedDB, visible in Workouts tab)
- Planning agent can delete future workouts via tools; history deletion is user-only via Settings
- Conversational questions in planning mode answered without forcing a tool call
- Exercise catalog enforced: unknown exerciseId values rejected at accept time with auto-retry
- **Today tab**: date navigation (‹ [date] › tight together, "Today" pill at right edge); delete for unstarted workouts; warmup/cooldown checklists with autosave; exercise names tap to show info tooltip
- **Workouts tab**: planned workouts only (completed moved to Log); expand/collapse per card + "Expand all"; full set detail (name, reps, weight chips, aiNotes); delete for unstarted in expanded view; exercise names tap to show info tooltip
- **Log tab**: completed workouts only, date-grouped, exercise list per session
- **Chat tab**: proposed plan card rows expand/collapse to show full exercise + set detail; exercise names tap to show info tooltip
- **Multi-set planning**: tool schema and planning prompt updated to instruct 3 sets per exercise with `plannedWeight` required (uses history or conservative estimate; omit for bodyweight/timed only)
- **ExerciseTip component**: tap exercise name (ⓘ) anywhere to see description + tags inline; falls back gracefully for unknown IDs
- **FUTURE-FEATURES.md**: documents open design questions (weight tiers, editing completed workouts, onboarding baseline, Phase 5b/5c/cleanup)

## Known Issues / Watch Items

- Provider responses can still vary widely; keep schema normalization + bounded retries
- Some debug logs remain in `api.ts` during non-stream mode diagnostics
- Stream mode was unstable during testing; keep non-stream until fixed
- GLM-5 via Fireworks (OpenRouter) validated historical tool call arguments strictly — corrupted history from old debug sessions can cause 400s; use "New" conversation to clear, or clear data in Settings
- AI weight estimates are still guesses on cold start — no history yet means the model is estimating; calibrates after first completed sessions

## Most Recent Fixes (this session)

- `src/lib/dev-fixtures.ts`: new file — 3 fixture history scenarios (All Progressing, Mixed, Stuck), each with 6 sessions across 5 weeks; same exercises/weights, only difficulty differs so AI recommendations are directly comparable
- `Settings.tsx`: added "Inspect system prompt" button (builds + displays full planning prompt with char count in collapsible `<pre>`); added "Load scenario" buttons for each fixture (confirm step → clears workouts → seeds fixtures → auto-runs summary pass)
- `index.css`: styles for `.dev-prompt-details`, `.dev-prompt-summary`, `.dev-prompt-preview`

## Previous Session Fixes

- `context.ts`: added `generateWeeklySummary(weekKey, workouts)` — pure function, formats a week's workout data into compact text for older-week context injection
- `Settings.tsx`: added "Developer" section with "Run summary pass" button — groups workouts older than 3 weeks by ISO week, calls `generateWeeklySummary`, saves results via `saveSummary`
- `context.test.ts`: fixed pre-existing `buildHistoryContext` test (`'bench-press'` → `'Bench Press'` to match `getExerciseName` output); added 6 tests for `generateWeeklySummary`

## Previous Session Fixes

- `Workout.tsx`: filter to non-completed only; updated empty state message
- `ToolCard.tsx` (`ProposeWorkoutCard`): per-workout expand/collapse with ▼/▲ chevron; shows full exercise+set detail when expanded; uses `ExerciseTip`
- `ExerciseTip.tsx`: new component — tappable exercise name with inline info panel (description + tags)
- `Today.tsx`, `Workout.tsx`, `ToolCard.tsx`: all use `ExerciseTip` in place of plain `getExerciseName`
- `index.css`: date nav layout fix (‹ date › grouped, "Today" pill at right via `margin-left: auto`); ExerciseTip styles; tool card workout expand styles
- `context.ts`: planning prompt now requires `plannedWeight` in lb for all weighted exercises; omit only for bodyweight/timed
- `docs/FUTURE-FEATURES.md`: created; documents weight tier idea, editing completed workouts, onboarding baseline, Phase 5b/5c/cleanup

## Next 3 Tasks

1. **Phase 5c manual validation** — load each scenario, tap "Inspect system prompt", verify structure and char count; open Chat and compare workout proposals across scenarios
2. **Phase 3 cleanup** — remove `console.log` noise from `api.ts`, decide streaming vs non-stream permanently
3. **Phase 5b follow-up** — consider running summary pass automatically (e.g. on app load or after workout completion) rather than requiring manual trigger

## Phase 5c Design (agreed, not yet built)

Goal: validate that the planning agent uses history context meaningfully and that prompt size stays bounded.

**Two-part approach:**

Part 1 — Context correctness (no API needed):
- Add "Inspect system prompt" button in Settings dev section
- Fetches current goals + workouts + summaries, builds the full system prompt, displays it in a scrollable `<pre>` block with character count
- Lets you verify: older weeks appear as compact summaries, recent weeks have full detail, total size is reasonable

Part 2 — Agent behavior (requires API):
- Create `src/lib/dev-fixtures.ts` with 3 fixture history sets (relative-dated so they always work):
  - **All progressing**: all sets `too_easy`, notes like "felt very light, ready to add weight"
  - **Mixed**: some `too_easy`, some `completed`, one or two `could_not_complete`
  - **Stuck**: mostly `could_not_complete` / hard `completed`, notes about struggling
- Add "Load scenario" buttons in Settings dev section (with confirm, since it wipes workout history first, then seeds fixture data and auto-runs summary pass for older weeks)
- User loads scenario → opens Chat → asks for a workout → compares agent recommendations across scenarios

## Files To Read First In New Session

1. `docs/IMPLEMENTATION-PLAN.md`
2. `docs/phases/PHASE-5.md`
3. `docs/HANDOFF.md`

## Kickoff Prompt (copy/paste)

Please continue Phase 5c in `track-train-live-pwa`.

Read first:
1) `docs/IMPLEMENTATION-PLAN.md`
2) `docs/phases/PHASE-5.md`
3) `docs/HANDOFF.md`

Current state:
- Phases 1, 2, and 4 are done.
- Phase 3 tool flow is working; some debug cleanup remains (`DEBUG_NON_STREAM = true` in `api.ts`).
- Phase 5a (History screen) and 5b (lazy summarization) are done.
  - `generateWeeklySummary(weekKey, workouts)` is in `context.ts`
  - Settings has a "Developer > Run summary pass" button
  - Chat.tsx loads summaries for older weeks and passes them to `buildHistoryContext`
- Settings data management is complete (Phase 6e done).

Task focus for this session — Phase 5c:
1) Add "Inspect system prompt" button to Settings dev section (shows full prompt text + char count — no API call needed).
2) Create `src/lib/dev-fixtures.ts` with 3 fixture history scenarios (all-progressing, mixed, stuck). Use real exerciseIds from `src/data/exercises.ts`. Dates must be relative (e.g. today - N days) so fixtures always load into the correct recency buckets.
3) Add "Load scenario" buttons to Settings dev section — confirm step, then: clear workout history, seed fixture data, auto-run summary pass for older weeks.

Check `src/data/exercises.ts` for valid exerciseIds before writing fixtures.

Constraints:
- Do not refactor unrelated files.
- Keep non-stream mode enabled (`DEBUG_NON_STREAM = true`).
- Preserve existing model defaults:
  - premium: `anthropic/claude-sonnet-4.6`
  - affordable: `z-ai/glm-5`

Done criteria:
- Manual summary trigger runs and saves a weekly summary to IndexedDB.
- Older-week workouts use summary text (not full detail) in planning context.
- Planning prompt size stays bounded as history grows.
