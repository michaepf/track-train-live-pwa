import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  saveGoals,
  saveProfile,
  saveTrainingPlan,
  saveWorkout,
} from '../lib/db.ts'
import { getToday } from '../lib/context.ts'
import {
  GoalsSchema,
  UserProfileSchema,
  TrainingPlanSchema,
  WorkoutSchema,
} from '../lib/schemas/index.ts'
import type {
  Conversation,
  ConversationType,
  Goals,
  Message,
  ProposeProfilePayload,
  ProposeTrainingPlanPayload,
  ProposeWorkoutsPayload,
  TrainingPlan,
  UserProfile,
} from '../lib/schemas/index.ts'
import type { Exercise } from '../data/exercises.ts'
import type { PendingTool, ToolCardState } from '../lib/chatTools.ts'
import type { ToolActivityViewModel } from '../lib/toolRuntime.ts'

export type ProposalStreamRunner = (
  thread: Message[],
  currentConv: Conversation | null,
  currentMode: ConversationType,
  currentGoals: Goals | null,
  currentModel: string,
  currentCustomExercises?: Exercise[],
  currentProfile?: UserProfile | null,
  currentPlan?: TrainingPlan | null,
) => Promise<void>

interface UseProposalActionsOptions {
  pendingTool: PendingTool | null
  setPendingTool: Dispatch<SetStateAction<PendingTool | null>>
  setToolCard: Dispatch<SetStateAction<ToolCardState | null>>
  messages: Message[]
  setMessages: Dispatch<SetStateAction<Message[]>>
  conv: Conversation | null
  setConv: Dispatch<SetStateAction<Conversation | null>>
  mode: ConversationType
  setMode: Dispatch<SetStateAction<ConversationType>>
  goals: Goals | null
  setGoals: Dispatch<SetStateAction<Goals | null>>
  profile: UserProfile | null
  setProfile: Dispatch<SetStateAction<UserProfile | null>>
  trainingPlan: TrainingPlan | null
  setTrainingPlan: Dispatch<SetStateAction<TrainingPlan | null>>
  model: string
  customExercises: Exercise[]
  setToolActivity: Dispatch<SetStateAction<ToolActivityViewModel | null>>
  clearToolRecovery: () => void
  resetToolRetries: () => void
  persistConversation: (
    messages: Message[],
    current: Conversation | null,
    type: ConversationType,
  ) => Promise<Conversation>
  stream: ProposalStreamRunner
}

export function useProposalActions({
  pendingTool,
  setPendingTool,
  setToolCard,
  messages,
  setMessages,
  conv,
  setConv,
  mode,
  setMode,
  goals,
  setGoals,
  profile,
  setProfile,
  trainingPlan,
  setTrainingPlan,
  model,
  customExercises,
  setToolActivity,
  clearToolRecovery,
  resetToolRetries,
  persistConversation,
  stream,
}: UseProposalActionsOptions) {
  const [busy, setBusy] = useState(false)
  const acceptedWorkoutCountRef = useRef(0)

  async function persistAcceptedMessages(
    nextMessages: Message[],
    currentConversation: Conversation | null,
    nextMode: ConversationType,
  ): Promise<Conversation | null> {
    try {
      return await persistConversation(nextMessages, currentConversation, nextMode)
    } catch (error: unknown) {
      console.error('[chat] accepted data saved but conversation persistence failed:', error)
      setToolActivity({
        status: 'partially_succeeded',
        message: 'Your data was saved, but the chat history could not be updated.',
        nextStep: 'Start a new message before making another change.',
      })
      clearToolRecovery()
      return null
    }
  }

  async function acceptGoals(text: string) {
    if (!pendingTool || busy) return
    const currentPending = pendingTool
    setBusy(true)
    setToolActivity({ status: 'running', message: 'Saving your goals...' })
    clearToolRecovery()

    try {
      const now = new Date().toISOString()
      const newGoals = GoalsSchema.parse({ text, updatedAt: now, pendingReview: false })
      await saveGoals(newGoals)
      setGoals(newGoals)

      const hasValidPlan = trainingPlan && !trainingPlan.pendingReview
      const nextMode: ConversationType = hasValidPlan ? 'planning' : mode
      const newMessages: Message[] = [
        ...messages,
        { role: 'tool', content: 'Goals accepted.', toolCallId: currentPending.id },
        {
          role: 'assistant',
          content: hasValidPlan
            ? 'Great — your goals are saved. I\'m now building your workouts. You can ask me anytime to adjust any part of your plan.'
            : 'Great — your goals are saved. Now let\'s put together a training plan based on your profile and goals.',
        },
      ]
      setMessages(newMessages)
      setToolCard(null)
      setPendingTool(null)
      setMode(nextMode)
      setToolActivity({ status: 'succeeded', message: 'Your goals were saved.' })

      const savedConv = await persistAcceptedMessages(newMessages, conv, nextMode)
      if (!savedConv) return
      resetToolRetries()
      await stream(newMessages, savedConv, nextMode, newGoals, model, customExercises, profile, trainingPlan)
    } catch (error: unknown) {
      console.error('[chat] failed to save accepted goals:', error)
      setToolActivity({
        status: 'failed',
        message: "Couldn't save your goals.",
        nextStep: 'Review the proposal and tap Accept again.',
      })
      clearToolRecovery()
    } finally {
      setBusy(false)
    }
  }

  async function acceptProfile(profilePayload: ProposeProfilePayload) {
    if (!pendingTool || busy) return
    const currentPending = pendingTool
    let profileSaved = false
    setBusy(true)
    setToolActivity({ status: 'running', message: 'Saving your profile...' })
    clearToolRecovery()

    try {
      const now = new Date().toISOString()
      const newProfile = UserProfileSchema.parse({ ...profilePayload, updatedAt: now })
      await saveProfile(newProfile)
      profileSaved = true
      setProfile(newProfile)

      let nextPlan = trainingPlan
      if (trainingPlan) {
        nextPlan = { ...trainingPlan, pendingReview: true, updatedAt: now }
        await saveTrainingPlan(nextPlan)
        setTrainingPlan(nextPlan)
      }

      const newMessages: Message[] = [
        ...messages,
        { role: 'tool', content: 'Profile accepted.', toolCallId: currentPending.id },
        {
          role: 'assistant',
          content: goals
            ? 'Profile updated. Let\'s review your goals and training plan next.'
            : 'Profile saved! Now let\'s talk about your training goals.',
        },
      ]
      setMessages(newMessages)
      setToolCard(null)
      setPendingTool(null)
      setToolActivity({ status: 'succeeded', message: 'Your profile was saved.' })

      const savedConv = await persistAcceptedMessages(newMessages, conv, mode)
      if (!savedConv) return
      resetToolRetries()
      await stream(newMessages, savedConv, mode, goals, model, customExercises, newProfile, nextPlan)
    } catch (error: unknown) {
      console.error('[chat] failed to save accepted profile:', error)
      setToolActivity(profileSaved
        ? {
            status: 'partially_succeeded',
            message: 'Your profile was saved, but the training plan could not be marked for review.',
            nextStep: 'Review the current training plan before continuing.',
          }
        : {
            status: 'failed',
            message: "Couldn't save your profile.",
            nextStep: 'Review the proposal and tap Accept again.',
          })
      clearToolRecovery()
    } finally {
      setBusy(false)
    }
  }

  async function acceptTrainingPlan(planPayload: ProposeTrainingPlanPayload) {
    if (!pendingTool || busy) return
    const currentPending = pendingTool
    setBusy(true)
    setToolActivity({ status: 'running', message: 'Saving your training plan...' })
    clearToolRecovery()

    try {
      const now = new Date().toISOString()
      const newPlan = TrainingPlanSchema.parse({
        ...planPayload,
        startDate: planPayload.startDate ?? getToday(),
        status: 'active',
        pendingReview: false,
        createdAt: now,
        updatedAt: now,
      })
      await saveTrainingPlan(newPlan)
      setTrainingPlan(newPlan)

      const nextMode: ConversationType = 'planning'
      const newMessages: Message[] = [
        ...messages,
        { role: 'tool', content: 'Training plan accepted.', toolCallId: currentPending.id },
        {
          role: 'assistant',
          content:
            `Your training plan "${newPlan.name}" is set. I'm now ready to build your workouts. ` +
            'You can ask me anytime to adjust your plan or schedule.',
        },
      ]
      setMessages(newMessages)
      setToolCard(null)
      setPendingTool(null)
      setMode(nextMode)
      setToolActivity({ status: 'succeeded', message: 'Your training plan was saved.' })

      const savedConv = await persistAcceptedMessages(newMessages, conv, nextMode)
      if (!savedConv) return
      resetToolRetries()
      await stream(newMessages, savedConv, nextMode, goals, model, customExercises, profile, newPlan)
    } catch (error: unknown) {
      console.error('[chat] failed to save accepted training plan:', error)
      setToolActivity({
        status: 'failed',
        message: "Couldn't save your training plan.",
        nextStep: 'Review the proposal and tap Accept again.',
      })
      clearToolRecovery()
    } finally {
      setBusy(false)
    }
  }

  async function acceptWorkouts(workouts: ProposeWorkoutsPayload) {
    if (!pendingTool || busy) return
    const currentPending = pendingTool
    let savedThisAttempt = 0
    setBusy(true)
    setToolActivity({ status: 'running', message: 'Saving your workouts...' })
    clearToolRecovery()

    try {
      const now = new Date().toISOString()
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      for (const proposal of workouts) {
        const workoutToSave = WorkoutSchema.parse({ ...proposal, timezone, generatedAt: now })
        await saveWorkout(workoutToSave)
        savedThisAttempt += 1
      }

      const totalSaved = acceptedWorkoutCountRef.current + savedThisAttempt
      const newMessages: Message[] = [
        ...messages,
        { role: 'tool', content: `Workouts accepted and saved (${totalSaved}).`, toolCallId: currentPending.id },
        {
          role: 'assistant',
          content:
            `Saved ${totalSaved} workout${totalSaved === 1 ? '' : 's'} to your plan. ` +
            'You can view them on the **Workouts** tab. Feel free to ask me anytime if you\'d like to make any changes.',
        },
      ]
      setMessages(newMessages)
      setToolCard(null)
      setPendingTool(null)
      setToolActivity({
        status: 'succeeded',
        message: `Saved ${totalSaved} workout${totalSaved === 1 ? '' : 's'} to your plan.`,
      })
      acceptedWorkoutCountRef.current = 0

      const savedConv = await persistAcceptedMessages(newMessages, conv, mode)
      if (!savedConv) return
      resetToolRetries()
      setConv(savedConv)
    } catch (error: unknown) {
      console.error('[chat] failed to save accepted workouts:', error)
      acceptedWorkoutCountRef.current += savedThisAttempt
      const remaining = workouts.slice(savedThisAttempt)
      if (remaining.length > 0) setToolCard({ kind: 'workouts', workouts: remaining })
      setToolActivity(acceptedWorkoutCountRef.current > 0
        ? {
            status: 'partially_succeeded',
            message: `Saved ${acceptedWorkoutCountRef.current} workout${acceptedWorkoutCountRef.current === 1 ? '' : 's'}, but could not save the rest.`,
            nextStep: 'Review the remaining workouts below and tap Accept to retry only those items.',
          }
        : {
            status: 'failed',
            message: "Couldn't save the proposed workouts.",
            nextStep: 'Review the proposal and tap Accept again.',
          })
      clearToolRecovery()
    } finally {
      setBusy(false)
    }
  }

  async function requestChanges(feedback: string) {
    if (!pendingTool) return
    const alreadySaved = acceptedWorkoutCountRef.current
    const toolResult: Message = {
      role: 'tool',
      content: alreadySaved > 0
        ? `User requested changes after ${alreadySaved} workout${alreadySaved === 1 ? '' : 's'} had already been saved. Do not duplicate those workouts.`
        : 'User requested changes.',
      toolCallId: pendingTool.id,
    }
    const newMessages: Message[] = [...messages, toolResult, { role: 'user', content: feedback }]

    setMessages(newMessages)
    setToolCard(null)
    setPendingTool(null)
    setToolActivity(null)
    clearToolRecovery()
    acceptedWorkoutCountRef.current = 0

    const savedConv = await persistConversation(newMessages, conv, mode)
    resetToolRetries()
    await stream(newMessages, savedConv, mode, goals, model, customExercises, profile, trainingPlan)
  }

  function resetAcceptedWorkoutCount() {
    acceptedWorkoutCountRef.current = 0
  }

  return {
    busy,
    acceptGoals,
    acceptProfile,
    acceptTrainingPlan,
    acceptWorkouts,
    requestChanges,
    resetAcceptedWorkoutCount,
  }
}
