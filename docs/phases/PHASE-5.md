# Phase 5 - History and Summaries

Status: NOT STARTED

## Goal

Expose workout history clearly and keep planning context bounded via summaries.

## 5a - History Screen (`src/screens/History.tsx`)

- [ ] Load recent workouts via `listWorkouts(60)` (or configured window)
- [ ] Group by date with nested session cards
- [ ] Session card shows workout type + outcome summary
- [ ] Delete affordance only for unstarted workouts
- [ ] Empty state UX

## 5b - Lazy Summarization Validation

- [ ] Verify week grouping via `getWeekKey`
- [ ] Verify `getSummary`/`saveSummary` end-to-end
- [ ] Confirm older periods use summary text in planning context
- [ ] Add temporary dev trigger to run summary pass manually

## 5c - Context Size Management

- [ ] Validate "recent full detail, older summaries" behavior under realistic data volume
- [ ] Confirm planning prompt remains bounded as history grows

## Acceptance Criteria

- User can review prior sessions reliably
- Older periods are summarized and reflected in planning context

