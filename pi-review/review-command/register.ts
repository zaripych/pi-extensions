import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { Markdown } from '@earendil-works/pi-tui'
import { reviewCommand } from '../review/reviewCommand'
import type { ReviewOutput } from '../review-output/reviewOutputSchema'

export function registerReviewCommand(pi: ExtensionAPI) {
  pi.registerMessageRenderer<ReviewOutput>(
    'review',
    (message, _options, _theme) => {
      const content =
        typeof message.content === 'string' ? message.content : '(review)'
      return new Markdown(content, 0, 0, getMarkdownTheme())
    }
  )

  pi.registerCommand('review', {
    description: 'Run a code review',
    handler: async (args, ctx) => {
      ctx.ui.setStatus('review', '🔎 Reviewing...')
      try {
        let result: Awaited<ReturnType<typeof reviewCommand>> | undefined
        try {
          result = await reviewCommand({
            args,
            cwd: ctx.cwd,
            currentModelId: ctx.model
              ? `${ctx.model.provider}/${ctx.model.id}`
              : undefined,
            availableModelIds: ctx.modelRegistry
              .getAvailable()
              .map((m) => `${m.provider}/${m.id}`),
            hasUI: ctx.hasUI,
            select: (title, options) => ctx.ui.select(title, options),
            input: (title, placeholder) => ctx.ui.input(title, placeholder),
            notify: (message, level) => ctx.ui.notify(message, level),
            sendMessage: (message) => {
              pi.sendMessage(message)
            },
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.ui.notify(`Review failed: ${message}`, 'error')
          return
        }

        if ('cancelled' in result) {
          return
        }
      } finally {
        ctx.ui.setStatus('review', undefined)
      }
    },
  })
}
