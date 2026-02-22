# Track-Train-Live PWA - Plan Index

Last updated: 2026-02-22

This file is intentionally short for low-context agent kickoffs.

## Current Status

- Phase 1 (Foundation): DONE
- Phase 2 (Goals and Onboarding): DONE
- Phase 3 (Chat and Tool Reliability): IN PROGRESS
- Phase 4 (Workout Tracking): IN PROGRESS (Today execution baseline + Workouts list complete)
- Phase 5 (History and Summaries): NOT STARTED
- Phase 6 (PWA Polish and UX Refinements): IN PROGRESS (6e Settings/Data management complete)

## Read Order for New Sessions

1. `docs/IMPLEMENTATION-PLAN.md`
2. `docs/phases/PHASE-3.md` (or active phase)
3. `docs/HANDOFF.md`
4. `docs/PWA-DESIGN.md` (only if architecture decisions are needed)

## Phase Trackers

- `docs/phases/PHASE-1.md`
- `docs/phases/PHASE-2.md`
- `docs/phases/PHASE-3.md`
- `docs/phases/PHASE-4.md`
- `docs/phases/PHASE-5.md`
- `docs/phases/PHASE-6.md`

## Working Rules

- Keep each session scoped to one phase and one concrete objective.
- Update only:
  - active phase tracker
  - `docs/HANDOFF.md`
- Keep debug notes and temporary diagnostics out of this index file.

---

## What We're Building

See [PWA-DESIGN.md](./PWA-DESIGN.md) for architecture decisions. This document covers implementation phases, task breakdown, and notes on what to port from the original app.

---

## Stack Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript (strict) | Tool payloads and IndexedDB schemas benefit heavily from typed boundaries |
| Validation | Zod | Runtime validation of AI tool responses before persisting; also generates TS types |
| Build | Vite + `@vitejs/plugin-react` | Fast dev server, trivial static build |
| Styling | Plain CSS (global) | Majority ported from original; no framework needed at this scale |
| Testing | Vitest | Same config as Vite, minimal setup; unit tests for DB layer and validators |

---

## Stealing from the Original

The original app (`track-train-live`) has a working workout UI in `public/index.html` and `public/style.css`. Most of it is directly reusable — just translated from plain JS DOM mutation into React components and IndexedDB instead of server API calls.

### Worth porting directly
- **Exercise card rendering** — FAIL/DONE/EASY buttons, set rows, timed set format, toggle-off behavior
- **Cardio card rendering** — pick_one/pick_many mode, difficulty buttons, selected state
- **Warmup/cooldown checklist** — checkbox rows with strike-through on completion
- **AI tips tooltip** — the `i` button + expandable tooltip pattern
- **Notes toggle** — collapsed by default, expand on tap, textarea
- **Difficulty button CSS** — color variants (red/green/blue), active states, tap feedback
- **Save button states** — saving / saved / error / offline feedback pattern
- **The full CSS color palette and card styles** — almost all of `style.css` translates 1:1

### What changes
- Server `fetch()` calls → IndexedDB reads
- `save()` POST to server → IndexedDB write
- Global `workoutData` mutation + `render()` → React state (`useState`)
- Inline `onclick` handlers → React event handlers
- Plain JS → TypeScript; all data shapes get Zod schemas and inferred types

---

## Test Strategy

Tests live in `src/**/*.test.ts`. Run with `npx vitest`.

| What | Where | Priority |
|------|-------|----------|
| DB CRUD round-trips | `db.test.ts` | Phase 1 |
| Schema validation (valid + invalid payloads) | `schemas.test.ts` | Phase 1 |
| Auth callback happy path + error cases | `auth.test.ts` | Phase 1 |
| `buildHistoryContext` output shape | `context.test.ts` | Phase 3 |
| `needsGoalReview` trigger logic | `context.test.ts` | Phase 2 |
| Date/timezone helper | `db.test.ts` | Phase 1 |

No E2E tests in v1. Add Playwright if the manual testing loop becomes painful.

---

## Deferred

Per design doc — not in scope for v1:

- Cross-device sync / cloud backup
- Push notifications
- History charts and visualizations
- Exercise catalog browsing

---

## File Structure (target end state)

```
src/
  main.tsx
  index.css
  App.tsx
  lib/
    schemas.ts     — Zod schemas + inferred types (all data shapes)
    db.ts          — IndexedDB wrapper
    db.test.ts
    auth.ts        — OpenRouter PKCE
    auth.test.ts
    api.ts         — OpenRouter streaming client
    context.ts     — system prompt + history assembly
    context.test.ts
    schemas.test.ts
  screens/
    Today.tsx
    Goals.tsx
    Chat.tsx
    Workout.tsx
    History.tsx
    Settings.tsx
  components/
    UserMessage.tsx
    AssistantMessage.tsx
    ToolCard.tsx
    ExerciseCard.tsx
    CardioCard.tsx
    SetRow.tsx
    CheckList.tsx
public/
  manifest.json
  icon-192.png
  icon-512.png
docs/
  PWA-DESIGN.md
  IMPLEMENTATION-PLAN.md
```
