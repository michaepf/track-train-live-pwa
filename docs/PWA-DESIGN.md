# Track-Train-Live PWA — Design Document

*Created: Feb 21, 2026*

---

## Overview

A Progressive Web App version of Track-Train-Live, designed for broader use beyond the current Michael + Blake setup. Users interact with a conversational AI personal trainer, log workouts, and review progress — all from a mobile browser. The app is local-first, with no backend, and costs are borne directly by the user via their own OpenRouter account.

---

## Core Architecture Decisions

### Auth & Billing — OpenRouter PKCE
Users authenticate via OpenRouter's OAuth PKCE flow. After auth, the app receives a user-scoped API token that charges directly to the user's OpenRouter balance. The app never handles money, stores passwords, or manages billing — the token is stored locally on-device in IndexedDB and never transmitted anywhere except OpenRouter API calls. Users need an existing OpenRouter account.

Reference: https://openrouter.ai/docs/guides/overview/auth/oauth

### Storage — IndexedDB, Local-First
All user data (goals, workout history, conversation threads) lives in IndexedDB on the user's device. No backend database. This is a deliberate privacy decision — conversations with a personal trainer contain sensitive health information that should not live in a third-party database.

Cross-device sync is deferred. Export/import can be added later.

### No Backend
The app is statically hosted (GitHub Pages, Netlify, or similar). No server-side logic, no database, no scheduled jobs. All intelligence is in the client + the AI model.

### Push Notifications
PWAs support push notifications, with a caveat: on iOS, the user must add the app to their home screen first. In-browser Safari does not receive push notifications. Android works without this constraint.

---

## Screens

| Screen | Description |
|--------|-------------|
| **Today** | Day-of execution UI for completing/logging the current session. |
| **Workouts** | Read/browse view of planned and saved workouts across dates. |
| **Chat** | Conversational interface with the AI trainer. Used for planning, goal review, and ad hoc questions. |
| **Goals** | User's current goals and profile, visible and editable (planned to move into Settings as polish). |
| **History** | Bulleted view of past workout JSON records. |
| **Settings** | Account/session controls, local data tools, and app configuration. |

### Navigation IA Update (Feb 22, 2026)

To reduce ambiguity between "plan browsing" and "workout execution":

- `Today` and `Workouts` are separate tabs with different intent.
- `Today` is the primary place to record sets, cardio difficulty, notes, and completion.
- `Workouts` is a read-only verification/browse surface for accepted plans and saved sessions.
- `Goals` content is expected to move into `Settings` in a polish pass.
- Model selector is expected to move from `Settings` onto `Chat` in a polish pass.

---

## Model Tiers

Users choose between two options at setup (changeable in settings):

| Tier | Example Model | Trade-off |
|------|--------------|-----------|
| **Premium** | Claude Sonnet | Better reasoning, higher cost per conversation |
| **Affordable** | GLM-4.7 / DeepSeek (latest) | Good quality, lower cost |

Both tiers must support tool use (function calling). Model choices are not hardcoded — the affordable tier should default to whatever capable, tool-use-supporting Chinese model is current on OpenRouter.

---

## Goals System

### Establishment (Onboarding)
Goals are established through a mandatory onboarding conversation on first launch. The user cannot access planning features until onboarding is complete. The conversation is freeform — the agent asks questions, the user answers, and when the agent has enough context it calls `propose_goals` (see Tool Use below). The user accepts or requests edits.

Goals are stored as **unstructured text** — a paragraph or short summary rather than structured fields. Flexible enough to capture unusual situations, simple enough to inject directly into the system prompt.

### Display & Editing
The Goals screen shows the current goals text with a timestamp indicating when it was last updated. The user can edit the text directly. Editing flags the goals as "pending review."

### Review Triggers
Two conditions trigger a goal review conversation before the next workout plan can be generated:

1. **User edited goals** — flagged at save time, checked lazily when user tries to start a planning conversation
2. **6 weeks since last update** — timestamp checked lazily at conversation start

Both triggers route the user into a goal review conversation. The review follows the same `propose_goals` pattern as onboarding. After acceptance, the timestamp resets.

---

## Tool Use Pattern

The agent uses goal/planning tools, plus management tools for explicit cleanup requests:

### `propose_goals`
Called when the agent is ready to propose goals text for user acceptance. Triggers a special UI card in the chat showing the proposed goals with **Accept** and **Edit** options. On acceptance, the goals text and timestamp are written to IndexedDB.

Used during: onboarding, goal review conversations.

### `propose_workout`
Called when the agent is ready to propose a workout plan. Triggers a workout card in the chat with **Accept** and **Edit** options. On acceptance, workouts are written to IndexedDB and become accessible in both `Workouts` and `Today`.

Used during: planning conversations.

### `delete_future_workouts`
Called when the user explicitly asks to clear/replace upcoming sessions. Deletes only uncompleted future workouts (range-controlled).

Used during: planning conversations.

### `delete_workout_history`
Called when the user explicitly asks to clear historical records for testing or reset scenarios. Deletes only historical workouts (range-controlled), with optional summary clearing.

Used during: planning conversations.

Tool definitions are passed as a separate `tools` parameter in each API call, not embedded in the system prompt. The system prompt may include guidance on *when* to call each tool.

---

## Context Management

### System Prompt Composition
Every API call includes the same three components:

1. **Profile & goals** — the current goals text (~200–500 tokens)
2. **Workout history** — recent sessions raw, older sessions summarized (see below)
3. **Agent instructions** — when to use tools, conversational tone, coaching principles

### Prompt Caching
OpenRouter supports prompt caching. The system prompt (static across a conversation) is cached after the first turn, reducing input token costs significantly for multi-turn conversations.

### Lazy Summarization
Workout history grows over time. Older weeks are summarized to keep context size bounded. Summarization is triggered lazily: when building the context for a new conversation, any week older than ~3 weeks that lacks a summary gets a summarization API call (cheap model, small context) before proceeding. The summary is stored in IndexedDB and used in all future conversations.

This keeps the system prompt lean without requiring background jobs or scheduled tasks.

### Conversation Threading
Each planning conversation is stored as a thread in IndexedDB (array of messages). When a conversation resumes or continues, the thread history is included in the API call. Conversations are not indefinitely long — a new thread starts for each distinct planning session.

---

## Planning Flow

Planning is conversational and flexible. Two natural patterns emerge from the same interface:

- **Weekly planning** — "Here's how last week went, what's the plan?" Agent reviews history, proposes a batch of workouts for the week via `propose_workout`.
- **Day-of** — "What should I do today?" Agent checks recent history, proposes a single workout.

Both use the same chat interface and the same tool. Users pay per token, so frequency is self-regulating — like deciding whether to call your trainer daily or weekly.

### Planning Window

The app always injects the next 7 days (D0–D6) into the system prompt so the model has concrete dates to plan against:

```
Today is Saturday, 2026-02-22 (D0). Planning window:
D0 = 2026-02-22 (Sat)
D1 = 2026-02-23 (Sun)
...
D6 = 2026-02-28 (Fri)
```

The model uses these exact date strings when proposing workouts. The app validates all proposed dates fall within the D0–D6 window before accepting.

### `propose_workout` returns an array

`propose_workout` always takes an array of workout objects — one item for day-of, multiple for weekly planning. Each item includes a date from the planning window.

### Multiple workouts per day

Multiple workouts can exist for the same day (e.g. morning strength + afternoon cardio, or a planned workout alongside an impromptu one). The Today screen handles this with a scrollable list or selector — UX to be determined.

Workouts are stored with an auto-increment integer ID, not keyed by date. Date is an indexed field for lookups.

### Always append

AI proposals always create new workout records. Existing workouts are never implicitly deleted or replaced. If the user has a planned AM/PM pair and asks the AI to replan one of them, the result is a third record — the user then deletes the unwanted old plan explicitly.

### Completion protection

A workout is **completed** if any set/cardio difficulty is recorded or the user explicitly marks it complete in `Today`. Completed workouts are immutable — they cannot be overwritten or deleted by planning tools.

### Explicit delete

Unstarted workouts can be removed either via explicit delete tools in planning chat or UI affordances (where present). Completed workouts are protected.

---

## Deferred / Open Questions

| Topic | Status |
|-------|--------|
| Cross-device sync | Deferred. Export/import as future feature. |
| Push notification UX | Architecture supports it; implementation deferred. |
| History visualizations | Bulleted JSON view for v1; charts/graphs deferred. |
| Onboarding conversation script | Not scripted — agent drives it freeform with `propose_goals` as the exit condition. |
| Specific model identifiers | Not hardcoded. Premium = Sonnet-class, Affordable = capable tool-use Chinese model current on OpenRouter. |
| Today screen multi-workout UX | Long scroll vs. selector — deferred to Phase 4. |

---

*This document reflects design decisions made Feb 21, 2026. Updated Feb 22, 2026 to align IA/tooling with current implementation.*
