#!/usr/bin/env -S node --import tsx
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { evaluate } from '../src/evaluate'

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('evaluate')
    .usage(
      '$0 --model <provider/id> --criteria <file-glob> (--input-text <file-glob>|--input-jsonl <file-glob>|--input-text-nul <file-glob>) [--output <file>]'
    )
    .option('model', {
      type: 'string',
      demandOption: true,
      describe: 'Model id as provider/id, e.g. openai/gpt-5.4-mini',
    })
    .option('criteria', {
      type: 'string',
      array: true,
      demandOption: true,
      describe:
        "Path or glob of the G-Eval criteria file(s). Repeat to pass several patterns; prefix a pattern with '!' to exclude. AGENTS.md, CLAUDE.md and README.md are ignored by default. e.g. --criteria './gevals/*.md' --criteria '!./gevals/draft-*.md'",
    })
    .option('input-text', {
      type: 'string',
      array: true,
      describe:
        "Path or glob of text file(s), each read as one text sample. Repeat to pass several patterns; prefix a pattern with '!' to exclude. e.g. --input-text './samples/*.md' --input-text '!./samples/skip.md'",
    })

    .option('input-jsonl', {
      type: 'string',
      array: true,
      describe:
        "Path or glob of JSONL file(s), each line read as one JSON object sample. A record may carry a reserved sampleId key naming its result rows. Repeat to pass several patterns; prefix a pattern with '!' to exclude.",
    })
    .option('input-text-nul', {
      type: 'string',
      array: true,
      describe:
        "Path or glob of file(s) containing NUL-separated text samples; in each sample the first line is an optional id and the rest is the text. Works with process substitution, e.g. --input-text-nul <(collect.ts). Repeat to pass several patterns; prefix a pattern with '!' to exclude.",
    })
    .option('output', {
      type: 'string',
      default: 'eval-results.jsonl',
      describe: 'Path of the JSONL output file',
    })
    .option('allow-skip', {
      type: 'boolean',
      default: false,
      describe: 'Record unmatchable cells as skipped instead of error',
    })
    .option('max-errors', {
      type: 'number',
      default: 0,
      describe: 'Stop the run once this many error rows are produced',
    })
    .option('seed', {
      type: 'number',
      default: 0,
      describe:
        'Threaded into the result cache key, never sent to the provider; change it to bypass cached verdicts and get a fresh judgment',
    })
    .option('dry-run', {
      type: 'boolean',
      default: false,
      describe: 'Classify the matrix and report counts without spending tokens',
    })
    .strict()
    .parseAsync()

  const controller = new AbortController()
  process.on('SIGINT', () => controller.abort())

  const summary = await evaluate({
    model: argv.model,
    criteria: argv.criteria,
    inputText: argv.inputText,
    inputJsonl: argv.inputJsonl,
    inputTextNul: argv.inputTextNul,
    output: argv.output,
    allowSkip: argv.allowSkip,
    maxErrors: argv.maxErrors,
    seed: argv.seed,
    dryRun: argv.dryRun,
    signal: controller.signal,
  })

  if (argv.dryRun) {
    process.stdout.write(
      `success-eligible: ${summary.counts.success}, skipped: ${summary.counts.skipped}, error: ${summary.counts.error}, cache-hit: ${summary.cacheCounts.hit}, cache-miss: ${summary.cacheCounts.miss}\n`
    )
  }

  const exitCodeByOutcome = { completed: 0, failed: 1, aborted: 130 } as const
  process.exitCode = exitCodeByOutcome[summary.outcome]
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
