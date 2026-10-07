import { setTimeout } from 'node:timers/promises'

/** One timer tick per wait: nothing in the test environment races a real
 * delay anymore — the browser close timeout is an abort signal — so waits
 * shrink to the floor. The floor is 1ms rather than 0 to keep a
 * persistently failing evaluate from hot-looping its retries. */
const TEST_SLEEP_MS = 1

export async function setupSleep() {
  return {
    sleep: (ms: number) => setTimeout(Math.min(ms, TEST_SLEEP_MS)),
  }
}
