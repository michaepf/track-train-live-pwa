# Phase 1 - Foundation

Status: DONE

## Goal

Auth works. Data can be stored and retrieved. Settings screen exists. Core shell is stable.

## 1a - Zod Schemas (`src/lib/schemas/*`)

- [x] `GoalsSchema`
- [x] `SetSchema`
- [x] `EntrySchema`
- [x] `CardioOptionSchema`
- [x] `WorkoutSchema`
- [x] `ProposeWorkoutPayloadSchema`
- [x] `ProposeWorkoutsPayloadSchema`
- [x] `isWorkoutCompleted(workout)`
- [x] `ProposeGoalsPayloadSchema`
- [x] `ConversationSchema`
- [x] `MessageSchema`
- [x] Export inferred TS types for schemas
- [x] Add migration helpers per schema module

## 1b - IndexedDB Layer (`src/lib/db.ts`)

- [x] `DB_VERSION` constant
- [x] `openDB()` with upgrade path and recoverable failure cache handling
- [x] `getGoals()` / `saveGoals()`
- [x] `getWorkoutsByDate(date)` (supports multiple workouts/day)
- [x] `getWorkoutById(id)`
- [x] `saveWorkout(workout)`
- [x] `deleteWorkout(id)` with completed-workout deletion guard
- [x] `listWorkouts(limit)` date/ID ordering
- [x] `getConversation(id)` / `saveConversation(conv)` / `createConversation(type)`
- [x] `listConversations(limit)`
- [x] `getSummary(weekStr)` / `saveSummary(weekStr, text)`
- [x] `getSetting(key)` / `setSetting(key, value)` / `deleteSetting(key)`
- [x] `clearAllData()` maintenance helper

## 1c - OpenRouter Auth (`src/lib/auth.ts`)

- [x] `startLogin()` PKCE verifier/challenge + state generation
- [x] `handleCallback(params)` with state validation and typed errors
- [x] `getApiKey()`
- [x] `isAuthenticated()`
- [x] `logout()`
- [x] `handle401()`
- [x] `isCallbackUrl()`

## 1d - App Shell (`src/App.tsx`)

- [x] Auth check on load
- [x] Callback handling path
- [x] `ApiKeyContext`
- [x] Error boundary
- [x] Tab shell with placeholders for screens

## 1e - Settings (`src/screens/Settings.tsx`)

- [x] Model selection persisted in settings store
- [x] Logout action
- [x] Reset all local data action for testing

## Tests

- [x] `db.test.ts`
- [x] `schemas.test.ts`
- [x] `auth.test.ts`

## Acceptance Criteria Met

- [x] OAuth flow completes and key persists
- [x] Settings works (model + logout/reset)
- [x] Data layer tests pass

