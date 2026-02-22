# Handoff

Last updated: 2026-02-22

## Current Status

- Phase 1: DONE
- Phase 2: DONE
- Phase 3: READY TO START (workout planning tools and flow)

## Current Defaults

- Premium model: `anthropic/claude-sonnet-4.6`
- Affordable model: `z-ai/glm-5`
- API mode: non-stream debug enabled (`DEBUG_NON_STREAM = true` in `src/lib/api.ts`)

## Known Working

- OpenRouter auth flow
- Goal proposal tool calls with GLM-5
- Goals persistence and Goals tab visibility
- Local reset via Settings (`Reset All Local Data`)
- Markdown-like formatting now renders in chat/tool cards
- Chat input box is taller and more usable

## Known Issues / Watch Items

- `propose_workout` tool path is not implemented yet
- Debug logs are currently noisy in `Chat.tsx` and `api.ts`
- Stream mode was unstable during testing; keep non-stream until fixed

## Most Recent Fixes

- Conversation type persistence update in `persistConv` to prevent blank chat after onboarding -> planning transition
- Tool panel moved above input for better visibility
- Model defaults updated to Sonnet 4.6 and GLM-5
- Added safe markdown renderer component for chat/tool text
- Increased chat input height for better UX

## Next 3 Tasks

1. Implement `propose_workout` tool contract and payload validation in Chat/API flow
2. Build workout proposal UI card + Accept/Request changes behavior (save workouts on accept)
3. Keep non-stream mode for now, then clean debug logs after workout tool flow is stable

## Files To Read First In New Session

1. `docs/IMPLEMENTATION-PLAN.md`
2. `docs/phases/PHASE-3.md`
3. `docs/HANDOFF.md`

## Kickoff Prompt (copy/paste)

Please continue Phase 3 in `track-train-live-pwa`.

Read first:
1) `docs/IMPLEMENTATION-PLAN.md`
2) `docs/phases/PHASE-3.md`
3) `docs/HANDOFF.md`
4) `docs/CONTRACTS.md` (if needed for invariants)

Current state:
- Phase 1 and 2 are done.
- Onboarding and `propose_goals` are working better with `z-ai/glm-5`.
- `DEBUG_NON_STREAM = true` is intentionally enabled in `src/lib/api.ts`.
- Main missing capability: `propose_workout` tool flow.

Task focus for this session:
1) Implement `propose_workout` tool contract and payload validation.
2) Render workout proposal card(s) in Chat with Accept / Request changes.
3) On Accept, persist workouts with current "always append" policy.
4) Keep changes scoped to Phase 3 only.

Constraints:
- Do not refactor unrelated files.
- Keep non-stream mode enabled for now.
- Preserve existing model defaults:
  - premium: `anthropic/claude-sonnet-4.6`
  - affordable: `z-ai/glm-5`

Done criteria:
- User can ask for a weekly plan and receive a workout proposal tool card.
- Accept saves workouts into IndexedDB and they can be loaded later.
- Chat remains interactive after tool handling.

