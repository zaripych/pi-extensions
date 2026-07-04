import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const reviewPromptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  'review-prompt.md'
)

export async function getDefaultSystemPromptContent(): Promise<string> {
  return readFile(reviewPromptPath, 'utf-8')
}
