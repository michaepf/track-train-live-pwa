# Phase 7 - Feature Expansion

Status: NOT STARTED

## Goal

Add user-facing features that improve the training workflow and AI integration.

## 7a - Custom Exercise Database

Allow the AI agent to extend the exercise catalog beyond the built-in list.

**Approach:** The AI adds exercises via an `add_exercise` tool call (not a manual form — the user just asks the AI to add one). Custom exercises are stored in IndexedDB and shown read-only in Settings with delete buttons.

**Behavior:**
- When any custom exercises exist → AI receives custom list instead of built-in catalog
- When no custom exercises exist → built-in catalog used as normal
- Settings screen shows a read-only "Exercise Library" section listing custom exercises with delete buttons

**Key files:**
- `src/lib/db.ts` — add `customExercises` store (DB version 2), add CRUD helpers
- `src/data/exercises.ts` — add `registerCustomExercises()`, update `buildCatalogPromptSection()` to accept optional override list
- `src/lib/context.ts` — thread `customExercises?: Exercise[]` through `buildSystemPrompt()`
- `src/screens/Chat.tsx` — add `add_exercise` tool, handle it (save + register), load custom exercises before building system prompt
- `src/screens/Settings.tsx` — read-only exercise list with delete buttons
- `src/App.tsx` — load custom exercises on init and call `registerCustomExercises()` for name resolution in Today/Workout screens

**Tool schema (`add_exercise`):**
```json
{
  "name": "add_exercise",
  "description": "Add a new exercise to the user's custom exercise catalog. Use when the user asks to add an exercise not in the built-in list.",
  "parameters": {
    "type": "object",
    "properties": {
      "id":          { "type": "string", "description": "kebab-case slug, e.g. 'bulgarian-split-squat'" },
      "name":        { "type": "string", "description": "Display name" },
      "description": { "type": "string", "description": "Brief description" },
      "tags":        { "type": "array", "items": { "type": "string" }, "description": "e.g. ['legs','dumbbells']" }
    },
    "required": ["id", "name", "description", "tags"]
  }
}
```

**Notes:**
- `add_exercise` is a silent auto-execute tool (no user confirmation card needed — just save and return success)
- Only available in `planning` mode
- After saving, call `registerCustomExercises()` so `getExerciseName()` resolves the new name immediately

## 7b - Jump to Next Workout

A button on the Today tab to navigate directly to the Workout tab (upcoming planned sessions).

**Behavior:**
- Show in empty state: when `workouts.length === 0` for the current view date
- Show at bottom: when all workouts for today are completed (`isWorkoutCompleted()` true for all)
- Button label: "See upcoming workouts →"
- Action: calls `onNavigate('workout')`

**Key files:**
- `src/App.tsx` — pass `onNavigate={(id) => setScreen(id)}` to `<Today />`
- `src/screens/Today.tsx` — accept `onNavigate: (screen: ScreenId) => void` prop, add button
