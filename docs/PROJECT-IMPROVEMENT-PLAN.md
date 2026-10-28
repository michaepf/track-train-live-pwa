---
share_to: michael
share_via: drive
notify: none
share_status: shared
share_title: Track Train Live — High-Level Improvement Plan
shared_at: "2026-04-25T13:17:14-07:00"
shared_url: "https://drive.google.com/file/d/1r67Pf3SU5gEyy6ZY6obSitDVPC8F35Tv/view?usp=drivesdk"
shared_file_id: 1r67Pf3SU5gEyy6ZY6obSitDVPC8F35Tv
---
# Track Train Live — High-Level Improvement Plan

_Reviewed April 25, 2026._

This note proposes a next layer for Track Train Live beyond the current PWA baseline: three larger product directions and a cleanup pass. The current app already has a strong foundation: local-first storage, OpenRouter auth, conversational onboarding/planning, workout proposal cards, Today logging, Workouts browsing, Log history, and developer tools for context inspection and fixture scenarios.

The main opportunity is to make the product feel less like “chat that creates workout records” and more like a continuous coaching loop: plan → execute → reflect → adapt.

## 1. Build the Coach Loop

### Concept

Track Train Live should not end its intelligence at plan generation. The biggest product leap would be making the app actively interpret completed workouts and carry that signal forward into the next session.

Right now, the user can accept workouts, log set-level difficulty, add notes, and later ask the trainer for more planning. That is useful, but the feedback loop is still mostly user-initiated. A stronger version would make reflection a normal part of workout completion.

### Proposed experience

After the user completes or materially logs a workout, the app asks for a very small post-session check-in:

- Energy: low / okay / good
- Pain or discomfort: none / mild / notable
- Confidence: easier than expected / right level / too much
- Optional note: “anything feel off?”

Then the trainer produces a short coach note, such as:

- “Next time, keep goblet squats stable but add 5 lb to cable rows.”
- “Shoulder note is worth respecting: avoid overhead pressing this week.”
- “This was all too easy; next push day should step up modestly.”

This note should be saved with the workout or as a lightweight derived insight. It does not need to trigger a full replan every time. The value is that the app starts accumulating a living interpretation of the user’s training instead of only raw logs.

### Why it matters

This would make the product feel more personal and more trustworthy. A trainer is not just someone who writes a plan; a trainer notices what happened, updates their model, and changes the next recommendation accordingly.

It also creates a better reason to keep opening the app. The user gets immediate acknowledgement after the workout and a sense that the next plan will be shaped by what they just did.

### Implementation outline

1. Add a post-completion feedback panel to `Today`.
2. Store structured readiness / pain / confidence fields, plus an optional note.
3. Add a lightweight `coach_note` or `session_reflection` generation path.
4. Inject recent coach notes into planning context alongside recent workout details.
5. Later: surface “recent coaching signals” in the Log or Settings developer prompt inspector.

### Product risks

- Too much friction after workouts would backfire. The check-in must be tiny.
- AI-generated coaching notes should avoid medical overreach, especially around pain.
- The app should distinguish “notable discomfort” from “normal exertion” without pretending to diagnose.

## 2. Move from Append-Only Plans to Editable Plan Diffs

### Concept

The current design has a deliberately safe “always append” rule: AI proposals create new workout records and do not overwrite existing records. This is good for data safety, but it can create clutter when the user wants to revise a week.

A more powerful model is to let the trainer propose a plan patch: explicit additions, deletions, moves, and substitutions that the user can review before applying.

Instead of “here are three new workouts,” the AI could propose:

- Add: Push A on Monday
- Move: Legs A from Wednesday to Thursday
- Replace: Cable Shoulder Press with Dumbbell Shoulder Press
- Delete: Unstarted Pull A on Friday

The user accepts or rejects the whole patch.

### Proposed experience

The Workouts tab becomes more of a lightweight plan board. The trainer can still append a single session, but for replanning it returns a structured diff card.

The card should make the blast radius obvious:

- Added workouts
- Changed workouts
- Deleted unstarted workouts
- Protected completed workouts

Completed workouts remain immutable unless a separate explicit edit flow exists.

### Why it matters

This is the difference between a trainer who can only hand you new pieces of paper and a trainer who can help maintain the actual plan.

It also reduces duplicated or stale workouts. As the app gets better at weekly planning, the user will naturally ask for changes: travel, soreness, schedule shifts, equipment changes, motivation swings. Append-only is safe but not expressive enough for that long-term use.

### Implementation outline

1. Define a new tool, perhaps `propose_plan_patch`.
2. Represent patch operations explicitly:
   - `add_workout`
   - `delete_workout` for unstarted workouts only
   - `move_workout`
   - `replace_exercise`
   - `adjust_sets`
3. Validate all referenced workout IDs and dates locally.
4. Render a review card with grouped changes.
5. Apply the patch only after user acceptance.
6. Keep `propose_workout` for simple append flows.

### Data safety rules

- Never delete or overwrite completed workouts through this tool.
- Require exact workout IDs for destructive operations.
- Show all changes before applying them.
- If validation fails, return a tool error and let the model retry.

### Product risks

- Patch UX can get complicated quickly. Start with add / delete unstarted / move date before supporting set-level edits.
- The AI may propose too many changes unless the prompt emphasizes minimal diffs.
- Users need a clear undo story eventually, even if v1 just keeps the review card conservative.

## 3. Add a Personal Calibration Layer

### Concept

The app currently relies heavily on the model to infer training level, estimate weights, and adapt from history. The docs already call out the cold-start weight problem. That should become a first-class product layer rather than a workaround.

The calibration layer should capture the user’s practical training constraints and baseline ability in a structured way, then give the AI a stable substrate to coach from.

### What to capture

Useful calibration fields could include:

- Training level: beginner / returning / intermediate / advanced
- Available equipment
- Preferred session length
- Weekly availability
- Injury or limitation notes
- Disliked exercises
- Preferred exercises
- Baseline lifts or rough working weights:
  - bench or dumbbell press
  - row or pulldown
  - squat / leg press / hinge
  - overhead press, if relevant

This does not need to feel like a form. It can be collected conversationally during onboarding, then displayed as editable structured profile data in Settings.

### Why it matters

A personal trainer app needs continuity. Goals text is flexible, but it is too unstructured to carry all calibration reliably. The model can read it, but deterministic app logic cannot easily reason over it.

A calibration layer would let the app do better defaults even before history accumulates:

- Choose sensible starting weights.
- Avoid contraindicated movements.
- Scale accessory exercises from known baselines.
- Keep plans within preferred time and equipment constraints.
- Make model prompts shorter and more reliable.

### Implementation outline

1. Add a `profile` or `calibration` IndexedDB store.
2. Extend onboarding so the trainer collects baseline information naturally.
3. Add a review card similar to `propose_goals`, but for structured calibration.
4. Inject calibration into the planning system prompt as a compact section.
5. Use deterministic helpers for weight estimates and progression suggestions.

### Deterministic training engine idea

The AI should not be responsible for inventing every weight adjustment from scratch. A small deterministic layer could handle basic progression:

- If all sets were `too_easy`, suggest +5 lb or +1–2 reps next time.
- If all sets were `completed`, hold or modestly progress.
- If any set was `could_not_complete`, hold or reduce.
- If pain/discomfort was reported, avoid automatic progression.

The AI then explains and contextualizes the adjustment rather than doing all calculation itself.

### Product risks

- Too much onboarding can make the first-run experience heavy.
- The calibration data must be editable, because people’s constraints change.
- The app should avoid pretending precision where it only has rough estimates.

## 4. Cleanup and Foundation Items

These are smaller but important before building larger features.

### Fix test-suite drift

Current verification result:

- `npm run build` passes.
- `npm test -- --run` has failures.

The failures appear to be drift rather than catastrophic product breakage:

- `api.ts` is locked in non-stream debug mode, while streaming tests still expect SSE behavior.
- A context test describes a workout as “4 weeks ago,” but the recent-history cutoff is now 42 days, so that workout is no longer old enough to use weekly summaries.

Recommended cleanup:

- Decide whether non-stream mode is the real default for now.
- Split tests by stream/non-stream behavior or make the debug mode injectable.
- Update history-context tests and labels to match `RECENT_HISTORY_DAYS = 42`.

### Add a Content Security Policy

The app stores the OpenRouter token in IndexedDB. That is reasonable for a local-first PWA, but it makes XSS posture important.

Add a real CSP in `netlify.toml`, probably starting conservative and loosening only what the app needs:

- `default-src 'self'`
- allow OpenRouter API calls in `connect-src`
- allow required PWA assets
- avoid `unsafe-inline` if feasible, or document why it is temporarily needed

### Resolve IA/code leftovers

`Goals.tsx` still exists even though Goals content appears to have moved into Settings. Either wire it back into navigation or delete it to reduce confusion.

The app should have one clear answer to “where do I edit goals?”

### Align copy with behavior

There are copy/docs mismatches around history recency:

- Code uses `RECENT_HISTORY_DAYS = 42`.
- Some text still says “last 3 weeks.”

Pick the intended window and align docs, settings copy, and prompt section labels.

### Start authenticated users on the right tab

Chat-first makes sense during onboarding and planning. But once the user has an accepted workout today, opening directly to `Today` may better match the app’s job-to-be-done.

Possible rule:

- If no goals: open Chat.
- If goals need review: open Chat.
- If there is an uncompleted workout today: open Today.
- Otherwise: open Chat or Workouts depending on preference.

### Consider screenshots / UX review pass

A code/docs review is enough for product direction, but screenshots would improve judgment around affordance, density, and mobile feel. The most useful screens to inspect would be:

- onboarding chat
- proposed workout card
- Today workout logging
- Workouts plan list
- Settings data/developer section
