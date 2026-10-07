import { setTimeout } from 'node:timers/promises'

/** node:timers/promises setTimeout narrowed to the bare delay — the
 * value-carrying generic overloads would leak into every deps type. */
export function sleep(ms: number): Promise<void> {
  return setTimeout(ms)
}
