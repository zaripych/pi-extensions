import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerReviewCommand } from './review-command/register'

export default function (pi: ExtensionAPI) {
  registerReviewCommand(pi)
}
