import { describe, expect, it } from 'vitest'
import { setupPiHarness } from './pi.harness'

describe('setupPiHarness', () => {
  it('runs an interactive command with snapshots and keys', async () => {
    const harness = await setupPiHarness()

    harness.pi.registerCommand('demo', {
      description: 'demo command',
      handler: async (_args, ctx) => {
        await ctx.ui.custom<null>((_tui, _theme, _keybindings, done) => {
          let mode = 'amortized'
          return {
            render: () => [`mode: ${mode}`],
            invalidate: () => {},
            handleInput: (data: string) => {
              if (data === 'm') {
                mode = mode === 'amortized' ? 'consumption' : 'amortized'
              }
              if (data === 'q') done(null)
            },
            dispose: () => {},
          }
        })
      },
    })

    const snapshots = await harness.runInteractiveCommand({
      command: 'demo',
      actions: ['[snapshot]', 'm', '[snapshot]', 'q'],
    })

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toContain('mode: amortized')
    expect(snapshots[1]).toContain('mode: consumption')
  })

  it('times out when the actions do not close the component', async () => {
    const harness = await setupPiHarness()

    harness.pi.registerCommand('demo', {
      description: 'demo command',
      handler: async (_args, ctx) => {
        await ctx.ui.custom<null>(() => ({
          render: () => ['stays open'],
          invalidate: () => {},
          dispose: () => {},
        }))
      },
    })

    await expect(
      harness.runInteractiveCommand({
        command: 'demo',
        actions: [],
        timeoutMs: 20,
      })
    ).rejects.toThrow('runInteractiveCommand timed out after 20ms')
  })

  it('captures, drives, and finishes a ui.custom component', async () => {
    const harness = await setupPiHarness()
    let closedWith: number | undefined
    let disposed = false

    harness.pi.registerCommand('demo', {
      description: 'demo command',
      handler: async (_args, ctx) => {
        closedWith = await ctx.ui.custom<number>(
          (tui, theme, _keybindings, done) => {
            let mode = 'amortized'
            return {
              render: (width: number) => [
                theme.bold(`mode: ${mode}`.padEnd(width).slice(0, width)),
              ],
              invalidate: () => {},
              handleInput: (data: string) => {
                if (data === 'm') {
                  mode = mode === 'amortized' ? 'consumption' : 'amortized'
                  tui.requestRender()
                }
                if (data === 'q') done(42)
              },
              dispose: () => {
                disposed = true
              },
            }
          }
        )
      },
    })

    const running = harness.runCommand('demo', '')
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    expect(harness.renderCustom(40).join('\n')).toContain('mode: amortized')

    harness.pressCustom('m')
    expect(harness.renderCustom(40).join('\n')).toContain('mode: consumption')

    harness.pressCustom('q')
    await running

    expect(closedWith).toBe(42)
    expect(disposed).toBe(true)
    expect(() => harness.renderCustom(40)).toThrow(
      'no active ui.custom component'
    )
  })
})
