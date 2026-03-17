# Proposal: Rest Timer

## Problem

When using the Today screen during a workout, there's no built-in rest timer between sets. Users have to use their phone's clock app or guess. Timed rest periods are fundamental to structured training — too short and you can't recover, too long and you lose the training stimulus. Every serious workout app has this.

## Proposed Solution

Add an inline rest timer that appears on the Today screen after a set is logged (difficulty button tapped).

### Behavior

1. User taps a difficulty button (Fail / Done / Easy) on a set
2. A countdown timer appears between the completed set and the next open set
3. Timer counts down from a default rest period (configurable per exercise type)
4. When it reaches zero: a brief vibration (if supported) and visual pulse
5. User can dismiss the timer early, adjust the time, or let it expire naturally
6. Timer is non-blocking — the user can scroll, view other exercises, or add notes while it runs

### Default Rest Periods

- Compound strength (squat, bench, deadlift): 3:00
- Isolation / accessories: 1:30
- Supersets: 0:45
- User can override per exercise or globally in Settings

### UI

- Compact bar between sets showing `MM:SS` countdown with a progress ring
- Tap to pause/resume, long-press or swipe to dismiss
- Optional: small persistent indicator in the header if the user scrolls away from the timer's position

## Technical Approach

- Timer state managed in Today.tsx (or a `useRestTimer` hook): `{ active: boolean, remainingMs: number, exerciseId: string }`
- `setInterval` with 1-second ticks, using `Date.now()` delta for accuracy (not cumulative ticks)
- Vibration API: `navigator.vibrate(200)` on completion (progressive web app, supported on Android; no-ops gracefully on iOS)
- Rest duration defaults stored in a `restDefaults` map keyed by exercise tag (compound vs isolation), overrideable per exercise in Settings or via a quick-adjust on the timer itself
- No new IndexedDB stores needed — rest preferences can go in the existing `settings` store

## Scope

- Phase 1: Basic countdown timer with fixed defaults (3:00 compound, 1:30 isolation), auto-triggered after logging a set
- Phase 2: Per-exercise customization, Settings UI for defaults
- Phase 3: Rest period tracking in workout history (actual rest taken vs planned), AI uses rest data for planning feedback

## What This Does NOT Include

- Audio alerts (unreliable in PWAs, especially on iOS)
- Rest timer for cardio intervals (separate feature)
- Automatic set progression (auto-advancing to next set when timer expires)
