# Anthropic TODO

Claude Code findings preserved for future ingestion (from
`refactor-model-value-handoff.md`; not implemented in this MVP).

- Normalize `timestamp`, `sessionId`, `cwd`, `message.model`, and
  `message.usage` into Pi record names.
- Input/output/cache-read/cache-write counts are the primary token
  categories. Thinking and cache-duration breakdowns are not additional
  totals.
- Repeated `(requestId, message.id)` pairs in inspected files had identical
  usage and inflated naive sums. Parent usage and repeated iteration usage
  must not both be counted.
- Inspected files had 83 records / 27 unique pairs and 6 records / 3 unique
  pairs. Deduplicated totals were 3,186,570 and 152,365 tokens, versus
  naive totals of 8,910,202 and 303,497.
- Deduplication must eventually account for copied transcripts, nested
  subagents, and sidechain replay; the observed pairs are not a complete
  specification.
- Cumulative `cost-state.modelUsage` includes usage missing from assistant
  records, including Haiku. It differs from deduplicated message totals and
  lacks per-request timestamps for precise boundary filtering.
- Cumulative state and assistant-message usage are alternative observations,
  not additive sources.
- No billing-provider field was established; model names alone do not
  establish the billing route.
- `costUSD` / `totalCostUSD` is not actual subscription money paid.

Further local evidence and field mappings remain in the handoff.

Known simplifications in the current normalizer:

- Credit consumption counts depletion of tranches granted within the
  current cycle only; depletion of an older tranche spanning the cycle
  boundary cannot be split with the captured evidence.
- The billing cycle is anchored on the latest paid plan invoice; a future
  `anthropic-subscription-details` capture route (`next_charge_date`) would
  give direct renewal evidence instead.
