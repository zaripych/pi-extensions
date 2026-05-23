import { defineTool } from '@earendil-works/pi-coding-agent'
import { reviewOutputSchema } from '../review-output/reviewOutputSchema'

export const finishReviewTool = defineTool({
  name: 'finish-review',
  label: 'Finish Review',
  description:
    'Submit structured review findings. Call this as the final action after completing the review.',
  parameters: reviewOutputSchema,
  async execute(_toolCallId, params) {
    return {
      content: [{ type: 'text', text: 'Review submitted.' }],
      details: params,
      terminate: true,
    }
  },
})
