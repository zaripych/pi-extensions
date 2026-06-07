# pi-evaluate implementation plan

## Goal

`pi-evaluate` is a CLI that runs headless **G-Eval** evaluations: one or more **samples** are evaluated against one or more authored **G-Eval criteria**, producing inspectable JSONL result rows and a deterministic result cache so repeated runs do not re-spend tokens for the same evaluated cell.

## Actors and interface

- **Operator** interacts through the standalone `evaluate` CLI, the flags
  `--model`, `--criteria`, `--input-text`, `--input-jsonl`, `--output`,
  `--allow-skip`, `--max-errors`, `--dry-run`, sample files (or `<(...)` process
  substitutions), the output JSONL file (whose rows carry a `status`), process
  status/error output, and `.eval-cache` at the repo root.
- **Calling system** consumes the output JSONL file, row schema, and process exit status from shell pipelines or downstream scripts.

## Delivery

`pi-evaluate` is a single standalone CLI; there is no other delivery surface, and
every behavior below is observed through it. Input is always **file-based, never
piped stdin**: source flags name a file path or a `<(...)` process substitution
(`--input-text` / `--input-jsonl`).

## Non-goals

- Other metric types besides **G-Eval** are not included.
- Agentic, repo-grounded evaluation with evaluator tools is not included.
- Logprobs or probability-weighted scoring are not included.
- LLM step-generation is not included; evaluation steps are authored in the criterion body.
- Multi-call chaining is not included; each `(criterion × sample)` cell produces one verdict.
- Pass/fail thresholding is not included; downstream consumers decide thresholds.
- Whole-run abort on a single sample/criterion shape mismatch is not included; mismatches are per-cell `skipped`/`error` rows (criterion-metadata validation still aborts up front). See `docs/adr/0001`.
- Raw-stdout output mode is deferred; file-based JSONL output is the v1 contract.
- Self-consistency aggregation is deferred.
- Non-default seed selection is not specified in the PRD and is not added here.

## Glossary

- **G-Eval** — single-shot, LLM-as-evaluator scoring against an authored criterion.
- **G-Eval criterion** — a markdown file with YAML frontmatter and a body containing the authored evaluation procedure.
- **sample** — one record of content supplied for evaluation, either a JSON object from JSONL or one raw text blob.
- **score-range** — the criterion scoring scale, either `binary` (`{0,1}`) or `triple` (`{0,1,2}`).
- **fields** — the named sample values a criterion declares it consumes.
- **cell** — one `(criterion × sample)` evaluation, distinguished by `seed` when multiple opinions are supported.
- **seed** — the value that distinguishes independent verdicts for the same cell; v1 rows use the default `0`.
- **result cache** — the transparent cache keyed by sample content, criterion content, output schema, model, and seed.
- **normalized score** — the output score mapped to `[0,1]`: `binary` stays `{0,1}` and `triple` becomes `{0,0.5,1}`.
- **status** — the outcome recorded on every result row: `success`, `skipped`, or `error`.
- **success** — a cell whose criterion applied to its sample and produced a verdict.
- **skipped** — a cell whose criterion could not be applied (a declared field is absent from the sample) when `--allow-skip` permits it; no tokens are spent and the exit status stays successful.
- **error** — a cell that could not be applied without `--allow-skip`, or that failed at evaluation time (model request failed); errors count toward `--max-errors`.
- **unmatchable cell** — a `(criterion × sample)` pairing where the criterion declares a field the sample does not supply.

## Build conventions (apply across all phases)

This section is the one place that prescribes the development and testing
approach. The behavior-only / no-implementation-detail rule applies to the phase
behaviors below, not to these conventions; naming the test approach here is
intentional.

- The existence of the plan below doesn't lock in technical decisions that
  still have to be made by the developer, NOT YOU. Do not skip "technical decisions" planning phase and communicate clearly how the behaviors are to be implemented as there are multitude ways of how things can be implemented.
- No stubs, no `TODO` branches, no "implement later" code. If a behavior is not
  in the current phase, the surface that would expose it does not exist yet.
- Implementation is driven test-first: each behavior below becomes one or more
  RED→GREEN cycles, in vertical slices (never all tests then all code). Tests
  verify observable behavior through public interfaces, never implementation
  detail. (If the `tdd` skill is already active or explicitly requested, use it
  for the red-green mechanics.)
- Phase 0 establishes end-to-end test infrastructure that exercises as many
  layers as possible through the public interface. Every later behavior extends
  the shared test library using that same infrastructure rather than building
  its own.
- Keep one integration test file while it stays under 1000 lines. Once it
  crosses that, split it into multiple pillars/slices — the split becomes
  clearer as more phases are done.
- The phase behaviors below name no internal files, classes, functions,
  libraries, tests, or data structures — the developer chooses all of these.
  They may name the public interface the actor touches (see Actors and interface
  above); when the actor is a developer consuming a library/SDK, that includes
  the exported API. The plan changes only when a core observable behavior pivots.

## Implementation plan

Phases are vertical slices: every behavior in a phase is reachable through a
real user action or observable outcome by the end of that phase. Phases are
ordered risk-first, then value-later, and are sized to roughly equal effort.

### Phase 0 — Tracer bullet

Prove the command can receive input, obtain one verdict, and write one consumable result row.

- When the operator runs `evaluate --model <provider/id> --criteria <single criterion with no fields defined> --input-jsonl <file with one JSON object> --output <file>`, the output file receives exactly one JSONL row with a numeric `score` and non-empty `reason`.
- When the operator runs `evaluate` without `--criteria`, the run exits unsuccessfully with a clear error and no result row is written.

### Phase 1 — Shape-safe criteria and per-cell status

Validate criteria up front, and classify every `(criterion × sample)` cell into a `status` of `success`, `skipped`, or `error` instead of aborting the whole run on a shape mismatch.

- When a criterion omits `score-range` or sets it to an unsupported value, the run exits unsuccessfully with a clear error and no result row is written (criterion validation happens before any cell is evaluated or any token is spent).
- When a criterion declares `fields` and a JSONL sample contains every declared key, the output file receives a result row for that cell with `status` `success`, a numeric `score`, and a non-empty `reason`.
- When a criterion declares `fields` and a JSONL sample supplies an empty value for a declared key, the cell still completes with `status` `success` — key presence, not value content, is what is required.
- When a criterion declares `fields` and a JSONL sample is missing any declared key, that cell is unmatchable: with no `--allow-skip` its result row carries `status` `error`, and because the default error tolerance is zero it stops the run and exits unsuccessfully.
- When the operator passes `--allow-skip`, an unmatchable cell instead produces a result row with `status` `skipped`, the run continues, and the run exits successfully.
- When a cell fails at evaluation time (the model request fails), its result row carries `status` `error` and is counted the same as a shape mismatch.
- When the operator passes `--max-errors <n>`, the run keeps producing rows until the nth `error` row, at which point it stops and exits unsuccessfully; with fewer than `n` errors it runs to completion and exits successfully (the default is `0`, i.e. fail on the first error).
- When the operator passes `--dry-run`, the run reports how many cells are `success`-eligible, `skipped`, or `error` without spending any evaluation tokens and without producing a judge verdict.

### Phase 2 — Source modes and source validation

Cover every supported input source and reject ambiguous or malformed source input.

- When the operator supplies `--input-jsonl <file>`, each JSON object line in the file is treated as one sample.
- When the operator supplies `--input-text <file>`, the whole file is treated as one sample.
- When the operator supplies both `--input-text` and `--input-jsonl`, the run exits unsuccessfully with a clear error and no result row is written.
- When JSONL input is not one JSON object per line, including a JSON array form, the run exits unsuccessfully with a clear error instead of silent shape guessing.
- When a text sample is paired with a criterion that declares `fields`, that single cell is unmatchable and follows the Phase 1 `status` rules: `status` `error` by default (failing the run under the default zero error tolerance) or `status` `skipped` under `--allow-skip`, with no evaluation tokens spent on it.

### Phase 3 — Criteria selection, matrix execution, and sample identity

Make the full `N×M matrix` visible in output and give every row a stable sample locator.

- When the operator supplies `--criteria <glob>` matching multiple criterion files, every matched criterion participates in the evaluation matrix.
- When `--criteria <glob>` matches no criterion files, the run exits unsuccessfully with a clear error and no result rows are written.
- When the operator supplies `N` JSONL samples and `M` criteria, the output contains one result row for every `sample × criterion` cell, each carrying its `status` (`success`, `skipped`, or `error`).
- When samples are read from `--input-jsonl <file>`, each output row records its `sampleId` as `<file>#[n]`.
- When a sample is read from `--input-text <file>`, each output row records the file path as its `sampleId`.

### Phase 4 — Scoring and row contract

Make scores, reasons, model identity, seed identity, and row shape reliable for downstream consumers.

- When a calling system reads result rows from any supported source mode or matrix size, every row carries `status`, `name`, `sampleId`, `sampleHash`, `criteriaHash`, `model`, and `seed`; a `success` row additionally carries `score` and `reason` (the verdict), while a `skipped` or `error` row instead carries `description` (the cause) and no `score` or `reason`.
- When a criterion has no `name`, result rows use the criterion file name as `name`; when the criterion has a `name`, result rows use that value.
- When a `binary` criterion is evaluated, the output `score` is the normalized score and is either `0` or `1`.
- When a `triple` criterion is evaluated, the output `score` is the normalized score and is one of `0`, `0.5`, or `1`.
- When a cell completes, the output `reason` contains the evaluator-generated reasoning for that verdict.
- When the operator passes `--model <provider/id>`, the CLI uses the already-configured credentials for that provider, with no extra provider-specific flags or configuration.
- When the operator passes `--model <provider/id>`, every output row identifies that model.
- When a cell completes, every output row identifies `seed` as `0`.

### Phase 5 — Transparent result cache

Make repeated runs deterministic at the cache layer while keeping cache behavior transparent to the operator.

- When a `success` cell completes for the first time, the operator can inspect a corresponding `.eval-cache/<hash>/result.json` entry at the repo root; `skipped` and `error` cells spend no tokens and are not cached.
- When the same sample content, criterion content, output schema, model, and seed are evaluated again, the output row repeats the cached `score` and `reason` for that cell.
- When the sample content, criterion content, output schema, model, or seed changes, the run uses a distinct cache result for the changed cell.
- When a run uses cached results and uncached results together, the output file contains the same row shape for both; cache hit versus miss does not require a separate skip or resume mode.

### Phase 6 — Headless output ergonomics

Make the command predictable in shell pipelines and during interrupted or repeated runs.

- When the operator omits `--output`, result rows are written to `./eval-results.jsonl`.
- When the operator supplies `--output <file>`, result rows are appended to that file instead of replacing existing rows.
- When cells are produced during a run, each row (`success`, `skipped`, or `error`) is flushed to the output file as it is produced, so a later interruption — or a `--max-errors` stop — still leaves the already-flushed rows available to downstream consumers.
- When the operator runs the CLI in a shell pipeline, the v1 result contract remains the output file rather than raw JSON on stdout.
- When a calling system reads result rows, the `sampleHash` and `criteriaHash` values allow it to spot changed samples and criteria across runs.
