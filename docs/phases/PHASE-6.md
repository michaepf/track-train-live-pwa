# Phase 6 - PWA Polish and UX Refinements

Status: IN PROGRESS (6e complete, remainder not started)

## Goal

Finalize installability, offline behavior, and UX polish decisions.

## 6a - PWA Manifest and Installability

- [ ] Confirm manifest completeness (name/short name/description/icons/theme)
- [ ] Validate iOS and Android install flows
- [ ] Validate standalone display behavior

## 6b - Service Worker and Caching

- [ ] Finalize `vite-plugin-pwa` setup
- [ ] Precache app shell assets
- [ ] Keep API calls network-first
- [ ] Add update-available prompt flow

## 6c - Mobile UX Polish

- [ ] Safe area insets and tab/input overlap checks
- [ ] Overscroll behavior review
- [ ] Keyboard + input ergonomics on Chat screen

## 6d - Product UX Refinements (from current notes)

- [ ] Add dedicated OpenRouter management screen when disconnected
- [ ] Move model selector to Chat header toggle (top-right)
- [ ] Restrict model options to:
  - Sonnet 4.6 (smarter, more expensive)
  - GLM-5 (still smart, less expensive)
- [ ] Add tooltip/help text for model cost/smartness trade-off
- [ ] Rework onboarding to structured intake form + AI refinement

## 6e - Settings / Data Management (COMPLETE)

- [x] Replaced ambiguous maintenance buttons with 5 clearly named actions:
  - Disconnect OpenRouter
  - Delete all goals info
  - Delete workout history (completed workouts + summaries)
  - Delete planned workouts (not yet completed)
  - Delete everything (goals, workouts, chat, summaries — not settings/API key)
- [x] Added `clearGoals`, `clearCompletedWorkouts`, `clearPlannedWorkouts` to `db.ts`
- [x] Fixed `clearAllData` to preserve `settings` store (keeps OpenRouter token)
- [x] Inline two-step confirmation (arm → Cancel / Confirm) replacing `window.confirm()`
- [x] Two-column layout: button at ~45% width, description to the right
- [x] Internal `scope` field (`user` | `both`) on each action for future agent restriction logic

## 6f - Data Export and Recovery

- [ ] Export all local stores to JSON
- [ ] Validate clean import/recovery path (if in scope)

## Acceptance Criteria

- App installs cleanly and behaves predictably on mobile
- Core UX decisions above are implemented and tested

