# Phase 4 - Workout Tracking UI

Status: NOT STARTED

## Goal

Port the existing workout execution experience to React + IndexedDB.

## 4a - Workout Screen (`src/screens/Workout.tsx`)

- [ ] Load today's workouts via `getWorkoutsByDate(today)`
- [ ] No-workout empty state with navigation hint
- [ ] Multi-session same-day UX (selector/list)
- [ ] Save workflow via `saveWorkout(workout)`
- [ ] Delete button for unstarted workouts only (`deleteWorkout(id)`)

## 4b - Port Existing Interaction Logic

- [ ] Exercise cards and set rows
- [ ] FAIL/DONE/EASY buttons with toggle-off behavior
- [ ] Cardio options and `pick_one` / `pick_many` behavior
- [ ] Warmup/cooldown checklist interactions
- [ ] Notes toggles and text areas
- [ ] AI tips tooltip behavior
- [ ] Save button state transitions (saving/saved/error)

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

