# Handoff

Last updated: 2026-02-22

## Current Status

- Phase 1: DONE
- Phase 2: DONE
- Phase 3: IN PROGRESS (tool flow implemented, polish ongoing)
- Phase 4: IN PROGRESS (Today execution baseline + Workouts list shipped; 4a/4b gaps remain)
- Phase 5: NOT STARTED
- Phase 6: IN PROGRESS (6e Settings/Data management complete)

## Current Defaults

- API mode: non-stream debug enabled (`DEBUG_NON_STREAM = true` in `src/lib/api.ts`)

## Known Working

- OpenRouter auth + `propose_workout` end-to-end (accept saves to IndexedDB, visible in Workouts tab)
- Planning agent can delete future workouts via tools; history deletion is user-only via Settings
- Conversational questions in planning mode answered without forcing a tool call
- Exercise catalog enforced: unknown exerciseId values rejected at accept time with auto-retry

## Known Issues / Watch Items

- Provider responses can still vary widely; keep schema normalization + bounded retries
- Some debug logs remain in `api.ts` during non-stream mode diagnostics
- Stream mode was unstable during testing; keep non-stream until fixed
- GLM-5 via Fireworks (OpenRouter) validated historical tool call arguments strictly — corrupted history from old debug sessions can cause 400s; use "New" conversation to clear, or clear data in Settings

## Most Recent Fixes (this session)

- `src/data/exercises.ts`: added exercise catalog (30 exercises, ported from original app); exports `EXERCISE_MAP`, `getExerciseName()`, `buildCatalogPromptSection()`
- `context.ts`: planning system prompt now injects full exercise catalog; `formatWorkout()` uses display names instead of raw IDs
- `Chat.tsx`: `validateExerciseIds()` runs at accept time; unknown IDs trigger error + auto-retry; tool description + schema hint updated
- `Today.tsx`: exercise display uses catalog name lookup (`getExerciseName`) instead of slug humanization
- `Chat.tsx`: planning mode `toolChoice` changed from forced `propose_workout` to `'auto'`; model can now answer conversational questions without proposing a workout
- `context.ts`: planning role/tool instructions updated — "answer questions conversationally; use propose_workout only when scheduling workouts"
- `Chat.tsx`: removed "no tool call returned" error block that fired on every non-tool planning response
- `conversation.ts`: added `hidden?: boolean` to `MessageSchema`; retry instructions are marked hidden and skipped in `MessageBubble`
- `api.ts`: defensive JSON validation on historical tool call arguments — malformed arguments replaced with `'{}'` instead of causing provider 400

## Next 3 Tasks

1. **Finish Phase 4 gaps** — delete affordance for unstarted workouts in `Today` + warmup/cooldown checklist interactions (both are gym-blocking UX gaps)
2. **Phase 5 start** — History screen (`History.tsx`) + seeded summarization validation; confirm older-week summaries feed into planning context correctly
3. **Phase 3 cleanup** — remove `console.log` noise from `api.ts`, decide streaming vs non-stream permanently, wire lazy summarization execution path

## Files To Read First In New Session

1. `docs/IMPLEMENTATION-PLAN.md`
2. `docs/phases/PHASE-4.md`
3. `docs/HANDOFF.md`

## Kickoff Prompt (copy/paste)

Please continue Phase 4 in `track-train-live-pwa`.

Read first:
1) `docs/IMPLEMENTATION-PLAN.md`
2) `docs/phases/PHASE-4.md`
3) `docs/HANDOFF.md`

Current state:
- Phases 1 and 2 are done.
- Phase 3 tool flow is working; some debug cleanup remains.
- `DEBUG_NON_STREAM = true` is intentionally enabled in `src/lib/api.ts`.
- `propose_workout` is implemented; accepted workouts save and appear in `Workouts`.
- `Today` execution UI is live and writes progress back to IndexedDB.
- Settings data management is complete (Phase 6e done).
- Exercise catalog (`src/data/exercises.ts`) is enforced at accept time; planning prompt includes catalog.
- Planning mode uses `toolChoice: 'auto'`; conversational questions work without forcing a tool call.

Task focus for this session:
1) Add delete affordance for unstarted workouts in `Today` (`deleteWorkout(id)` already exists in db.ts).
2) Implement warmup/cooldown checklist interactions (checkbox toggle + strike-through, autosave).
3) Begin Phase 5: History screen + manual summarization trigger for validation.

Constraints:
- Do not refactor unrelated files.
- Keep non-stream mode enabled for now.
- Preserve existing model defaults:
  - premium: `anthropic/claude-sonnet-4.6`
  - affordable: `z-ai/glm-5`

Done criteria:
- User can delete an unstarted workout from the Today tab.
- Warmup/cooldown items can be checked off and persist on reload.
- History screen shows past sessions grouped by date.
