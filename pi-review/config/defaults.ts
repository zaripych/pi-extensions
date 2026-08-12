import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const reviewPromptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'review-prompt.md'
)

const correctnessInstructionsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'instructions',
  'correctness.md'
)

export async function getSystemPromptContent(): Promise<string> {
  return readFile(reviewPromptPath, 'utf-8')
}

export async function getCorrectnessInstructionsContent(): Promise<string> {
  return readFile(correctnessInstructionsPath, 'utf-8')
}
