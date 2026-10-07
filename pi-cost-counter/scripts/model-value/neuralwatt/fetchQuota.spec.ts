import { describe, expect, it } from 'vitest'
import { quotaBody } from './fetchQuota'

describe('quotaBody', () => {
  it('accepts a well-formed subscription quota', () => {
    const parsed = quotaBody.safeParse({
      subscription: {
        current_period_start: '2026-09-12T04:15:28Z',
        current_period_end: '2026-10-12T04:15:28Z',
        kwh_included: 6.25,
        kwh_used: 3.9549,
        in_overage: false,
      },
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects an unparseable period timestamp', () => {
    const parsed = quotaBody.safeParse({
      subscription: {
        current_period_start: 'not-a-date',
        current_period_end: '2026-10-12T04:15:28Z',
        kwh_included: 6.25,
        kwh_used: 3.9549,
        in_overage: false,
      },
    })

    expect(parsed.success).toBe(false)
  })
})
