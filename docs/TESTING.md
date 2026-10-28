# Testing

Two suites, both free to run: neither makes a real AI call or needs an OpenRouter key.

| Suite | Command | What it covers |
| --- | --- | --- |
| Unit (vitest) | `npm test` (watch) or `npx vitest run` (once) | Schemas, tool runtime and executors, context building, IndexedDB helpers (`fake-indexeddb`) |
| End-to-end (Playwright) | `npm run test:e2e` | The real app in Chromium (phone-sized viewport) against the Vite dev server |

GitHub Actions (`.github/workflows/ci.yml`) runs both on every push and pull request. If the e2e step fails, the Playwright report and traces are attached to the run as an artifact.

## End-to-end tests

First run on a new machine: `npx playwright install chromium`.

`npm run test:e2e` starts `npm run dev` on port 5179, or reuses a server already running there. The tests are in `e2e/*.e2e.ts`; the `.e2e.ts` suffix keeps vitest from collecting them.

- **Signed in without OAuth.** `e2e/fixtures/seed.ts` loads the app, then writes a fake API key, a profile, goals and an active plan through the app's own `src/lib/db.ts`, and reloads. Chat therefore opens in planning mode.
- **OpenRouter is mocked.** `e2e/fixtures/openrouter.ts` intercepts `https://openrouter.ai/**` and answers each chat request, in order, from a scripted list of turns. The script is built by `e2e/fixtures/sse.ts` into the same streaming (SSE) format OpenRouter sends: text deltas, then tool-call deltas split into pieces, then `[DONE]`. Requests are recorded, so tests can assert on the model, tools and auth header. A request beyond the script gets a 500 and is reported as unexpected, so nothing ever reaches the network.
- **Covered paths** (`e2e/core.e2e.ts`):
  - The app loads signed in, and every tab opens with no console errors.
  - Chat receives a `propose_workout` tool call, and accepting it saves the workout.
  - Today marks each set Done and completes the workout.
  - Log lists the completed session.

- **No GitHub fetch.** `e2e/fixtures/models.ts` answers the app's startup fetch of `config/models.json` with a fixture list that adds `e2e/test-model`, or with a 404 to test the built-in fallback. `e2e/model-picker.e2e.ts` checks that the picker lists the file's models, that the chosen id is sent to OpenRouter and survives a reload, and that a missing file, a removed model or a legacy `premium`/`affordable` setting falls back correctly.

Useful flags: `npx playwright test --headed`, `--debug`, `--ui`, and `npx playwright show-report` after a failure.

## Refreshing the fixtures

The model turns in `e2e/fixtures/conversations.ts` are synthetic. Each one is a text reply or a tool call with its arguments. Update them when a tool's schema changes (`src/lib/chatTools.ts` and `src/lib/schemas/`) or a test needs a new turn. Exercise IDs must exist in `src/data/exercises.ts`, and workout dates must fall in the D0–D6 window; the helpers take today's date as an argument.

The wire format lives in one place, `e2e/fixtures/sse.ts`. If OpenRouter's streaming shape ever changes, capture a real response once, with your own key, outside the test suite. For example, save a `curl -N` of a short chat completion with `"stream": true` and a tool defined. Then update `sse.ts` to match the new shape. Never commit a real key or a captured response that contains one.
