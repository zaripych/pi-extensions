export type ProviderId = 'openai' | 'anthropic' | 'neuralwatt'

/** Per-provider billing evidence, resolved to the provider's current cycle
 * and AUD amounts, ready for allocation by calculateUsage. */
export type NormalizedProviderBilling = {
  provider: ProviderId

  /** resolved current billing cycle, local day boundaries (YYYY-MM-DD) */
  cycleStart: string
  cycleEnd: string

  /** amortized mode: cash paid within this cycle */
  planPaymentAud: number
  creditPurchasesAud: number

  /** consumption mode: payment-backed value consumed */
  utilization: {
    /** 'whole-cycle': fraction applies to the whole allowance, no time scaling
     * (Neuralwatt charged-energy ratio)
     * 'elapsed': fraction is scaled by the elapsed cycle fraction
     * (Anthropic weekly snapshot proxy, OpenAI daily-reset average) */
    basis: 'whole-cycle' | 'elapsed'
    fraction: number
  }
  creditsConsumedAud: number

  /** per-model usage shares covering ALL usage on the subscription
   * (fractions sum to 1), or null when the provider has none (→ token share) */
  modelShares: Array<{ model: string; share: number }> | null
}
