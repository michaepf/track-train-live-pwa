# Phase 7 - Feature Expansion

Status: NOT STARTED

## Goal

Add user-facing features that improve the training workflow and AI integration.

## 7a - Custom Exercise Database

Allow the AI agent to extend the exercise catalog beyond the built-in list.

**Approach:** All exercise management is agent-driven via tool calls. There is no UI for this — if the user wants to add or remove an exercise, they tell the AI and the AI does it.

**Behavior:**
- AI always receives the full built-in catalog + any custom exercises combined
- Built-in exercises are permanent and cannot be removed
- Custom exercises are stored locally in IndexedDB and can be added or removed by the AI
- No Settings UI — exercise management is exclusively through conversation

**Key files:**
- `src/lib/db.ts` — add `customExercises` store (DB version 2), add CRUD helpers
- `src/data/exercises.ts` — add `registerCustomExercises()`, update `buildCatalogPromptSection()` to append custom exercises to the built-in list
- `src/lib/context.ts` — load and pass custom exercises into `buildSystemPrompt()`
- `src/screens/Chat.tsx` — add `add_exercise` and `remove_exercise` tools, handle them (save/delete + re-register), load custom exercises before building system prompt
- `src/App.tsx` — load custom exercises on init and call `registerCustomExercises()` for name resolution in Today/Workout screens

**Tool schemas:**
```json
{
  "name": "add_exercise",
  "description": "Add a new exercise to the user's custom exercise catalog.",
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

{
  "name": "remove_exercise",
  "description": "Remove a custom exercise from the user's catalog. Cannot remove built-in exercises.",
  "parameters": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "The exercise id to remove" }
    },
    "required": ["id"]
  }
}
```

**Notes:**
- Both tools are silent auto-execute (no user confirmation card)
- Only available in `planning` mode
- `remove_exercise` should silently no-op if the id belongs to a built-in exercise
- After any change, call `registerCustomExercises()` so `getExerciseName()` stays current

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
