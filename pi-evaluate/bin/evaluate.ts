#!/usr/bin/env -S node --import tsx
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { evaluate } from '../src/evaluate'

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('evaluate')
    .usage(
      '$0 --model <provider/id> --criteria <file> (--input-text|--input-jsonl) <file> [--output <file>]'
    )
    .option('model', {
      type: 'string',
      demandOption: true,
      describe: 'Model id as provider/id, e.g. openai/gpt-5.4-mini',
    })
    .option('criteria', {
      type: 'string',
      demandOption: true,
      describe: 'Path of the G-Eval criterion file',
    })
    .option('input-text', {
      type: 'string',
      describe: 'Path of a file read as one text sample',
    })
    .option('input-jsonl', {
      type: 'string',
      describe: 'Path of a file read as one JSON object per line',
    })
    .option('output', {
      type: 'string',
      default: 'eval-results.jsonl',
      describe: 'Path of the JSONL output file',
    })
    .strict()
    .parseAsync()

  await evaluate({
    model: argv.model,
    criteria: argv.criteria,
    inputText: argv.inputText,
    inputJsonl: argv.inputJsonl,
    output: argv.output,
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
