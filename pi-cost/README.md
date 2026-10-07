# pi Cost

A [pi](https://github.com/earendil-works/pi-coding-agent) extension and CLI
reporting subscription spend, model usage, and value across billing
providers (OpenAI, Anthropic, Neuralwatt).

## Features

- **`/cost` command** — tabbed report in pi: subscription spend per billing
  cycle on the first tab, model value (AA intelligence per AUD/MTok) on the
  second; `m` switches amortized ⇄ consumption cost modes
- **Billing capture** — OpenAI, Anthropic, and Neuralwatt billing evidence
  captured through logged-in browser sessions, refreshed on a 24-hour policy
- **Pi session tokens only** — usage comes from pi's own session records,
  filtered to each provider's current billing cycle

## Installation

### Local

```bash
pi install /path/to/pi-cost
```

### Quick test (temporary, current session only)

```bash
pi -e /path/to/pi-cost
```

After installation, restart pi or run `/reload` to activate.

## Usage

### `/cost` Command

Run `/cost` in pi for the tabbed report:

- **Spend** — per-provider table for the current billing cycle: cycle window,
  Pi-recorded tokens, TOTAL PAID/EXTRA PAID (or TOTAL CONS/EXTRA CONS in
  consumption mode), and usage percentage
- **Model Value** — per-model allocated AUD, AUD/MTok, Artificial Analysis
  intelligence index, and value (AA index per AUD/MTok), sorted
  higher-value first

Keys: `Tab`/`Shift+Tab` switch tab, `m` switches amortized ⇄ consumption
cost modes, `q` closes. Amortized mode reports cash paid in the cycle;
consumption mode reports payment-backed value consumed.

### CLI

The same report is available as a CLI, from the repo root:

```bash
pnpm exec tsx pi-cost/src/model-value.mts
pnpm exec tsx pi-cost/src/model-value.mts --mode consumption
pnpm exec tsx pi-cost/src/model-value.mts --mode amortized --json
```

Billing capture can be refreshed explicitly:

```bash
pnpm exec tsx pi-cost/src/billing-capture.mts
```

## How It Works

- Billing evidence for OpenAI, Anthropic, and Neuralwatt is captured
  through logged-in browser sessions into `~/.cache/pi-billing/capture`,
  refreshed on a 24-hour policy.
- Each provider's current billing cycle, payments, GST/FX treatment, and
  utilization are resolved by a provider normalizer.
- Token usage comes from pi's own session records only, filtered to each
  provider's cycle; four token categories are summed.
- Cost is allocated across models by provider-native attribution where
  available, otherwise by Pi token share; unmatched native shares stay
  unallocated.
- Artificial Analysis intelligence data is cached for 24 hours in
  `~/.cache/pi-billing`. The AA API key is read from the
  `artificialanalysis.ai` entry in `~/.pi/agent/auth.json` or the
  `ARTIFICIAL_ANALYSIS_API_KEY` environment variable.

## License

MIT
