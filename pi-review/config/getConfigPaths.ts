import { join } from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'

const defaultDeps = {
  getAgentDir,
}

export function getConfigPaths(deps = defaultDeps) {
  const agentDir = deps.getAgentDir()
  return {
    configPath: join(agentDir, 'review.yaml'),
    systemPromptPath: join(agentDir, 'review-prompt.md'),
  }
}

getConfigPaths.defaultDeps = defaultDeps
