import { z } from 'zod'

export const PROFILE_SCHEMA_VERSION = 1

export const UserProfileSchema = z.object({
  _v: z.number().default(PROFILE_SCHEMA_VERSION),
  sex: z.enum(['male', 'female']).nullable().default(null),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  availableDays: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(10).max(300).nullable().default(null),
  equipment: z.array(z.string().min(1).max(100)),
  injuries: z.string().max(500).nullable().default(null),
  notes: z.string().max(1000).nullable().default(null),
  updatedAt: z.string().datetime(),
})

export type UserProfile = z.infer<typeof UserProfileSchema>

/** Payload the AI returns in a propose_profile tool call — coerce numbers for model tolerance */
export const ProposeProfilePayloadSchema = z.object({
  sex: z.enum(['male', 'female']).nullable().default(null),
  experience: z.enum(['beginner', 'intermediate', 'advanced']),
  availableDays: z.coerce.number().int().min(1).max(7),
  sessionMinutes: z.coerce.number().int().min(10).max(300).nullable().default(null),
  equipment: z.array(z.string().min(1, 'Equipment item cannot be empty').max(100)),
  injuries: z.string().max(500).nullable().default(null),
  notes: z.string().max(1000).nullable().default(null),
})

export type ProposeProfilePayload = z.infer<typeof ProposeProfilePayloadSchema>

/** Migrate a raw record read from IndexedDB to the current UserProfile shape */
export function migrateProfile(raw: unknown): UserProfile {
  const record = raw as Record<string, unknown>
  if (!record._v) record._v = 1
  return UserProfileSchema.parse(record)
}
