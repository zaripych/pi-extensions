import {
  fetchOrigin,
  getCurrentBranch,
  getDefaultBranch,
  hasUncommittedChanges,
  listBranchesWithAuthors,
  listCommits,
} from '../git/commands'
import { selectReviewModel } from './selectReviewModel'

const defaultDeps = {
  fetchOrigin,
  getCurrentBranch,
  getDefaultBranch,
  hasUncommittedChanges,
  listBranchesWithAuthors,
  listCommits,
}

export type ReviewFormTarget = 'uncommitted' | 'branch' | 'commit'

export type ReviewFormData = {
  defaultTarget: ReviewFormTarget
  branches: { name: string; author: string }[]
  defaultBase: string
  defaultBranch: string
  commits: { sha: string; title: string }[]
  models: string[]
  defaultModel: string
  fetchWarning?: string
}

function sortDefaultModelFirst(params: {
  availableModelIds: string[]
  chooseFrom: string[]
  defaultModel: string
}): string[] {
  const rank = (id: string) =>
    id === params.defaultModel ? 0 : params.chooseFrom.includes(id) ? 1 : 2
  return params.availableModelIds.toSorted((a, b) => rank(a) - rank(b))
}

export async function prepareReviewForm(
  params: {
    cwd: string
    currentModelId: string | undefined
    availableModelIds: string[]
    modelConfig: { chooseFrom: string[] } | undefined
    fetch: boolean
  },
  deps = defaultDeps
): Promise<ReviewFormData> {
  const { cwd } = params

  let fetchWarning: string | undefined
  if (params.fetch) {
    try {
      await deps.fetchOrigin({ cwd })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fetchWarning = `Fetching origin failed, branch list may be stale: ${message}`
    }
  }

  const dirty = await deps.hasUncommittedChanges({ cwd })
  const currentBranch = await deps.getCurrentBranch({ cwd })
  const branches = await deps.listBranchesWithAuthors({ cwd })
  const commits = await deps.listCommits({ cwd })

  const branchNames = branches.map((branch) => branch.name)
  const defaultBranch =
    (await deps.getDefaultBranch({ cwd })) ??
    ['main', 'master'].find((name) => branchNames.includes(name)) ??
    'main'

  const pinnedNames = [defaultBranch, `origin/${defaultBranch}`]
  const pinned = pinnedNames.flatMap((name) =>
    branches.filter((branch) => branch.name === name)
  )
  const unpinned = branches.filter(
    (branch) => !pinnedNames.includes(branch.name)
  )
  const orderedBranches = [...pinned, ...unpinned]

  const defaultBase =
    [`origin/${defaultBranch}`, defaultBranch].find((name) =>
      branchNames.includes(name)
    ) ??
    branchNames[0] ??
    defaultBranch

  const defaultModel = selectReviewModel({
    modelConfig: params.modelConfig,
    currentModelId: params.currentModelId,
    availableModelIds: params.availableModelIds,
  })

  const defaultTarget: ReviewFormTarget = dirty
    ? 'uncommitted'
    : currentBranch === defaultBranch
      ? 'commit'
      : 'branch'

  return {
    defaultTarget,
    branches: orderedBranches,
    defaultBase,
    defaultBranch,
    fetchWarning,
    commits,
    models: sortDefaultModelFirst({
      availableModelIds: params.availableModelIds,
      chooseFrom: params.modelConfig?.chooseFrom ?? [],
      defaultModel,
    }),
    defaultModel,
  }
}

prepareReviewForm.defaultDeps = defaultDeps
