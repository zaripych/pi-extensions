import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import fastGlob from 'fast-glob'
import {
  getCurrentBranch,
  getDefaultBranch,
  hasUncommittedChanges,
  listBranchesWithAuthors,
  listCommits,
} from '../git/commands'
import { selectReviewModel } from './selectReviewModel'

async function findReviewInstructions(params: {
  cwd: string
  glob: string
}): Promise<{ path: string; content: string }[]> {
  const paths = await fastGlob(params.glob, {
    cwd: params.cwd,
    absolute: true,
    ignore: ['**/node_modules/**'],
  })
  return Promise.all(
    paths.map(async (absolutePath) => ({
      path: relative(params.cwd, absolutePath),
      content: await readFile(absolutePath, 'utf-8'),
    }))
  )
}

const defaultDeps = {
  getCurrentBranch,
  getDefaultBranch,
  hasUncommittedChanges,
  listBranchesWithAuthors,
  listCommits,
  findReviewInstructions,
}

export type ReviewFormTarget = 'uncommitted' | 'branch' | 'commit'

export type ReviewInstructionFile = { path: string; content: string }

export type ReviewFormData = {
  defaultTarget: ReviewFormTarget
  branches: { name: string; author: string }[]
  defaultBase: string
  defaultBranch: string
  commits: { sha: string; title: string }[]
  models: string[]
  defaultModel: string
  reviewInstructions: ReviewInstructionFile[]
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
    reviewInstructionsGlob: string
  },
  deps = defaultDeps
): Promise<ReviewFormData> {
  const { cwd } = params

  const dirty = await deps.hasUncommittedChanges({ cwd })
  const currentBranch = await deps.getCurrentBranch({ cwd })
  const branches = await deps.listBranchesWithAuthors({ cwd })
  const commits = await deps.listCommits({ cwd })
  const reviewInstructions = await deps.findReviewInstructions({
    cwd,
    glob: params.reviewInstructionsGlob,
  })

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
    commits,
    models: sortDefaultModelFirst({
      availableModelIds: params.availableModelIds,
      chooseFrom: params.modelConfig?.chooseFrom ?? [],
      defaultModel,
    }),
    defaultModel,
    reviewInstructions,
  }
}

prepareReviewForm.defaultDeps = defaultDeps
