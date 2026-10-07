# /cost command — output design

The agreed rendering for the `/cost` report, sketched on the whiteboard before
implementation. All examples use a terminal width of 100; lines are indented
two columns inside the border and truncated to the terminal width.

## Frame

A `DynamicBorder` panel with the title in accent + bold:

```
────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Cost — usage and value
```

## Tab bar

Two tabs. The active tab is wrapped in `▍ … ▐` markers and rendered with the
`selectedBg` background, accent foreground, and bold; inactive tabs are dim.
The bar sits directly under the title:

```
 ▍ Spend ▐   Model Value
```

```
   Spend   ▍ Model Value ▐
```

## Spend tab

Per-provider table, right-aligned numeric columns. Column titles switch with
the mode: `TOTAL PAID` / `EXTRA PAID` in amortized, `TOTAL CONS` /
`EXTRA CONS` in consumption.

The `USAGE` column is a 10-cell progress bar plus a percentage right-aligned
in a fixed 6-character field (the `100.0%` worst case), so the bars line up
vertically. The
filled `█` cells show the **remaining** allowance, the used portion is dim
`░`, and both the filled cells and the percentage text use the severity
color derived from the remaining share (more than 50 % remaining → success,
more than 20 % → warning, otherwise error) — the same convention as
`/neuralwatt:quota`.

Amortized:

```
 ▍ Spend ▐   Model Value

 PROVIDER    CYCLE                         TOKENS  TOTAL PAID  EXTRA PAID  USAGE
 openai      2026-09-11 → 2026-10-12  137.80 MTok       81.98       51.98  █████████░  10.2%
 anthropic   2026-09-19 → 2026-10-19    5.05 MTok       78.00       44.00  ██████████   2.0%
 neuralwatt  2026-09-12 → 2026-10-12  497.40 MTok       90.00       15.00  █░░░░░░░░░  87.7%

 total paid this cycle: 249.98 AUD
 total tokens this cycle: 640.25 MTok
```

Consumption:

```
 ▍ Spend ▐   Model Value

 PROVIDER    CYCLE                         TOKENS  TOTAL CONS  EXTRA CONS  USAGE
 openai      2026-09-11 → 2026-10-12  137.80 MTok      100.07       97.42  █████████░  10.2%
 anthropic   2026-09-19 → 2026-10-19    5.05 MTok       13.18       12.76  ██████████   2.0%
 neuralwatt  2026-09-12 → 2026-10-12  497.40 MTok       58.80        0.00  █░░░░░░░░░  87.7%

 total consumed this cycle: 172.05 AUD
 total tokens this cycle: 640.25 MTok
```

Footer lines under the table, plain (not part of the table):

- `total paid this cycle: <sum of paidAud> AUD` or
  `total consumed this cycle: <sum of consAud> AUD` depending on mode.
- `total tokens this cycle: <sum of provider tokens>` — Pi-recorded tokens
  across providers, in compact units.

## Model Value tab

Per-model table, sorted by value descending (infinite first), right-aligned
numeric columns. Missing AA or rate renders as `—`; zero-cost renders as
`∞ (zero-cost)`:

```
   Spend   ▍ Model Value ▐

 MODEL                PROVIDER       TOKENS       AUD   AUD/MTOK  AA IDX  VALUE
 deepseek-v4.1-flash  neuralwatt     3.01 MTok    0.21      0.07      40   578.7
 gpt-6.1-sol          openai        19.95 MTok    2.77      0.14      52   373.4
 glm-5.3              neuralwatt  407.72 MTok   89.64      0.22      45   203.8
 gpt-6-astra          openai        97.14 MTok   74.14      0.76      53    69.1
 claude-opus-5-5      anthropic     4.61 MTok   71.21     15.45      58    3.7
```

## Key map

The bottom line inside the border holds every action, including the current
mode. The hint text is dim; the current mode value next to `m` is accent so
it stands out from the rest of the line:

```
 Tab/Shift+Tab switch tab · m switch mode (amortized) · q close
```

```
 Tab/Shift+Tab switch tab · m switch mode (consumption) · q close
```

Loading and error states show only `q close`.

| Key         | Action                              |
| ----------- | ----------------------------------- |
| `Tab`       | next tab                            |
| `Shift+Tab` | previous tab                        |
| `m`         | amortized ⇄ consumption (re-render) |
| `q` / `Esc` | close                               |

## Styling

| Element                | Style                                        |
| ---------------------- | -------------------------------------------- |
| Border                 | `theme.fg('border', …)`                      |
| Title                  | accent + bold                                |
| Active tab             | `selectedBg` background, accent, bold, `▍ ▐` |
| Inactive tab           | dim                                          |
| Table header           | dim                                          |
| Table cells            | default foreground                           |
| Usage bar filled cells | severity color of the remaining share        |
| Usage bar used cells   | dim `░`                                      |
| Usage percentage       | severity color of the remaining share        |
| Footer totals          | default foreground, labels default           |
| Key map hints          | dim                                          |
| Current mode value     | accent                                       |
| Error line             | error                                        |
| Loading                | `Loader` (accent/muted)                      |

## Differences from the current implementation

1. Tab bar: add the `▍ … ▐` active markers; drop the leading extra space on
   the inactive tab so the bar starts at column 3.
2. Mode line: remove it from the top; the current mode moves into the key
   map next to the `m` shortcut, colored accent against the dim hints.
3. Spend tab: add the `total paid/consumed this cycle` footer line.
4. Usage column: replace the bare percentage with the progress bar plus
   percentage, severity-colored by remaining share.
5. Key map: use `·` separators.
