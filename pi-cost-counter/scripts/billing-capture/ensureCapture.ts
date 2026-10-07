import { capture, type CaptureResult } from './capture'
import { isAbsentError } from './fsIfPresent'
import { loadCapture } from './loadCapture'

const MAX_AGE_MS = 24 * 3_600_000

const defaultDeps = { capture, loadCapture }

export async function ensureCapture(
  params: {
    now: Date
    forceRefresh?: boolean
    port?: number
    keepOpen?: boolean
  },
  deps = defaultDeps
): Promise<
  | { ok: true; data: Awaited<ReturnType<typeof loadCapture>> }
  | { ok: false; failure: CaptureResult }
> {
  if (!params.forceRefresh) {
    let cached: Awaited<ReturnType<typeof loadCapture>> | undefined
    try {
      cached = await deps.loadCapture()
    } catch (error) {
      if (!isAbsentError(error)) {
        console.error('billing capture could not be loaded — refreshing', {
          error,
        })
      }
      cached = undefined
    }
    if (
      cached &&
      params.now.getTime() - cached.capturedAt.getTime() <= MAX_AGE_MS
    ) {
      return { ok: true, data: cached }
    }
  }
  const result = await deps.capture({
    port: params.port,
    keepOpen: params.keepOpen,
  })
  if (!result.ok) return { ok: false, failure: result }
  return { ok: true, data: await deps.loadCapture() }
}

ensureCapture.defaultDeps = defaultDeps
