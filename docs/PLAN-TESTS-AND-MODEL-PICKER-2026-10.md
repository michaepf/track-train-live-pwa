# Plan: end-to-end tests and remotely updatable model picker

_Agreed with Michael on October 28, 2026. The related research is in `DECISION-SIGN-IN-WITH-CHATGPT.md`._

## Boundary

Build for Michael alone. This plan skips migrations, multi-device matrices and live-site monitoring.

Branches: `main` is the integration branch, and Netlify deploys only from `release`. Work lands as pull requests from the `blake-sf` fork against `michaepf/track-train-live-pwa` `main`. Nothing is merged or pushed to Michael's repo except through a PR he reviews.

## Slice 1: end-to-end tests (do first)

Outcome: a cheap, repeatable check that the main paths still work.

- Add Playwright browser tests run against the Vite app, with OpenRouter traffic intercepted and answered from recorded or synthetic streaming fixtures. They make no real AI calls and cost nothing.
- Seed an authenticated state (a fake API key in IndexedDB) so tests skip the OAuth redirect.
- Cover the primary paths:
  1. The chat proposes a workout through the existing tool-call flow, and accepting it saves the workout.
  2. Today: log sets for that workout and complete it.
  3. History/Log shows the completed session.
  4. The app loads with no console errors.
- Add an `npm run test:e2e` script. Add a GitHub Actions workflow that runs the existing vitest suite plus the e2e tests on push and PR.
- Keep the 135 existing unit tests green.

Done when: `npm test` and `npm run test:e2e` pass locally, the workflow passes on the PR, and the docs say how to run the tests and refresh the fixtures.

## Slice 2: model picker read from GitHub (after slice 1)

Outcome: Michael changes the model list by editing one JSON file on `main` in GitHub's web editor, with no code change and no Netlify deploy.

- Add `config/models.json` on `main`: a list of `{ id, label, note }`, plus a `default` id.
- At startup the app fetches `https://raw.githubusercontent.com/michaepf/track-train-live-pwa/main/config/models.json`. Responses allow cross-origin reads and cache for about five minutes (checked October 28). Validate the file with zod. If the fetch fails or the file is invalid, use the built-in list: the current `anthropic/claude-sonnet-5` and `z-ai/glm-5.2:nitro` pair.
- The service worker must not precache this file, so the network copy wins when online.
- The picker in Chat lists every model in the file. Store the chosen model id in the `model` setting. If a saved id is missing from the list, or the setting holds a legacy `premium`/`affordable` value, fall back to the default. No migration code.
- Replace the hard-coded `MODELS`/`ModelTier` usage in `src/lib/api.ts` and `src/screens/Chat.tsx`. Keep Anthropic-specific thinking handling keyed on the `anthropic/` id prefix, as it is today.
- Fix the leftover `X-Title: 'Track Train Live'` header in the debug non-stream path (`src/lib/api.ts`) to `Rubato Coach`.
- No OpenRouter capability checks. If a listed model can't handle the tool calls, Michael removes it from the file.
- Unit tests: parsing, fallbacks, and saved-choice resolution. Extend the e2e suite so a picker change uses the chosen model id in the request.

Done when: changing the JSON on `main` changes the picker within minutes on the live site, with no deploy, and both test suites pass.

## Out of scope

Sign in with ChatGPT (shelved), OpenRouter capability filtering, analytics, and live monitoring.
