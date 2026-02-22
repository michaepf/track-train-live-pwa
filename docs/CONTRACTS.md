## Contracts and Invariants

These are defined up front because multiple phases depend on them.

### Date / Timezone

- All workout dates are stored as `YYYY-MM-DD` strings in the **user's local device timezone**
- "Today" (D0) is always computed from `new Date()` using `toLocaleDateString('en-CA', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })`
- The app injects a concrete 7-day planning window (D0–D6) into every system prompt, with actual date strings and weekday names. The model picks dates from this window when proposing workouts.
- Proposed dates are validated to fall within D0–D6 before accepting. Dates outside the window are rejected with an in-chat error.
- "This Monday" vs "next Monday" ambiguity is avoided entirely — the model always works from the explicit date strings the app provides, not day names.

### Auth / Token Storage

- The OpenRouter API key is stored in IndexedDB under `settings['apiKey']`
- Security model: IndexedDB is JS-accessible, same as everything else in the browser. The threat is XSS. Mitigations: React never uses `dangerouslySetInnerHTML` on AI content; no `eval`; Content-Security-Policy header on hosting
- Token lifetime: OpenRouter PKCE tokens do not expire automatically, but the key may be revoked by the user on OpenRouter's dashboard. Treat a 401 as "session invalid"
- On 401 mid-stream: cancel the stream, clear the stored key, redirect to login
- On logout: wipe `settings['apiKey']` from IndexedDB before redirecting
- PKCE callback errors (state mismatch, code exchange failure): show error, do not store partial state, redirect to login

### Tool Payload Validation

AI tool responses are validated with Zod before any persistence call. Malformed tool calls are surfaced as an in-chat error; the conversation continues. Rules:
- `propose_goals`: text must be a non-empty string, max 2000 characters
- `propose_workout`: validated against `WorkoutSchema` (see Phase 1 — Zod Schemas)
- On validation failure: do not call `saveGoals`/`saveWorkout`; render an error card in chat; let the user ask the agent to try again

### IndexedDB Versioning

- `DB_VERSION` is a module-level constant in `src/lib/db.ts`
- Each version increment requires a corresponding migration in the `onupgradeneeded` handler
- Policy: additive changes (new stores, new indexes) are safe. Breaking changes (renamed stores, changed key paths) require a migration function
- Current version: `1`

---
