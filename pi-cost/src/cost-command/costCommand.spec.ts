import { describe, expect, it } from 'vitest'
import type { UsageInputs } from '../model-value/loadUsageInputs'
import { setupCostCommand } from './costCommand.harness'

const CYCLE_START_MS = new Date(2026, 8, 1).getTime()

function inputs(): UsageInputs {
  return {
    providers: [
      {
        provider: 'openai',
        cycleStart: '2026-09-01',
        cycleEnd: '2026-10-01',
        planPaymentAud: 81.98,
        creditPurchasesAud: 51.98,
        utilization: { basis: 'elapsed', fraction: 0.102 },
        creditsConsumedAud: 97.42,
        modelShares: null,
      },
      {
        provider: 'neuralwatt',
        cycleStart: '2026-09-12',
        cycleEnd: '2026-10-12',
        planPaymentAud: 75,
        creditPurchasesAud: 0,
        utilization: { basis: 'whole-cycle', fraction: 0.877 },
        creditsConsumedAud: 0,
        modelShares: null,
      },
    ],
    records: [
      {
        ts: CYCLE_START_MS + 86_400_000,
        sessionId: 'session-1',
        cwd: '/tmp',
        provider: 'openai-codex',
        model: 'gpt-5.2-codex',
        tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    ],
    aaScores: new Map([['gpt-5.2-codex', 50]]),
  }
}

describe('registerCostCommand', () => {
  it('opens on the spend tab in amortized mode', async () => {
    await using harness = await setupCostCommand({
      loadUsageInputs: async () => inputs(),
    })
    harness.registerCostCommand(harness.pi)

    const [spend] = await harness.runInteractiveCommand({
      command: 'cost',
      actions: ['[snapshot]', 'q'],
    })

    expect(spend).toMatchInlineSnapshot(`
      "────────────────────────────────────────────────────────────────────────────────────────────────────
       Cost — usage and value

        ▍ Spend ▐   Model Value

        PROVIDER    CYCLE                       TOKENS  TOTAL PAID  EXTRA PAID              USAGE
        openai      2026-09-01 → 2026-10-01  1.00 MTok      133.96       51.98  █████████░  10.2%
        neuralwatt  2026-09-12 → 2026-10-12          0       75.00        0.00  █░░░░░░░░░  87.7%

        total paid this cycle: 208.96 AUD
        total tokens this cycle: 1.00 MTok

        Tab/Shift+Tab switch tab · m switch mode (amortized) · q close
      ────────────────────────────────────────────────────────────────────────────────────────────────────"
    `)
  })

  it('switches cost mode with m', async () => {
    await using harness = await setupCostCommand({
      loadUsageInputs: async () => inputs(),
    })
    harness.registerCostCommand(harness.pi)

    const [, consumption] = await harness.runInteractiveCommand({
      command: 'cost',
      actions: ['[snapshot]', 'm', '[snapshot]', 'q'],
    })

    expect(consumption).toMatchInlineSnapshot(`
      "────────────────────────────────────────────────────────────────────────────────────────────────────
       Cost — usage and value

        ▍ Spend ▐   Model Value

        PROVIDER    CYCLE                       TOKENS  TOTAL CONS  EXTRA CONS              USAGE
        openai      2026-09-01 → 2026-10-01  1.00 MTok      101.32       97.42  █████████░  10.2%
        neuralwatt  2026-09-12 → 2026-10-12          0       65.78        0.00  █░░░░░░░░░  87.7%

        total consumed this cycle: 167.10 AUD
        total tokens this cycle: 1.00 MTok

        Tab/Shift+Tab switch tab · m switch mode (consumption) · q close
      ────────────────────────────────────────────────────────────────────────────────────────────────────"
    `)
  })

  it('switches to the model value tab with tab', async () => {
    await using harness = await setupCostCommand({
      loadUsageInputs: async () => inputs(),
    })
    harness.registerCostCommand(harness.pi)

    const [modelValue] = await harness.runInteractiveCommand({
      command: 'cost',
      actions: ['\t', '[snapshot]', 'q'],
    })

    expect(modelValue).toMatchInlineSnapshot(`
      "────────────────────────────────────────────────────────────────────────────────────────────────────
       Cost — usage and value

        Spend   ▍ Model Value ▐

        MODEL          PROVIDER     TOKENS     AUD  AUD/MTOK  AA IDX  VALUE
        gpt-5.2-codex  openai    1.00 MTok  133.96    133.96      50    0.4

        Tab/Shift+Tab switch tab · m switch mode (amortized) · q close
      ────────────────────────────────────────────────────────────────────────────────────────────────────"
    `)
  })

  it('switches back to the spend tab with shift+tab', async () => {
    await using harness = await setupCostCommand({
      loadUsageInputs: async () => inputs(),
    })
    harness.registerCostCommand(harness.pi)

    const [spend] = await harness.runInteractiveCommand({
      command: 'cost',
      actions: ['\t', '\x1b[Z', '[snapshot]', 'q'],
    })

    expect(spend).toMatchInlineSnapshot(`
      "────────────────────────────────────────────────────────────────────────────────────────────────────
       Cost — usage and value

        ▍ Spend ▐   Model Value

        PROVIDER    CYCLE                       TOKENS  TOTAL PAID  EXTRA PAID              USAGE
        openai      2026-09-01 → 2026-10-01  1.00 MTok      133.96       51.98  █████████░  10.2%
        neuralwatt  2026-09-12 → 2026-10-12          0       75.00        0.00  █░░░░░░░░░  87.7%

        total paid this cycle: 208.96 AUD
        total tokens this cycle: 1.00 MTok

        Tab/Shift+Tab switch tab · m switch mode (amortized) · q close
      ────────────────────────────────────────────────────────────────────────────────────────────────────"
    `)
  })

  it('closes with q and clears the active component', async () => {
    await using harness = await setupCostCommand({
      loadUsageInputs: async () => inputs(),
    })
    harness.registerCostCommand(harness.pi)

    await harness.runInteractiveCommand({
      command: 'cost',
      actions: ['q'],
    })

    expect(() => harness.renderCustom(100)).toThrow(
      'no active ui.custom component'
    )
  })

  it('renders the error message when loading fails', async () => {
    await using harness = await setupCostCommand({
      loadUsageInputs: async () => {
        throw new Error('billing capture failed: route failed')
      },
    })
    harness.registerCostCommand(harness.pi)

    const [error] = await harness.runInteractiveCommand({
      command: 'cost',
      actions: ['[snapshot]', 'q'],
    })

    expect(error).toMatchInlineSnapshot(`
      "────────────────────────────────────────────────────────────────────────────────────────────────────
       Cost — usage and value
        billing capture failed: route failed

        q close
      ────────────────────────────────────────────────────────────────────────────────────────────────────"
    `)
  })

  it('notifies instead of opening when the session has no UI', async () => {
    await using harness = await setupCostCommand({
      loadUsageInputs: async () => inputs(),
      hasUI: () => false,
    })
    harness.registerCostCommand(harness.pi)

    await harness.runCommand('cost', '')

    expect(harness.notifications[0]?.message).toBe(
      'The /cost report needs an interactive terminal'
    )
  })
})
