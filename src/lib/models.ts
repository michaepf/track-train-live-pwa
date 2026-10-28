/**
 * The chat model list.
 *
 * Michael edits config/models.json on `main` in GitHub's web editor. The app
 * reads it from raw.githubusercontent.com at startup (served with CORS and
 * about five minutes of caching), so a change reaches the live site with no
 * code change and no deploy. If the fetch fails or the file is invalid, the
 * built-in list below is used. No capability checks: if a listed model can't
 * handle the app's tool calls, remove it from the file.
 */

import { z } from 'zod'

export const MODELS_CONFIG_URL =
  'https://raw.githubusercontent.com/michaepf/track-train-live-pwa/main/config/models.json'

const FETCH_TIMEOUT_MS = 3000

export const ModelOptionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(100),
  note: z.string().max(200).optional(),
})

export const ModelsConfigSchema = z
  .object({
    default: z.string().trim().min(1),
    models: z.array(ModelOptionSchema).min(1),
  })
  .refine((config) => config.models.some((m) => m.id === config.default), {
    message: 'default must be the id of one of the listed models',
    path: ['default'],
  })
  .refine((config) => new Set(config.models.map((m) => m.id)).size === config.models.length, {
    message: 'model ids must be unique',
    path: ['models'],
  })

export type ModelOption = z.infer<typeof ModelOptionSchema>
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>

/** Used when the remote file can't be fetched or doesn't validate. */
export const BUILT_IN_MODELS_CONFIG: ModelsConfig = {
  default: 'z-ai/glm-5.2:nitro',
  models: [
    { id: 'z-ai/glm-5.2:nitro', label: 'GLM 5.2', note: 'Affordable' },
    { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Premium' },
  ],
}

export type ModelsConfigSource = 'remote' | 'built-in'

export interface LoadedModelsConfig {
  config: ModelsConfig
  source: ModelsConfigSource
}

/** Parse a raw models.json value; null if it doesn't validate. */
export function parseModelsConfig(raw: unknown): ModelsConfig | null {
  const result = ModelsConfigSchema.safeParse(raw)
  return result.success ? result.data : null
}

/** Fetch and validate the remote list, falling back to the built-in one on any failure. */
export async function fetchModelsConfig(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<LoadedModelsConfig> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(MODELS_CONFIG_URL, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const config = parseModelsConfig(await response.json())
    if (!config) throw new Error('config/models.json failed validation')
    return { config, source: 'remote' }
  } catch (err) {
    console.warn('[models] using built-in model list:', String(err))
    return { config: BUILT_IN_MODELS_CONFIG, source: 'built-in' }
  } finally {
    clearTimeout(timer)
  }
}

let startupLoad: Promise<LoadedModelsConfig> | null = null

/** The list for this app session: fetched once, at first use. */
export function loadModelsConfig(): Promise<LoadedModelsConfig> {
  if (!startupLoad) startupLoad = fetchModelsConfig()
  return startupLoad
}

/** Only call this in tests. */
export function _resetModelsConfig(): void {
  startupLoad = null
}

/**
 * The model to use for a saved `model` setting. A saved id that is in the list
 * wins; anything else (unset, removed from the file, or a legacy
 * 'premium'/'affordable' tier value) falls back to the list's default.
 */
export function resolveModelChoice(saved: string | null | undefined, config: ModelsConfig): string {
  if (saved && config.models.some((m) => m.id === saved)) return saved
  return config.default
}
