# pi-evaluate — Product Requirements Document

## Summary

`pi-evaluate` is a standalone CLI that runs **G-Eval** evaluations: single-shot,
LLM-as-judge scoring of one or more **samples** against one or more authored
**G-Eval criteria**, with a transparent result cache. It is designed to be run
headless and composed in shell pipelines.

North-star use case: **evaluate LLM-generated plans for correctness.**

Canonical invocation:

```sh
# standalone CLI (model passed explicitly; process substitution supported)
evaluate --model openai/gpt-5.4-mini --criteria './criteria/*.md' --input-jsonl <(jq ...) --output ./eval-results.jsonl
```

> **Pivot — input is file-based, never piped stdin.** Source flags name a file
> path (or a `<(...)` process substitution): `--input-text` / `--input-jsonl`,
> with the format in the flag name so extensionless `/dev/fd/N` paths work.

> **Pivot — CLI-only delivery.** An earlier design also exposed this as a `pi`
> extension with a `/evaluate` command; that surface was dropped in favor of a
> single standalone CLI. The model is always passed explicitly as
> `--model provider/id` and resolved through pi's model registry + auth storage.
> The CLI builds a single-shot structured-output request and injects it into the
> framework-independent core.

## Goals

- As simple as possible: one metric type (G-Eval), done well, integrated with `pi`.
- Deterministic, inspectable result cache so repeated runs don't re-spend tokens.
- Provider-agnostic (works with any model in `pi`'s registry, including Anthropic).
- Shape-safe: a sample is only ever judged by criteria it actually matches.

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
- **No multi-call chaining.** Each `(criterion × sample)` is exactly one
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
    sample fields this criterion consumes; the body references them. Omitting
    `fields` makes the criterion evaluate the entire sample.
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

### sample

A record of named field values supplying content for one evaluation. Supplied as
a JSON object (one per JSONL line) or as a raw text blob.

## Scoring engine

```
input + output-schema + model + seed  ->  LLM  ->  { reason, score }
```

- **Single inference call.** Structured output `{ reason, score }`. The model
  walks the authored steps via its own internal chain-of-thought.
- **`input`** = the assembled prompt (criterion body + sample field values).
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

- Source is **mutually exclusive**: `--input-text <file>` XOR
  `--input-jsonl <file>`. Each names a file path or a `<(...)` process
  substitution; piped stdin is not a source (see Pivot above).
- **JSONL** (`--input-jsonl <file>`): one sample (JSON object) per line.
  **N lines = N samples.** No JSON-array form (avoids object-vs-array
  sniffing).
- **Text** (`--input-text <file>`): the whole blob is one sample.
- `--criteria <glob>`: one or more criterion `.md` files.
- **Execution:** the full **N×M matrix** — every sample × every criterion.

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
  one row per completed `(criterion × sample [× seed])` cell, flushed as it
  completes. No special stdout handling (see Appendix: SDK spike).
- **Row schema:**

  | field           | meaning                                         |
  | --------------- | ----------------------------------------------- |
  | `name`          | criterion `name` or file name                   |
  | `score`         | normalized to `[0,1]`                           |
  | `reason`        | judge-generated reasoning                       |
  | `sample`        | locator: `./file.jsonl#[0]` or `./text.txt`     |
  | `sample-hash`   | `hash(sample)[:7]`                              |
  | `criteria-hash` | `hash(criterion)[:7]`                           |
  | `model`         | judge model used                                |
  | `seed`          | seed used (distinguishes multiple-opinion rows) |

- The two 7-char hashes are **analysis/diff aids** (spot which samples /
  criteria changed between runs) — **not** the cache key.

## Model selection

- The model is passed explicitly as `--model provider/id` and resolved through
  `ModelRegistry` + `AuthStorage`. There is no other provider configuration.

## Delivery / packaging

A framework-independent core (`evaluate`) reached through a single standalone CLI
adapter that builds a structured-output request and hands it to the core:

- A **standalone CLI** (`bin/evaluate.ts`, `node --import tsx`) exposing the
  flags `--model`, `--criteria`, `--input-text`, `--input-jsonl`, `--output`,
  resolving the model from the registry itself and injecting the single-shot
  request into the core.
- Headless usage relies on direct CLI invocation; it does not read piped stdin
  as a sample source.

## Open / deferred

- **Raw-stdout output mode** — emitting result rows on stdout instead of a file.
  Deferred; file output is the v1 contract.
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
  `pi.getFlag(name)`. `-p` print mode reads piped stdin and **merges it into the
  prompt** — so an extension cannot use piped stdin as a sample source, and
  source input must be file-based (`--input-text` / `--input-jsonl`). This
  constraint (plus the dropped extension surface) is why source input is
  file-based in the CLI.
- **Slash-command flags must be real pi CLI flags.** `pi --criteria … -p
"/evaluate"` reaches `getFlag`; flags typed inside the `/evaluate …` argument
  string do not.
- **`node --import tsx`, not the `tsx` CLI**, for the standalone bin: the `tsx`
  CLI respawns a child process and drops `<(...)` process-substitution fds.
- **No clean raw-stdout channel for extensions.** The command handler returns
  `void`; output APIs (`ctx.ui.notify`, `pi.sendMessage`) route through pi's
  message/print layer, and `-p` also prints pi's own response on stdout. An
  extension is plain Node so `fs` file output is fully under its control — hence
  file-based JSONL output for v1.
- **Vercel AI SDK comparison (experiment, removed): no measurable latency win.**
  A throwaway spike wired `generateObject` and then `generateText` from the
  Vercel AI SDK behind a flag and ran them against `openai/gpt-5.4-mini` and
  `anthropic/claude-sonnet-4-6`, sharing pi's model/auth resolution. Findings:
  (1) **structured output is not measurably slower** than free-text generation —
  the long-standing "structured outputs are slow" claim did not reproduce; and
  (2) **pi-ai's `onPayload` structured-output path adds no meaningful latency**
  over the AI SDK. Conclusion: stay on `pi-ai` with provider-native structured
  output via `onPayload` (no extra dependency, keeps the model registry / auth /
  multi-provider abstraction). The AI SDK dependency and scaffolding were removed.
