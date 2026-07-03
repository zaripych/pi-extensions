import {
  Key,
  matchesKey,
  SelectList,
  type SelectListTheme,
  truncateToWidth,
} from '@earendil-works/pi-tui'
import type { ReviewFormData, ReviewFormTarget } from './prepareReviewForm'
import type { TargetSelection } from './pickTarget'

export type ReviewFormResult = {
  target: TargetSelection
  modelId: string
}

export type ReviewFormTheme = {
  cursor: (text: string) => string
  label: (text: string, selected: boolean) => string
  value: (text: string, selected: boolean) => string
  hint: (text: string) => string
  selectList: SelectListTheme
}

const targetLabels: Record<ReviewFormTarget, string> = {
  uncommitted: 'Uncommitted changes',
  branch: 'Branch changes',
  commit: 'Commit',
}

const targets: ReviewFormTarget[] = ['uncommitted', 'branch', 'commit']

type RowId = 'target' | 'base' | 'commit' | 'model' | 'fetch' | 'start'

export class ReviewForm {
  private form: ReviewFormData
  private theme: ReviewFormTheme
  private target: ReviewFormTarget
  private selectedRow = 0
  private baseIndex: number
  private commitIndex = 0
  private modelIndex: number
  private selector: SelectList | null = null

  private done: (result: ReviewFormResult | 'fetch' | undefined) => void

  constructor(params: {
    form: ReviewFormData
    done: (result: ReviewFormResult | 'fetch' | undefined) => void
    theme: ReviewFormTheme
  }) {
    this.form = params.form
    this.done = params.done
    this.theme = params.theme
    this.target = params.form.defaultTarget
    this.baseIndex = Math.max(
      0,
      this.form.branches.findIndex(
        (branch) => branch.name === params.form.defaultBase
      )
    )
    this.modelIndex = Math.max(
      0,
      this.form.models.indexOf(params.form.defaultModel)
    )
  }

  private branchLabel(branch: { name: string; author: string }): string {
    const { defaultBranch } = this.form
    if (
      branch.name === defaultBranch ||
      branch.name === `origin/${defaultBranch}`
    ) {
      return branch.name
    }
    return `${branch.name} — ${branch.author}`
  }

  private rows(): RowId[] {
    return [
      'target',
      ...(this.target === 'branch' ? ['base' as const] : []),
      ...(this.target === 'commit' ? ['commit' as const] : []),
      'model',
      'fetch',
      'start',
    ]
  }

  private rowText(row: RowId): { label: string; value: string } {
    switch (row) {
      case 'target':
        return { label: 'Target', value: targetLabels[this.target] }
      case 'base': {
        const branch = this.form.branches[this.baseIndex]
        return {
          label: 'Base',
          value: branch ? this.branchLabel(branch) : '',
        }
      }
      case 'commit': {
        const commit = this.form.commits[this.commitIndex]
        return {
          label: 'Commit',
          value: commit ? `${commit.sha} ${commit.title}` : '',
        }
      }
      case 'model':
        return {
          label: 'Model',
          value: this.form.models[this.modelIndex] ?? '',
        }
      case 'fetch':
        return { label: 'Fetch origin', value: '' }
      case 'start':
        return { label: 'Start review', value: '' }
    }
  }

  private cycle(direction: 1 | -1): void {
    const row = this.rows()[this.selectedRow]
    if (row === undefined || row === 'fetch' || row === 'start') return
    const choices = this.selectorChoices(row)
    const length = choices.labels.length
    if (length === 0) return
    choices.pick((choices.index + direction + length) % length)
  }

  private selection(): ReviewFormResult | undefined {
    const modelId = this.form.models[this.modelIndex]
    if (modelId === undefined) return undefined
    switch (this.target) {
      case 'uncommitted':
        return { target: { type: 'uncommitted' }, modelId }
      case 'branch': {
        const branch = this.form.branches[this.baseIndex]
        if (!branch) return undefined
        return {
          target: { type: 'baseBranch', branch: branch.name },
          modelId,
        }
      }
      case 'commit': {
        const commit = this.form.commits[this.commitIndex]
        if (!commit) return undefined
        return {
          target: { type: 'commit', sha: commit.sha, title: commit.title },
          modelId,
        }
      }
    }
  }

  private selectorChoices(rowId: 'target' | 'base' | 'commit' | 'model'): {
    labels: string[]
    index: number
    pick: (index: number) => void
  } {
    switch (rowId) {
      case 'target':
        return {
          labels: targets.map((target) => targetLabels[target]),
          index: targets.indexOf(this.target),
          pick: (index) => {
            this.target = targets[index] ?? this.target
          },
        }
      case 'base':
        return {
          labels: this.form.branches.map((branch) => this.branchLabel(branch)),
          index: this.baseIndex,
          pick: (index) => {
            this.baseIndex = index
          },
        }
      case 'commit':
        return {
          labels: this.form.commits.map(
            (commit) => `${commit.sha} ${commit.title}`
          ),
          index: this.commitIndex,
          pick: (index) => {
            this.commitIndex = index
          },
        }
      case 'model':
        return {
          labels: this.form.models,
          index: this.modelIndex,
          pick: (index) => {
            this.modelIndex = index
          },
        }
    }
  }

  private openSelector(rowId: 'target' | 'base' | 'commit' | 'model'): void {
    const choices = this.selectorChoices(rowId)
    const items = choices.labels.map((label, index) => ({
      value: String(index),
      label,
    }))
    const selector = new SelectList(
      items,
      Math.min(items.length, 10),
      this.theme.selectList
    )
    selector.setSelectedIndex(choices.index)
    selector.onSelect = (item) => {
      choices.pick(Number(item.value))
      this.selector = null
    }
    selector.onCancel = () => {
      this.selector = null
    }
    this.selector = selector
  }

  private submit(): void {
    const selection = this.selection()
    if (selection !== undefined) {
      this.done(selection)
    }
  }

  handleInput(data: string): void {
    if (this.selector) {
      this.selector.handleInput(data)
      return
    }
    const rowCount = this.rows().length
    if (matchesKey(data, Key.escape)) {
      this.done(undefined)
    } else if (matchesKey(data, Key.ctrl('enter'))) {
      this.submit()
    } else if (matchesKey(data, Key.enter)) {
      const row = this.rows()[this.selectedRow]
      if (row === undefined) return
      if (row === 'start') {
        this.submit()
      } else if (row === 'fetch') {
        this.done('fetch')
      } else {
        this.openSelector(row)
      }
    } else if (matchesKey(data, Key.right)) {
      this.cycle(1)
    } else if (matchesKey(data, Key.left)) {
      this.cycle(-1)
    } else if (matchesKey(data, Key.down)) {
      this.selectedRow = (this.selectedRow + 1) % rowCount
    } else if (matchesKey(data, Key.up)) {
      this.selectedRow = (this.selectedRow - 1 + rowCount) % rowCount
    }
  }

  render(width: number): string[] {
    if (this.selector) {
      return this.selector.render(width)
    }
    return this.rows().map((row, index) => {
      const selected = index === this.selectedRow
      const { label, value } = this.rowText(row)
      const labelPadded = label.padEnd(14)
      const valueText = value === '' ? '' : `‹ ${value} ›`
      const prefix = selected ? this.theme.cursor('❯ ') : '  '
      return truncateToWidth(
        `${prefix}${this.theme.label(labelPadded, selected)}${this.theme.value(valueText, selected)}`,
        width
      )
    })
  }

  invalidate(): void {
    this.selector?.invalidate()
  }
}
