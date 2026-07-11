import {
  getToolSchemaHint,
  resolveToolCall,
  type PendingTool,
  type ToolCardState,
  type ToolExecution,
} from './chatTools.ts'
import {
  serializeToolOutcomeForModel,
  type ToolOperationOutcome,
} from './toolOutcomes.ts'

export const MAX_TOOL_CORRECTIONS = 2

export type ToolActivityStatus =
  | 'running'
  | 'correcting'
  | 'awaiting_approval'
  | 'succeeded'
  | 'no_change'
  | 'partially_succeeded'
  | 'failed'

export interface ToolActivityViewModel {
  status: ToolActivityStatus
  message: string
  detail?: string
  nextStep?: string
}

export interface ToolRetryCounts {
  validation: number
  execution: number
}

export type ToolRecoveryAction = 'retry_tool' | 'ask_trainer'

export type ToolRuntimeResult =
  | {
      kind: 'awaiting_approval'
      cardState: ToolCardState
      activity: ToolActivityViewModel
    }
  | {
      kind: 'retry_model'
      reason: 'validation' | 'execution'
      toolResult: string
      instruction: string
      retries: ToolRetryCounts
      activity: ToolActivityViewModel
    }
  | {
      kind: 'completed'
      toolResult: string
      outcome: ToolOperationOutcome
      activity: ToolActivityViewModel
    }
  | {
      kind: 'terminal_failure'
      toolResult: string
      outcome?: ToolOperationOutcome
      activity: ToolActivityViewModel
      recoveryAction?: ToolRecoveryAction
    }

interface RunToolOperationOptions {
  toolCall: PendingTool
  customExerciseIds: Set<string>
  retries: ToolRetryCounts
  execute: (execution: ToolExecution) => Promise<ToolOperationOutcome>
  onActivity?: (activity: ToolActivityViewModel) => void
}

const TOOL_NOUNS: Record<string, string> = {
  propose_profile: 'profile',
  propose_goals: 'goals',
  propose_training_plan: 'training plan',
  propose_workout: 'workout proposal',
  add_exercise: 'exercise catalog',
  remove_exercise: 'exercise catalog',
  edit_workout: 'workout',
  swap_exercise: 'workout',
  delete_future_workouts: 'future workouts',
}

function nounFor(toolName: string): string {
  return TOOL_NOUNS[toolName] ?? 'request'
}

function runningActivity(toolName: string): ToolActivityViewModel {
  const messages: Record<string, string> = {
    add_exercise: 'Adding an exercise to your catalog...',
    remove_exercise: 'Updating your exercise catalog...',
    edit_workout: 'Updating your workout...',
    swap_exercise: 'Swapping an exercise...',
    delete_future_workouts: 'Removing future workouts...',
  }
  return {
    status: 'running',
    message: messages[toolName] ?? `Working on your ${nounFor(toolName)}...`,
  }
}

function approvalActivity(toolName: string): ToolActivityViewModel {
  return {
    status: 'awaiting_approval',
    message: `Your ${nounFor(toolName)} is ready to review.`,
    nextStep: 'Review the proposal below before anything is saved.',
  }
}

function successActivity(outcome: ToolOperationOutcome): ToolActivityViewModel {
  const details = outcome.userDetails

  if (outcome.status === 'no_change') {
    if (outcome.code === 'exercise_already_exists' && details.kind === 'exercise') {
      return {
        status: 'no_change',
        message: `${details.exerciseName ?? 'That exercise'} is already in your catalog.`,
      }
    }
    if (outcome.code === 'exercise_not_present') {
      return { status: 'no_change', message: 'That exercise was already absent from your catalog.' }
    }
    if (outcome.code === 'workout_unchanged') {
      return { status: 'no_change', message: 'Your workout already had those values.' }
    }
    if (outcome.code === 'no_matching_workouts') {
      return { status: 'no_change', message: 'There were no future workouts to remove.' }
    }
    if (outcome.recovery === 'permanent_conflict') {
      return {
        status: 'no_change',
        message: 'No workouts were removed.',
        detail: 'Started and completed workouts are protected.',
      }
    }
    return { status: 'no_change', message: `No changes were needed for your ${nounFor(outcome.operation)}.` }
  }

  if (outcome.status === 'partially_succeeded') {
    if (details.kind === 'workout_batch') {
      const protectedText = details.protectedCount > 0
        ? ` ${details.protectedCount} started or completed workout${details.protectedCount === 1 ? ' was' : 's were'} protected.`
        : ''
      const failedText = details.failedCount > 0
        ? ` ${details.failedCount} could not be verified.`
        : ''
      return {
        status: 'partially_succeeded',
        message: `Removed ${details.affectedCount} future workout${details.affectedCount === 1 ? '' : 's'}.`,
        detail: `${protectedText}${failedText}`.trim(),
        nextStep: details.failedCount > 0 ? 'Review your current plan before trying again.' : undefined,
      }
    }
    return {
      status: 'partially_succeeded',
      message: `Part of the ${nounFor(outcome.operation)} change was completed.`,
      nextStep: 'Review the current state before trying again.',
    }
  }

  if (outcome.code === 'exercise_added' && details.kind === 'exercise') {
    return { status: 'succeeded', message: `${details.exerciseName ?? 'Exercise'} was added to your catalog.` }
  }
  if (outcome.code === 'exercise_removed' && details.kind === 'exercise') {
    return { status: 'succeeded', message: `${details.exerciseName ?? 'Exercise'} was removed from your catalog.` }
  }
  if (outcome.code === 'workout_edited' && details.kind === 'workout') {
    const count = details.changedSetCount ?? 0
    return { status: 'succeeded', message: `Updated ${count} workout set${count === 1 ? '' : 's'}.` }
  }
  if (outcome.code === 'exercise_swapped' && details.kind === 'swap') {
    return { status: 'succeeded', message: `Swapped ${details.fromName} for ${details.toName}.` }
  }
  if (outcome.code === 'future_workouts_deleted' && details.kind === 'workout_batch') {
    return {
      status: 'succeeded',
      message: `Removed ${details.affectedCount} future workout${details.affectedCount === 1 ? '' : 's'}.`,
    }
  }
  return { status: 'succeeded', message: `Your ${nounFor(outcome.operation)} was updated.` }
}

function failureActivity(outcome: ToolOperationOutcome): ToolActivityViewModel {
  if (outcome.status !== 'failed') return successActivity(outcome)

  const permanentMessages: Partial<Record<typeof outcome.failureCode, ToolActivityViewModel>> = {
    workout_completed: {
      status: 'failed',
      message: "Couldn't update the workout.",
      detail: "Completed workouts can't be changed.",
      nextStep: 'Ask the trainer to plan a new workout instead.',
    },
    workout_protected: {
      status: 'failed',
      message: "Couldn't remove the workout.",
      detail: 'Started and completed workouts are protected.',
      nextStep: 'Review the current plan or choose a different workout.',
    },
    set_completed: {
      status: 'failed',
      message: "Couldn't update that set.",
      detail: "A set with logged difficulty can't be changed.",
      nextStep: 'Ask the trainer to adjust an unlogged set instead.',
    },
    entry_in_progress: {
      status: 'failed',
      message: "Couldn't swap that exercise.",
      detail: "An exercise in progress can't be replaced.",
      nextStep: 'Choose an exercise that has not been started.',
    },
  }
  const permanent = permanentMessages[outcome.failureCode]
  if (permanent) return permanent

  if (outcome.recovery === 'model_correction') {
    return {
      status: 'failed',
      message: `The trainer couldn't complete the ${nounFor(outcome.operation)} change.`,
      nextStep: 'Ask the trainer to check your current plan and try another approach.',
    }
  }
  if (outcome.recovery === 'retry_safe') {
    return {
      status: 'failed',
      message: `Couldn't read the information needed for your ${nounFor(outcome.operation)}.`,
      nextStep: 'Try the operation again.',
    }
  }
  if (outcome.stateChanged === 'unknown') {
    return {
      status: 'failed',
      message: `Couldn't verify the ${nounFor(outcome.operation)} change.`,
      detail: 'The app cannot confirm whether local data changed.',
      nextStep: 'Review the current state before trying again.',
    }
  }
  return {
    status: 'failed',
    message: `Couldn't complete the ${nounFor(outcome.operation)} change.`,
    nextStep: 'Try again or ask the trainer for another approach.',
  }
}

function executionCorrectionInstruction(toolName: string, outcome: ToolOperationOutcome): string {
  return [
    `The previous ${toolName} tool call could not be applied: ${outcome.modelDetail}`,
    `Retry now with a corrected ${toolName} tool call that matches the user's current data.`,
    'Do not claim that anything changed unless the next tool result confirms it.',
    getToolSchemaHint(toolName),
  ].join('\n\n')
}

export async function runToolOperation({
  toolCall,
  customExerciseIds,
  retries,
  execute,
  onActivity,
}: RunToolOperationOptions): Promise<ToolRuntimeResult> {
  const resolved = resolveToolCall(toolCall, customExerciseIds)

  if (resolved.kind === 'error') {
    const toolResult = `Error: ${resolved.message}`
    if (retries.validation < MAX_TOOL_CORRECTIONS) {
      return {
        kind: 'retry_model',
        reason: 'validation',
        toolResult,
        instruction: [
          `The previous ${toolCall.name} tool call was invalid: ${resolved.message}.`,
          `Retry now by emitting a valid ${toolCall.name} tool call with corrected arguments.`,
          'Do not respond with plain text.',
          getToolSchemaHint(toolCall.name),
        ].join('\n\n'),
        retries: { ...retries, validation: retries.validation + 1 },
        activity: {
          status: 'correcting',
          message: `Correcting the ${nounFor(toolCall.name)} request...`,
        },
      }
    }
    return {
      kind: 'terminal_failure',
      toolResult,
      activity: {
        status: 'failed',
        message: `The trainer couldn't prepare a valid ${nounFor(toolCall.name)} request.`,
        nextStep: 'Rephrase the request or ask the trainer to try another approach.',
      },
      recoveryAction: 'ask_trainer',
    }
  }

  if (resolved.kind === 'card') {
    return {
      kind: 'awaiting_approval',
      cardState: resolved.cardState,
      activity: approvalActivity(toolCall.name),
    }
  }

  onActivity?.(runningActivity(toolCall.name))
  const outcome = await execute(resolved.execution)
  const toolResult = serializeToolOutcomeForModel(outcome)

  if (
    outcome.status === 'failed' &&
    outcome.recovery === 'model_correction' &&
    retries.execution < MAX_TOOL_CORRECTIONS
  ) {
    return {
      kind: 'retry_model',
      reason: 'execution',
      toolResult,
      instruction: executionCorrectionInstruction(toolCall.name, outcome),
      retries: { ...retries, execution: retries.execution + 1 },
      activity: {
        status: 'correcting',
        message: `Checking your current ${nounFor(toolCall.name)} and correcting the request...`,
      },
    }
  }

  if (outcome.status === 'failed') {
    return {
      kind: 'terminal_failure',
      toolResult,
      outcome,
      activity: failureActivity(outcome),
      recoveryAction: outcome.recovery === 'retry_safe' ? 'retry_tool' : outcome.recovery === 'model_correction' ? 'ask_trainer' : undefined,
    }
  }

  return {
    kind: 'completed',
    toolResult,
    outcome,
    activity: successActivity(outcome),
  }
}
