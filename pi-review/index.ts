import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerReviewAuthor } from './review-author/registerReviewAuthor'
import { registerReviewCommand } from './review-command/register'

export default function (pi: ExtensionAPI) {
  registerReviewAuthor(pi)
  registerReviewCommand(pi)
}
