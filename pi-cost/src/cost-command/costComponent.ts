import type { Theme } from '@earendil-works/pi-coding-agent'
import { DynamicBorder } from '@earendil-works/pi-coding-agent'
import type { Component, TUI } from '@earendil-works/pi-tui'
import { Loader, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import {
  calculateUsage,
  type CostMode,
  type UsageReport,
} from '../model-value/calculateUsage'
import type { UsageInputs } from '../model-value/loadUsageInputs'
import { renderModelValueTab, renderSpendTab } from './costTabs'

type CostState =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | {
      type: 'loaded'
      report: UsageReport
      inputs: UsageInputs
      now: Date
    }

const TABS = ['Spend', 'Model Value']

export class CostComponent implements Component {
  private state: CostState = { type: 'loading' }
  private activeTab = 0
  private mode: CostMode = 'amortized'
  private theme: Theme
  private tui: TUI
  private onClose: () => void
  private loader: Loader | null = null

  constructor(theme: Theme, tui: TUI, onClose: () => void) {
    this.theme = theme
    this.tui = tui
    this.onClose = onClose
    this.startLoader()
  }

  private startLoader(): void {
    this.loader = new Loader(
      this.tui,
      (s: string) => this.theme.fg('accent', s),
      (s: string) => this.theme.fg('muted', s),
      'Loading usage and value...'
    )
  }

  destroy(): void {
    this.loader?.stop()
    this.loader = null
  }

  setState(state: CostState): void {
    if (state.type === 'loading') {
      this.loader?.stop()
      this.startLoader()
      this.activeTab = 0
    } else if (this.state.type === 'loading') {
      this.loader?.stop()
      this.loader = null
    }
    this.state = state
  }

  loaded(inputs: UsageInputs, now: Date): void {
    this.setState({
      type: 'loaded',
      inputs,
      now,
      report: this.reportFor(inputs, now),
    })
  }

  private reportFor(inputs: UsageInputs, now: Date): UsageReport {
    return calculateUsage({ mode: this.mode, ...inputs, now })
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, 'escape') || data === 'q') {
      this.onClose()
      return true
    }
    if (data === 'm' && this.state.type === 'loaded') {
      this.mode = this.mode === 'amortized' ? 'consumption' : 'amortized'
      this.state = {
        ...this.state,
        report: this.reportFor(this.state.inputs, this.state.now),
      }
      this.tui.requestRender()
      return true
    }
    if (data === '\t') {
      this.activeTab = (this.activeTab + 1) % TABS.length
      this.tui.requestRender()
      return true
    }
    if (data === '\x1b[Z' || data === '\x1b[2Z') {
      this.activeTab = (this.activeTab - 1 + TABS.length) % TABS.length
      this.tui.requestRender()
      return true
    }
    return false
  }

  render(width: number): string[] {
    const lines: string[] = []
    const border = new DynamicBorder((s: string) => this.theme.fg('border', s))
    const contentWidth = Math.max(1, width - 4)

    lines.push(...border.render(width))
    lines.push(
      truncateToWidth(
        ` ${this.theme.fg('accent', this.theme.bold('Cost — usage and value'))}`,
        width
      )
    )

    switch (this.state.type) {
      case 'loading':
        if (this.loader) {
          lines.push(...this.loader.render(width))
        } else {
          lines.push(this.theme.fg('muted', '  Loading usage and value...'))
        }
        break
      case 'error':
        lines.push(this.theme.fg('error', `  ${this.state.message}`))
        break
      case 'loaded':
        lines.push(...this.renderLoaded(this.state.report, contentWidth, width))
        break
    }

    lines.push('')
    // only the loaded state has tabs and a mode to switch
    if (this.state.type === 'loaded') {
      lines.push(
        truncateToWidth(
          `  ${this.theme.fg('dim', 'Tab/Shift+Tab switch tab · m switch mode ')}${this.theme.fg(
            'accent',
            `(${this.mode})`
          )}${this.theme.fg('dim', ' · q close')}`,
          width
        )
      )
    } else {
      lines.push(this.theme.fg('dim', '  q close'))
    }
    lines.push(...border.render(width))

    return lines
  }

  private renderLoaded(
    report: UsageReport,
    contentWidth: number,
    maxWidth: number
  ): string[] {
    const tabParts = TABS.map((label, index) =>
      index === this.activeTab
        ? this.theme.bg(
            'selectedBg',
            this.theme.fg('accent', this.theme.bold(`▍ ${label} ▐`))
          )
        : this.theme.fg('dim', label)
    )
    const content =
      this.activeTab === 0
        ? renderSpendTab(report, {
            contentWidth,
            maxWidth,
            theme: this.theme,
          })
        : renderModelValueTab(report, {
            contentWidth,
            maxWidth,
            theme: this.theme,
          })
    return [
      '',
      truncateToWidth(`  ${tabParts.join('   ')}`, maxWidth),
      ...content,
    ]
  }

  invalidate(): void {}
}
