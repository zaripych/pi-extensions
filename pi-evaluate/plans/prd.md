# pi-evaluate — Product Requirements Document

## Summary

`pi-evaluate` is a `pi` extension that runs **G-Eval** evaluations: single-shot,
LLM-as-judge scoring of one or more **test-cases** against one or more authored
**G-Eval criteria**, with a transparent result cache. It is designed to be run
headless and composed in shell pipelines.

North-star use case: **evaluate LLM-generated plans for correctness.**

Canonical invocation:

```sh
process-data | jq ... | pi -p "/evaluate" --stdin-jsonl --criteria './criteria/*.md' --output ./eval-results.jsonl
```

## Goals

- As simple as possible: one metric type (G-Eval), done well, integrated with `pi`.
- Deterministic, inspectable result cache so repeated runs don't re-spend tokens.
- Provider-agnostic (works with any model in `pi`'s registry, including Anthropic).
- Shape-safe: a test-case is only ever judged by criteria it actually matches.

## Non-goals (explicit scope boundaries)

- **Only G-Eval.** Other metric types (faithfulness, answer-relevancy, etc.)
  stay in DeepEval; script those there.
- **No evaluator tools.** Agentic, repo-grounded evaluation lives in `pi-review`.
  `pi-evaluate` is a single inference call with no tool loop.
- **No logprobs / probability-weighted scoring.** Unavailable through `pi-ai`
  (no surface to read token logprobs) and not exposed by Anthropic. Scores are
  discrete integers. (See Appendix: SDK spike.)
- **No LLM step-generation.** Evaluation steps are authored by hand in the
  criterion body. The tool never generates steps at eval time.
- **No multi-call chaining.** Each `(criterion × test-case)` is exactly one
  inference call; the model does multi-step reasoning internally.
- **No pass/fail threshold.** The tool emits the score; thresholding is a
  downstream consumer concern.

## Core concepts

### G-Eval criterion

A markdown file = YAML frontmatter + body.

- **Frontmatter:**
  - `name` — optional; defaults to the file name.
  - `score-range` — `binary` (`{0,1}`) or `triple` (`{0,1,2}`).
  - `fields` — optional list of `{ name, description }`. Declares which named
    test-case fields this criterion consumes; the body references them. Omitting
    `fields` makes the criterion evaluate the entire test-case.
- **Body:** the authored evaluation procedure (rubric, level definitions,
  red-flags) — i.e. the step-by-step reasoning instructions, referencing the
  declared fields. Injected verbatim into the single judge prompt.

Example:

```md
---
name: singular_focus
score-range: triple
fields:
  - name: criterion_text
    description: |
      The G-Eval criterion under review.
---

### SINGULAR FOCUS

Does the criterion evaluate ONE coherent quality dimension?
**Score 0:** ...
**Score 1:** ...
**Score 2:** ...
```

### test-case

A record of named field values supplying content for one evaluation. Supplied as
a JSON object (one per JSONL line) or as a raw text blob.

## Scoring engine

```
input + output-schema + model + seed  ->  LLM  ->  { reason, score }
```

- **Single inference call.** Structured output `{ reason, score }`. The model
  walks the authored steps via its own internal chain-of-thought.
- **`input`** = the assembled prompt (criterion body + test-case field values).
- **`score`** = integer in the criterion's range; **normalized to `[0,1]`** in
  output: `binary {0,1}→{0,1}`, `triple {0,1,2}→{0,0.5,1}`.
- **`reason`** = the judge's generated reasoning.
- **Determinism caveat:** thinking models are not bit-reproducible and ignore
  temperature. "Same inputs → same result" is a guarantee of the **cache layer**,
  not of the model.

### seed

- Default `0`.
- **Only purpose:** multiple opinions — run the same cell at different seeds to
  get N independent verdicts. Not a model-determinism guarantee; effectively
  opt-in self-consistency. Each seed produces its own output row.

## Input

- Source is **mutually exclusive**: `--target <file>` XOR
  `--stdin-jsonl` / `--stdin-text`.
- **JSONL** (`--stdin-jsonl`, or `--target file.jsonl`): one test-case (JSON
  object) per line. **N lines = N test-cases.** No JSON-array form (avoids
  object-vs-array sniffing).
- **Text** (`--stdin-text`, or `--target file.txt`): the whole blob is one
  test-case.
- `--criteria <glob>`: one or more criterion `.md` files.
- **Execution:** the full **N×M matrix** — every test-case × every criterion.

### Field validation (before any LLM call)

| input ↓ / criterion → | declares 0 fields          | declares ≥1 fields                         |
| --------------------- | -------------------------- | ------------------------------------------ |
| **text**              | run against the whole blob | **error** (text can't supply named fields) |
| **jsonl**             | run against the whole line | every declared field must be present¹      |

¹ Field value may be empty, but the key must be present; a missing declared
field is a **hard error before any LLM call** — no token churn on inputs that
don't match the criterion's expected shape. Different shapes → different criteria.

## Caching

- A **transparent read-or-compute wrapper** around the LLM request. Every cell
  goes through it; hit vs miss is opaque to the caller. No skip/resume logic.
- **Key** = `hash(input + output-schema + model + seed)`. Because the
  `output-schema` is part of the key, changing the result schema busts the cache
  automatically.
- **Storage:** `.eval-cache/<hash>/result.json` at the **repo root**
  (survives package-manager reinstalls; gitignore it).

## Output

- **JSONL** appended to the `--output` file (default `./eval-results.jsonl`),
  one row per completed `(criterion × test-case [× seed])` cell, flushed as it
  completes. No special stdout handling (see Appendix: SDK spike).
- **Row schema:**

  | field            | meaning                                                             |
  | ---------------- | ------------------------------------------------------------------- |
  | `name`           | criterion `name` or file name                                       |
  | `score`          | normalized to `[0,1]`                                               |
  | `reason`         | judge-generated reasoning                                           |
  | `test-case`      | locator: `./file.jsonl#[0]`, stdin index `0`/`1`/…, or `./text.txt` |
  | `test-case-hash` | `hash(test-case)[:7]`                                               |
  | `criteria-hash`  | `hash(criterion)[:7]`                                               |
  | `model`          | judge model used                                                    |
  | `seed`           | seed used (distinguishes multiple-opinion rows)                     |

- The two 7-char hashes are **analysis/diff aids** (spot which test-cases /
  criteria changed between runs) — **not** the cache key.

## Model selection

- Selected **only by `pi` input** (the running session model, `ctx.model`).
  There is no separate `--model` flag; `pi -p` already chooses the model.

## CLI / packaging

- A `pi` **extension** (workspace package `pi-evaluate`, `index.ts` exporting the
  extension factory), registering:
  - command **`/evaluate`** (`pi.registerCommand`)
  - flags (`pi.registerFlag` / `pi.getFlag`): `--criteria`, `--target`,
    `--stdin-jsonl`, `--stdin-text`, `--output`
- Headless usage relies on `pi -p` print mode, which reads piped stdin.

## Open / deferred

- **Raw-stdout output mode** — needs a runtime spike of `pi -p` to confirm an
  extension can emit clean JSON on stdout without colliding with pi's own print
  output. Deferred; file output is the v1 contract.
- **Self-consistency aggregation** — the row schema already supports N opinions
  via per-seed rows; combining them into a single verdict is deferred.

## Appendix: SDK spike findings

- **No logprobs anywhere in `pi-ai`.** `grep -rin logprob` over the dist returns
  zero hits. `StreamOptions` has no `logprobs`/`top_logprobs`; `onResponse`
  exposes only `{ status, headers }` (not the body); the stream parser yields
  only `TextContent | ThinkingContent | ToolCall` and the final
  `AssistantMessage` carries no token-level data. Getting logprobs would require
  bypassing `pi-ai` with a direct-HTTP client — abandoning the model registry,
  auth, and multi-provider abstraction — and still wouldn't work on Anthropic.
- **Extensions can register CLI flags and commands:** `pi.registerCommand`,
  `pi.registerFlag(name, { type: 'boolean' | 'string', default })`,
  `pi.getFlag(name)`. `-p` print mode reads piped stdin and merges it into the
  prompt.
- **No clean raw-stdout channel for extensions.** The command handler returns
  `void`; output APIs (`ctx.ui.notify`, `pi.sendMessage`) route through pi's
  message/print layer, and `-p` also prints pi's own response on stdout. An
  extension is plain Node so `fs` file output is fully under its control — hence
  file-based JSONL output for v1.
