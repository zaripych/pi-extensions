import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { loadUsageInputs } from '../model-value/loadUsageInputs'
import { CostComponent } from './costComponent'

const defaultDeps = {
  loadUsageInputs,
  now: () => new Date(),
}

export function registerCostCommand(
  pi: ExtensionAPI,
  deps = defaultDeps
): void {
  pi.registerCommand('cost', {
    description: 'Display subscription spend and model value across providers',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          'The /cost report needs an interactive terminal',
          'warning'
        )
        return
      }
      await ctx.ui.custom<null>((tui, theme, _keybindings, done) => {
        const component = new CostComponent(theme, tui, () => done(null))
        const now = deps.now()
        void deps
          .loadUsageInputs({ now })
          .then((inputs) => component.loaded(inputs, now))
          .catch((error: unknown) => {
            component.setState({
              type: 'error',
              message: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => tui.requestRender())
        return component
      })
    },
  })
}

registerCostCommand.defaultDeps = defaultDeps
