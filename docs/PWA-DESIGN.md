# Track-Train-Live PWA — Design Document

*Created: Feb 21, 2026*

---

## Overview

A Progressive Web App version of Track-Train-Live, designed for broader use beyond the current Michael + Blake setup. Users interact with a conversational AI personal trainer, log workouts, and review progress — all from a mobile browser. The app is local-first, with no backend, and costs are borne directly by the user via their own OpenRouter account.

---

## Core Architecture Decisions

### Auth & Billing — OpenRouter PKCE
Users authenticate via OpenRouter's OAuth PKCE flow. After auth, the app holds a user-controlled API key that charges directly to the user's OpenRouter balance. The app never handles money, stores API keys, or manages billing. Users need an existing OpenRouter account.

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
| **Goals** | User's current goals and profile, visible and editable. The persistent context for all AI conversations. |
| **Chat** | Conversational interface with the AI trainer. Used for planning, goal review, and ad hoc questions. |
| **Today's Workout** | The existing workout tracking UI, carried over from the current app. |
| **History** | Bulleted view of past workout JSON records. |

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

The agent has two tools available during planning and goal conversations:

### `propose_goals`
Called when the agent is ready to propose goals text for user acceptance. Triggers a special UI card in the chat showing the proposed goals with **Accept** and **Edit** options. On acceptance, the goals text and timestamp are written to IndexedDB.

Used during: onboarding, goal review conversations.

### `propose_workout`
Called when the agent is ready to propose a workout plan. Triggers a workout card in the chat with **Accept** and **Edit** options. On acceptance, the workout is written to IndexedDB and becomes accessible in Today's Workout.

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

- **Weekly planning** — "Here's how last week went, what's the plan?" Agent reviews history, proposes a week of workouts via `propose_workout`.
- **Day-of** — "What should I do today?" Agent checks recent history, proposes a single workout.

Both use the same chat interface and the same tool. Users pay per token, so frequency is self-regulating — like deciding whether to call your trainer daily or weekly.

---

## Deferred / Open Questions

| Topic | Status |
|-------|--------|
| Cross-device sync | Deferred. Export/import as future feature. |
| Push notification UX | Architecture supports it; implementation deferred. |
| History visualizations | Bulleted JSON view for v1; charts/graphs deferred. |
| Onboarding conversation script | Not scripted — agent drives it freeform with `propose_goals` as the exit condition. |
| Specific model identifiers | Not hardcoded. Premium = Sonnet-class, Affordable = capable tool-use Chinese model current on OpenRouter. |

---

*This document reflects design decisions made Feb 21, 2026. Implementation has not begun.*
