import { z } from 'zod'

export const CONVERSATION_SCHEMA_VERSION = 1

/**
 * A single message in a conversation thread.
 * Mirrors the OpenRouter/OpenAI message format closely so threads can be
 * passed directly to the API without transformation.
 */
export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string(),
  // Present on tool messages — links the result back to the tool call
  toolCallId: z.string().optional(),
  // Present on assistant messages that include a tool call
  toolCall: z
    .object({
      id: z.string(),
      name: z.string(),
      arguments: z.string(), // raw JSON string from the model
    })
    .optional(),
})

export type Message = z.infer<typeof MessageSchema>

export const ConversationTypeSchema = z.enum([
  'onboarding',   // first-launch goal establishment
  'goal_review',  // periodic or user-triggered goal review
  'planning',     // workout planning
])

export type ConversationType = z.infer<typeof ConversationTypeSchema>

export const ConversationSchema = z.object({
  _v: z.number().default(CONVERSATION_SCHEMA_VERSION),
  // id is assigned by IndexedDB auto-increment; absent before first save
  id: z.number().int().positive().optional(),
  type: ConversationTypeSchema,
  messages: z.array(MessageSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type Conversation = z.infer<typeof ConversationSchema>

/** Migrate a raw record read from IndexedDB to the current Conversation shape */
export function migrateConversation(raw: unknown): Conversation {
  const record = raw as Record<string, unknown>
  // v0 → v1: no structural changes; just ensure _v is set
  if (!record._v) record._v = 1
  return ConversationSchema.parse(record)
}
