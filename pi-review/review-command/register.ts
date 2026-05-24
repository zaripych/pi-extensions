import {
  BorderedLoader,
  type ExtensionAPI,
  getMarkdownTheme,
} from '@earendil-works/pi-coding-agent'
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
        await reviewCommand({
          args,
          cwd: ctx.cwd,
          currentModelId: ctx.model && `${ctx.model.provider}/${ctx.model.id}`,
          availableModelIds: ctx.modelRegistry
            .getAvailable()
            .map((m) => `${m.provider}/${m.id}`),
          hasUI: ctx.hasUI,
          select: (title, options) => ctx.ui.select(title, options),
          input: (title, placeholder) => ctx.ui.input(title, placeholder),
          notify: (message, level) => ctx.ui.notify(message, level),
          runWithCancellableLoader: async ({ description, run }) => {
            const outcome = await ctx.ui.custom<
              | {
                  result: ReturnType<typeof run> extends Promise<infer U>
                    ? U
                    : ReturnType<typeof run>
                }
              | { error: unknown }
            >((tui, theme, _kb, done) => {
              const loader = new BorderedLoader(tui, theme, description)
              run({ signal: loader.signal })
                .then((result) => done({ result }))
                .catch((error) => done({ error }))
              return loader
            })
            if ('error' in outcome) throw outcome.error
            return outcome.result
          },
          sendMessage: (message) => {
            pi.sendMessage(message)
          },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Review failed: ${message}`, 'error')
      } finally {
        ctx.ui.setStatus('review', undefined)
      }
    },
  })
}
