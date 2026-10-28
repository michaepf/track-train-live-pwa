import type { ScriptedResponse } from './sse.ts'

/**
 * Scripted model turns. These are synthetic but follow the request/response
 * shapes the app uses with OpenRouter; see docs/TESTING.md for how to
 * refresh them from a real session.
 */
export const E2E_SESSION = 'E2E Upper Body'

export function proposeWorkoutTurn(date: string): ScriptedResponse {
  return {
    kind: 'tool_call',
    name: 'propose_workout',
    text: 'Here is a short upper-body session for today.',
    arguments: {
      workouts: [
        {
          date,
          workoutType: 'strength',
          session: E2E_SESSION,
          warmup: { cardio: { type: 'bike', duration: '5 min' } },
          entries: [
            { exerciseId: 'db-bench-press', sets: [{ plannedReps: 10, plannedWeight: 30 }, { plannedReps: 10, plannedWeight: 30 }] },
            { exerciseId: 'db-row', sets: [{ plannedReps: 12, plannedWeight: 35 }] },
          ],
          cooldown: { stretching: [{ name: 'Chest stretch', duration: '30s' }] },
        },
      ],
    },
  }
}
