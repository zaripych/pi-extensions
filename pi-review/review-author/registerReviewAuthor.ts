import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function registerReviewAuthor(pi: ExtensionAPI) {
  pi.on('resources_discover', () => ({
    skillPaths: [
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../skills/review-author/SKILL.md'
      ),
    ],
  }))
}
