import {
  BorderedLoader,
  DynamicBorder,
  type ExtensionAPI,
  getMarkdownTheme,
} from '@earendil-works/pi-coding-agent'
import { Container, Markdown, Text } from '@earendil-works/pi-tui'
import { reviewCommand } from '../review/reviewCommand'
import { ReviewForm, type ReviewFormResult } from '../review/ReviewForm'
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
          showReviewForm: (form) =>
            ctx.ui.custom<ReviewFormResult | 'fetch' | undefined>(
              (tui, theme, _kb, done) => {
                const container = new Container()
                container.addChild(
                  new DynamicBorder((s: string) => theme.fg('accent', s))
                )
                container.addChild(
                  new Text(theme.fg('accent', theme.bold('Review')), 1, 0)
                )
                const reviewForm = new ReviewForm({
                  form,
                  done,
                  theme: {
                    cursor: (text) => theme.fg('accent', text),
                    label: (text, selected) =>
                      selected ? theme.fg('accent', text) : text,
                    value: (text, selected) =>
                      selected
                        ? theme.fg('accent', text)
                        : theme.fg('muted', text),
                    hint: (text) => theme.fg('dim', text),
                    selectList: {
                      selectedPrefix: (text) => theme.fg('accent', text),
                      selectedText: (text) => theme.fg('accent', text),
                      description: (text) => theme.fg('muted', text),
                      scrollInfo: (text) => theme.fg('dim', text),
                      noMatch: (text) => theme.fg('warning', text),
                    },
                  },
                })
                container.addChild(reviewForm)
                container.addChild(
                  new Text(
                    theme.fg(
                      'dim',
                      '↑↓ setting · ←→ change · enter list · ctrl+enter start · esc cancel'
                    ),
                    1,
                    0
                  )
                )
                container.addChild(
                  new DynamicBorder((s: string) => theme.fg('accent', s))
                )
                return {
                  render: (w: number) => container.render(w),
                  invalidate: () => container.invalidate(),
                  handleInput: (data: string) => {
                    reviewForm.handleInput(data)
                    tui.requestRender()
                  },
                }
              }
            ),
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
