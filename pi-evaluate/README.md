# pi-evaluate

CLI for headless G-Eval evaluations. It scores every input sample against
every matched G-Eval criteria file and writes one JSONL result row per
criterion × sample cell. Model auth comes from the pi coding agent's stored
credentials.

## Usage

```sh
npm run evaluate -- \
  --model <provider/id> \
  --criteria <file-glob> \
  (--input-text <file-glob>|--input-jsonl <file-glob>|--input-text-nul <file-glob>) \
  [--output <file>]
```

## Flags

| Flag               | Meaning                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `--model`          | Required. `provider/id`, e.g. `openai/gpt-5.4-mini`.                                                      |
| `--criteria`       | Required. Path or glob of G-Eval criteria file(s). `AGENTS.md`, `CLAUDE.md`, and `README.md` are ignored. |
| `--input-text`     | Path or glob of text file(s). Each whole file is one text sample.                                         |
| `--input-jsonl`    | Path or glob of JSONL file(s). Each line is one JSON object sample.                                       |
| `--input-text-nul` | Path or glob of file(s) holding NUL-separated text samples.                                               |
| `--output`         | JSONL results path. Default `eval-results.jsonl`.                                                         |
| `--allow-skip`     | Record unmatchable cells as `skipped` instead of erroring.                                                |
| `--max-errors`     | Stop the run once this many error rows are produced. Default 0.                                           |
| `--seed`           | Threaded into the cache key, never sent to the provider. Change it to bypass cached verdicts.             |
| `--dry-run`        | Classify the matrix and report counts without spending tokens.                                            |

Pass exactly one input mode per run. `--criteria` and the input flags are
repeatable, accept globs, and a `!` prefix excludes matches.

## Criteria format

A criteria file is markdown with YAML frontmatter followed by the rubric text
sent to the judge:

```md
---
name: addresses_question
score-range: binary
fields:
  - name: question
  - name: answer
    description: The answer under evaluation
---

Score whether the answer addresses the question.
```

- `score-range` — required. `binary` scores 0 or 1. `triple` scores 0, 1, or 2.
  Scores are normalized to `0..1` in result rows.
- `name` — optional. Names the criterion in result rows. Defaults to the file
  name without its extension.
- `fields` — optional. Declares the record keys the criterion needs, each with
  an optional `description`. A criterion with `fields` evaluates only records
  that supply every declared key, so it needs `--input-jsonl` input. A
  criterion without `fields` evaluates text samples. `sampleId` is reserved
  and must not be declared.

When a criterion cannot match a sample, the cell is an error, or `skipped`
under `--allow-skip`.

## What the judge sees

Each cell sends one prompt built from the criterion body and the sample:

```
You are an evaluator. Judge <input> using <criteria>.

<criteria>
Score whether the answer addresses the question.
</criteria>

<input>
{
  "question": "Why is the sky blue?",
  "answer": "Rayleigh scattering."
}
</input>

Return your verdict as a JSON object with a numeric "score" and a "reason".
The "score" must be an integer: 0 (fail) or 1 (pass).
```

A text sample is inlined verbatim into the `<input>` block. A record sample is
rendered as pretty-printed JSON. The `sampleId` never appears in the prompt.
The closing instruction matches the criterion's `score-range`.

## Input modes and sample ids

- `--input-text` — the `sampleId` is the file path.
- `--input-jsonl` — the `sampleId` is `path#[index]` by line order. A record
  may carry a reserved top-level `sampleId` key with a non-empty string value,
  which becomes the row's `sampleId` instead. The key is stripped from the
  record before hashing and before the judge prompt is rendered, so adding or
  renaming an id never breaks a cache hit. A criterion must not declare
  `sampleId` in its `fields:` frontmatter.
- `--input-text-nul` — samples are separated by the NUL byte `\0`. Within each
  sample, everything up to and including the first newline is the id slot,
  trimmed of surrounding whitespace, and the rest is the sample text, rendered
  verbatim like `--input-text`. An empty id slot falls back to `path#[index]`.
  A trailing NUL separator is allowed.

Supplied ids must be unique across the run. A duplicate fails the run on the
first duplicate encountered. In a NUL stream, a sample without a newline and
an empty segment between separators are errors naming the sample position.

## Streaming samples from a script

All input flags read matched paths as streams, so a collection script can pipe
samples through process substitution without touching disk:

```sh
npm run evaluate -- \
  --model openai/gpt-5.4-mini \
  --criteria './gevals/*.md' \
  --input-text-nul <(./scripts/collect.ts) \
  --output eval-results.jsonl
```

## Caching

Results are cached under `.eval-cache/` at the repo root. The key is
content-addressed on criterion text, sample content, model, and seed, and never
includes a file path, so identical samples hit the same cache entry regardless
of input mode.

## Output

One JSON object per criterion × sample cell with `name`, `sampleId`,
`sampleHash`, `criteriaHash`, `model`, `seed`, and `status`. A `success` row
carries `rubricScore`, `normalizedScore`, and `reason`. A `skipped` or `error`
row carries a `description` instead.
