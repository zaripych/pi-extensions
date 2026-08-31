import {
  Input,
  Key,
  matchesKey,
  SelectList,
  type SelectListTheme,
  truncateToWidth,
} from '@earendil-works/pi-tui'
import type {
  ReviewFormData,
  ReviewFormTarget,
  ReviewInstructionFile,
} from './prepareReviewForm'
import type { TargetSelection } from './collectReviewParams'

export type ReviewFormResult =
  | {
      target: TargetSelection
      modelId: string
      includeAgentsMd: boolean
      reviewInstructions?: ReviewInstructionFile
    }
  | {
      action: 'fetch'
      customReviewTarget: string
      selectedTarget: ReviewFormTarget
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
  freeform: 'Other (directory/file/etc)',
}

const targets: ReviewFormTarget[] = [
  'uncommitted',
  'branch',
  'commit',
  'freeform',
]

type RowId =
  | 'target'
  | 'base'
  | 'commit'
  | 'instructions'
  | 'model'
  | 'agents'
  | 'fetch'
  | 'start'

type SelectorRowId = Exclude<RowId, 'fetch' | 'start'>

export class ReviewForm {
  private form: ReviewFormData
  private theme: ReviewFormTheme
  private target: ReviewFormTarget
  private selectedRow = 0
  private baseIndex: number
  private commitIndex = 0
  private modelIndex: number
  private includeAgentsMd = false
  private instructionsIndex = 0
  private selector: SelectList | null = null
  private customReviewTarget = ''
  private editor: Input | null = null
  private editorError = false

  private done: (result: ReviewFormResult | undefined) => void

  constructor(params: {
    form: ReviewFormData
    done: (result: ReviewFormResult | undefined) => void
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
    this.customReviewTarget = params.form.customReviewTarget?.trim() ?? ''
    if (this.target === 'freeform') {
      this.selectedRow = this.rows().length - 1
    }
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
      'instructions',
      'model',
      'agents',
      'fetch',
      'start',
    ]
  }

  private rowText(row: RowId): { label: string; value: string; hint?: string } {
    switch (row) {
      case 'target':
        return this.target === 'freeform'
          ? {
              label: 'Target',
              value: `${targetLabels.freeform} — ${this.customReviewTarget}`,
            }
          : { label: 'Target', value: targetLabels[this.target] }
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
      case 'instructions': {
        const files = this.form.reviewInstructions
        const value =
          this.instructionsIndex === 0
            ? 'Correctness'
            : (files[this.instructionsIndex - 1]?.path ?? 'Correctness')
        return { label: 'Instructions', value }
      }
      case 'model':
        return {
          label: 'Model',
          value: this.form.models[this.modelIndex] ?? '',
        }
      case 'agents':
        return {
          label: 'Include AGENTS.md',
          value: this.includeAgentsMd ? 'Yes' : 'No',
        }
      case 'fetch':
        return { label: 'Fetch origin', value: '' }
      case 'start':
        return { label: 'Start review', value: '', hint: '(Ctrl+Enter)' }
    }
  }

  private cycleTarget(direction: 1 | -1): void {
    const values: ReviewFormTarget[] =
      this.customReviewTarget !== ''
        ? (['uncommitted', 'branch', 'commit', 'freeform'] as const)
        : (['uncommitted', 'branch', 'commit'] as const)
    const current = values.indexOf(this.target)
    if (current === -1) return
    this.target =
      values[(current + direction + values.length) % values.length] ??
      this.target
  }

  private cycle(direction: 1 | -1): void {
    const row = this.rows()[this.selectedRow]
    if (row === undefined || row === 'fetch' || row === 'start') return
    if (row === 'target') {
      this.cycleTarget(direction)
      return
    }
    const choices = this.selectorChoices(row)
    const length = choices.labels.length
    if (length === 0) return
    choices.pick((choices.index + direction + length) % length)
  }

  private selection(): ReviewFormResult | undefined {
    const modelId = this.form.models[this.modelIndex]
    if (modelId === undefined) return undefined
    const { includeAgentsMd } = this
    const reviewInstructions =
      this.instructionsIndex === 0
        ? undefined
        : this.form.reviewInstructions[this.instructionsIndex - 1]
    switch (this.target) {
      case 'uncommitted':
        return {
          target: { type: 'uncommitted' },
          modelId,
          includeAgentsMd,
          reviewInstructions,
        }
      case 'branch': {
        const branch = this.form.branches[this.baseIndex]
        if (!branch) return undefined
        return {
          target: { type: 'baseBranch', branch: branch.name },
          modelId,
          includeAgentsMd,
          reviewInstructions,
        }
      }
      case 'commit': {
        const commit = this.form.commits[this.commitIndex]
        if (!commit) return undefined
        return {
          target: { type: 'commit', sha: commit.sha, title: commit.title },
          modelId,
          includeAgentsMd,
          reviewInstructions,
        }
      }
      case 'freeform':
        return {
          target: {
            type: 'freeform',
            instructions: this.customReviewTarget,
          },
          modelId,
          includeAgentsMd,
          reviewInstructions,
        }
    }
  }

  private selectorChoices(rowId: SelectorRowId): {
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
            const selected = targets[index]
            if (selected === 'freeform') {
              this.openFreeformEditor()
            } else {
              this.target = selected ?? this.target
            }
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
      case 'instructions': {
        const files = this.form.reviewInstructions
        return {
          labels: ['Correctness', ...files.map((f) => f.path)],
          index: this.instructionsIndex,
          pick: (index) => {
            this.instructionsIndex = index
          },
        }
      }
      case 'model':
        return {
          labels: this.form.models,
          index: this.modelIndex,
          pick: (index) => {
            this.modelIndex = index
          },
        }
      case 'agents':
        return {
          labels: ['No', 'Yes'],
          index: this.includeAgentsMd ? 1 : 0,
          pick: (index) => {
            this.includeAgentsMd = index === 1
          },
        }
    }
  }

  private openSelector(rowId: SelectorRowId): void {
    const choices = this.selectorChoices(rowId)
    if (choices.labels.length === 0) return
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

  private openFreeformEditor(): void {
    const editor = new Input()
    editor.focused = true
    editor.setValue(this.customReviewTarget)
    editor.handleInput('\x05')
    editor.onSubmit = (value) => {
      const trimmed = value.trim()
      if (trimmed === '') {
        this.editorError = true
        return
      }
      this.editorError = false
      this.customReviewTarget = trimmed
      this.target = 'freeform'
      this.editor = null
      this.selectedRow = 0
    }
    editor.onEscape = () => {
      this.editorError = false
      this.editor = null
      this.selectedRow = 0
    }
    this.editorError = false
    this.editor = editor
  }

  private submit(): void {
    const selection = this.selection()
    if (selection !== undefined) {
      this.done(selection)
    }
  }

  handleInput(input: string): void {
    const data = matchesKey(input, Key.ctrl('c')) ? '\x1b' : input
    if (this.selector) {
      this.selector.handleInput(data)
      return
    }
    if (this.editor) {
      this.editor.handleInput(data)
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
        this.done({
          action: 'fetch',
          customReviewTarget: this.customReviewTarget,
          selectedTarget: this.target,
        })
      } else if (row === 'target' && this.target === 'freeform') {
        this.openFreeformEditor()
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
    if (this.editor) {
      const lines = [
        truncateToWidth(
          `${this.theme.cursor('❯ ')}${this.theme.label(
            'What to review'.padEnd(20),
            true
          )}${this.editor.render(width - 24).join('\n')}`,
          width
        ),
      ]
      if (this.editorError) {
        lines.push(this.theme.hint('Instructions cannot be empty'))
      }
      return lines
    }
    return this.rows().map((row, index) => {
      const selected = index === this.selectedRow
      const { label, value, hint } = this.rowText(row)
      const labelPadded = label.padEnd(20)
      const valueText = value === '' ? '' : `‹ ${value} ›`
      const trailing = hint
        ? this.theme.hint(hint)
        : this.theme.value(valueText, selected)
      const prefix = selected ? this.theme.cursor('❯ ') : '  '
      return truncateToWidth(
        `${prefix}${this.theme.label(labelPadded, selected)}${trailing}`,
        width
      )
    })
  }

  invalidate(): void {
    this.selector?.invalidate()
  }
}
