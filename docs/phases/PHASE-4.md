# Phase 4 - Workout Tracking UI

Status: IN PROGRESS (execution baseline implemented)

## Goal

Port the existing workout execution experience to React + IndexedDB.

## 4a0 - Read-only Workouts Verification View (COMPLETE)

- [x] Added `Workouts` tab list view for persisted workouts
- [x] Group by date with card rows for each saved session
- [x] Added basic exercise/cardio detail rendering
- [x] Added refresh action and empty/error states
- [x] Sort order set to chronological ascending

## 4a - Workout Screen (`src/screens/Workout.tsx`)

- [x] Reintroduce dedicated `Today` tab (separate from `Workouts` list tab)
- [x] Load today's workouts via `getWorkoutsByDate(today)`
- [x] No-workout empty state with navigation hint
- [x] Multi-session same-day UX (selector/list)
- [x] Save workflow via `saveWorkout(workout)` (autosave interaction model)
- [ ] Delete button for unstarted workouts only (`deleteWorkout(id)`)
- [x] Add explicit "Complete workout" action

## 4b - Port Existing Interaction Logic

- [x] Exercise cards and set rows
- [x] FAIL/DONE/EASY buttons with toggle-off behavior
- [x] Cardio options and `pick_one` / `pick_many` behavior
- [ ] Warmup/cooldown checklist interactions
- [x] Notes text areas (per-exercise + per-workout, autosave)
- [ ] AI tips tooltip behavior
- [x] Save state indicator transitions (saving/saved/error)

## 4c - Componentization

- [ ] `ExerciseCard.tsx`
- [ ] `SetRow.tsx`
- [ ] `CardioCard.tsx`
- [ ] `CheckList.tsx`

## 4d - Styling Port

- [ ] Port/align styles from original `public/style.css`
- [ ] Verify button variants, card states, tooltip, notes, save bar
- [ ] Validate responsive behavior on mobile viewport

## Acceptance Criteria

- User can load, complete, and save a planned workout
- Data persists on refresh
- Multiple same-day workouts are accessible and distinguishable
- `Today` and `Workouts` are separate tabs with clear roles:
  - `Today` = execute/log today's session
  - `Workouts` = browse planned/saved sessions

## Remaining Gaps (Current)

- Warmup/cooldown checklist completion interactions
- Delete affordance for unstarted workouts from `Today`
- Optional AI tips/tooltip parity with original app

