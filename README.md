# pi Cost Tracker

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that tracks LLM API costs across all sessions. Every API call is logged to a local append-only ledger so you always know what you're spending.

## Features

- **Automatic tracking** — every LLM call is recorded with token counts, cost breakdown, provider, and model
- **Multi-client safe** — uses append-only JSONL files, safe for concurrent writes from multiple pi instances
- **`/cost` command** — view today's cost or a multi-day range with breakdowns by model and provider
- **Zero configuration** — install and go, no API keys or setup required

## Installation

### From npm (recommended)

```bash
pi install npm:@ctogg/pi-cost-counter
```

### From git

```bash
pi install git:github.com/cristeahub/pi-cost-counter
```

### Local

```bash
pi install /path/to/pi-cost-counter
```

### Quick test (temporary, current session only)

```bash
pi -e npm:@ctogg/pi-cost-counter
pi -e /path/to/pi-cost-counter
```

After installation, restart pi or run `/reload` to activate.

## Usage

### `/cost` Command

View cost summaries directly in pi:

```
/cost            Today's total + model breakdown
/cost 7d         Last 7 days
/cost 30d        Last 30 days
/cost 365d       Last year
```

Example output:

```
Cost for last 7 days (2026-04-11 → 2026-04-17)

  Total: $4.82  156.3K tokens · 87 calls

  Daily breakdown
  ────────────────────────────────────────────────────
  2026-04-11  $0.45
  2026-04-12  $1.23
  2026-04-13  —
  2026-04-14  $0.67
  2026-04-15  $0.89
  2026-04-16  $0.34
  2026-04-17  $1.24

  By model
  ────────────────────────────────────────────────────
  anthropic/claude-sonnet-4-5                    $3.41  120.5K tok · 62 calls
  anthropic/claude-haiku-3-5                     $0.89   28.1K tok · 18 calls
  google/gemini-2.5-pro                          $0.52    7.7K tok · 7 calls

```

## Data Storage

Cost records are stored as JSONL (JSON Lines) files, organized by date:

```
~/.pi/cost-tracker/
  2026/
    04/
      17.jsonl
      18.jsonl
    05/
      01.jsonl
```

### Record Format

Each line in a day file is a single JSON object representing one LLM API call:

```json
{
  "ts": 1713369600000,
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tokens": {
    "input": 1200,
    "output": 340,
    "cacheRead": 800,
    "cacheWrite": 0
  },
  "cost": {
    "input": 0.0036,
    "output": 0.0051,
    "cacheRead": 0.0008,
    "cacheWrite": 0,
    "total": 0.0095
  }
}
```

| Field               | Description                                         |
| ------------------- | --------------------------------------------------- |
| `ts`                | Unix timestamp in milliseconds                      |
| `provider`          | API provider (e.g. `anthropic`, `google`, `openai`) |
| `model`             | Model identifier (e.g. `claude-sonnet-4-5`)         |
| `tokens.input`      | Input/prompt tokens                                 |
| `tokens.output`     | Output/completion tokens                            |
| `tokens.cacheRead`  | Tokens served from prompt cache                     |
| `tokens.cacheWrite` | Tokens written to prompt cache                      |
| `cost.input`        | Cost for input tokens (USD)                         |
| `cost.output`       | Cost for output tokens (USD)                        |
| `cost.cacheRead`    | Cost for cache-read tokens (USD)                    |
| `cost.cacheWrite`   | Cost for cache-write tokens (USD)                   |
| `cost.total`        | Total cost for this call (USD)                      |

## Querying Data Outside pi

Since the data is plain JSONL, you can query it with standard tools:

```bash
# Today's total cost
cat ~/.pi/cost-tracker/2026/04/17.jsonl | jq -s 'map(.cost.total) | add'

# Top models this month
cat ~/.pi/cost-tracker/2026/04/*.jsonl | jq -s 'group_by(.model) | map({model: .[0].model, total: map(.cost.total) | add}) | sort_by(-.total)'

# Total spend for April
cat ~/.pi/cost-tracker/2026/04/*.jsonl | jq -s 'map(.cost.total) | add'

# Number of API calls per day this month
for f in ~/.pi/cost-tracker/2026/04/*.jsonl; do
  echo "$(basename $f .jsonl): $(wc -l < $f) calls"
done

# Export to CSV
cat ~/.pi/cost-tracker/2026/04/*.jsonl | jq -r '[.ts, .provider, .model, .cost.total] | @csv'
```

## How It Works

The extension hooks into pi's event system:

1. **`message_end`** — fires after every message (user, assistant, tool result). The handler filters for assistant messages, extracts the `usage` object that pi attaches to every LLM response, and appends a JSONL record to the appropriate day file.

2. **`/cost` command** — reads JSONL files for the requested date range, aggregates by day and by model, and displays a formatted summary.

## Limitations

- **Cost accuracy depends on pi's cost calculation** — the extension records whatever pi reports in the `usage.cost` fields. If a model's pricing is not configured in pi, costs may show as zero even though tokens were consumed.
- **Local timezone** — day boundaries are based on your system's local time.
- **No real-time sync** — the `/cost` command reads files at invocation time. It does not live-update while other pi clients are running. Run it again to see the latest.

## License

MIT
