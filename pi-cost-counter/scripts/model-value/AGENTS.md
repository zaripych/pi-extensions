# model-value

## Goals

- Report subscription cost, Pi session token usage, and Artificial Analysis
  intelligence per billing provider and model, from each provider's current
  billing cycle. `calculateUsage.ts` is the sole calculation entry point;
  provider normalizers resolve cycles, payments, and utilization.

## Non-goals

- Resolving pi credential expressions in auth-file keys. A `key` that uses
  pi's supported `$ENV_VAR` or `!command` syntax is read as a literal and
  sent as-is; `providerAuth.ts` and `artificial-analysis/fetchAaPages.ts`
  store the resolved value directly in `~/.pi/agent/auth.json` instead.
  Reusing pi's resolution requires a registered runtime provider, which
  does not exist for these endpoints.
