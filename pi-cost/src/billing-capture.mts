#!/usr/bin/env -S pnpm exec tsx
/**
 * Billing capture CLI: refreshes ~/.cache/pi-billing/capture through the
 * logged-in ChatGPT and Anthropic web sessions in a visible browser window.
 * The browser profile persists in ~/.cache/pi-billing-chrome — log in once,
 * press Enter, and later runs proceed automatically; a Cloudflare challenge
 * is cleared by hand before Enter. Every response is staged in a $TMPDIR
 * artifacts directory first; the capture directory is replaced only when
 * all routes succeed.
 *
 * Usage, from the repo root:
 *   pnpm exec tsx pi-cost/src/billing-capture.mts
 *   ./pi-cost/src/billing-capture.mts --force-refresh
 *   ./pi-cost/src/billing-capture.mts --port 9223
 *
 * --keep-open leaves the browser running after the run for inspection.
 */
import { parseArgs } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { ensureCapture } from './billing-capture/ensureCapture'

async function main(): Promise<void> {
  const now = new Date()
  const { values } = parseArgs({
    options: {
      'force-refresh': { type: 'boolean' },
      'keep-open': { type: 'boolean' },
      port: { type: 'string' },
    },
  })

  const port = values.port ? Number(values.port) : undefined
  if (port !== undefined && !Number.isInteger(port)) {
    throw new Error(`--port must be a number, got "${values.port}"`)
  }

  const result = await ensureCapture({
    now,
    forceRefresh: values['force-refresh'],
    keepOpen: values['keep-open'],
    port,
  })

  // printing a beat late: closing the spawned browser can blank the
  // caller's terminal right after the process exits (kitty redraw on the
  // browser window going away), which erases output printed immediately
  await sleep(1000)

  if (result.ok) {
    console.log(
      `billing capture published — last captured ${result.data.capturedAt.toISOString()}`
    )
    return
  }
  for (const [file, entry] of Object.entries(result.failure.routes)) {
    console.log(file, entry)
  }
  console.error(result.failure.error ?? 'capture failed')
  console.log(`response artifacts: ${result.failure.artifactsPath}`)
  // exitCode, not exit — stdout writes to a pipe are asynchronous and a
  // forced exit would truncate the route and artifact output above
  process.exitCode = 1
}

main().catch((error) => {
  console.error('billing capture failed', { error })
  process.exitCode = 1
})
