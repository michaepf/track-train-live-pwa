# Future Features & Open Questions

Ideas and design questions that aren't being built yet.

---

## Weight estimation / exercise benchmarks

**Problem:** On cold start (no workout history), the AI guesses weights with no user-specific anchor. Weights can be unrealistic or inconsistent across exercises.

**Ideas explored:**
- Per-exercise weight tiers in the catalog: `beginner / intermediate / advanced` working weights (in lb). The AI picks the tier matching the user's fitness level from their goals.
  - Example: `cable-row — Cable Row [beg 50lb · mid 80lb · adv 110lb]`
  - Beginner ≈ 0.6× intermediate; advanced ≈ 1.35× intermediate
- OpenPowerlifting CSV (750MB) has squat/bench/deadlift population data — could derive p25/p50/p75 for barbell lifts. Machine/cable exercises would still need manual estimates.
- Strength ratios: cable row ≈ 60–70% of bench, lat pulldown ≈ 60–80% of bodyweight, etc.

**Open question:** Where does the user's tier come from?
- Option A: Inferred from goals text (zero extra infrastructure, depends on onboarding capturing it)
- Option B: Explicit `fitnessLevel: 'beginner' | 'intermediate' | 'advanced'` field in goals schema + onboarding question

**Current workaround:** Tell Chat your starting weights directly ("I can bench ~Xlb"), it'll use that in the next plan and calibrate from history after that.

---

## Onboarding: strength baseline capture

**Problem:** Onboarding captures goals/background but not current working weights for key lifts. This causes cold-start weight estimation problems.

**Idea:** Add a structured "strength baseline" step to onboarding — ask for a few key lift estimates (bench, squat, row) and store them in goals or a separate baseline field. The AI uses these to scale all other exercises via ratios.

---

## Editing completed workouts

**Problem:** Once a workout is marked complete, `deleteWorkout` throws if you try to delete it, and there's no edit path in the UI. But mistakes happen — wrong weight logged, missed a set, marked complete by accident.

**Open questions:**
- What scope of edits should be allowed? Options: (a) notes/feedback only, (b) set difficulty ratings, (c) full edit including weights and reps, (d) all of the above
- Should edits be append-only (audit trail) or in-place?
- "Marked complete by accident" — should there be an undo/reopen flow, or just allow re-editing the fields?
- Does editing a completed workout need to invalidate or re-trigger summarization for that week?

**Current constraint:** `deleteWorkout` in `db.ts` explicitly throws on completed workouts. Any edit feature would need `db.ts` to expose a separate `updateCompletedWorkout` that bypasses that guard (with appropriate scope limits).

---

## Phase 5b: Lazy summarization

Validate `getWeekKey` / `getSummary` / `saveSummary` end-to-end. Confirm older weeks use summary text in planning context. Add a dev trigger in Settings to run summarization manually.

## Phase 5c: Context size validation

Confirm "recent full detail, older summaries" behavior stays bounded as history grows. Verify planning prompt token count under realistic multi-week data.

## Phase 3 cleanup

- Remove `console.log` noise from `api.ts`
- Decide streaming vs non-streaming permanently
