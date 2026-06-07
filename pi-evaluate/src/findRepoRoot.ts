import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function findRepoRoot(startDir: string): Promise<string> {
  let current = startDir
  let parent = dirname(current)
  while (parent !== current) {
    if (await pathExists(join(current, '.git'))) {
      return current
    }
    current = parent
    parent = dirname(current)
  }
  if (await pathExists(join(current, '.git'))) {
    return current
  }
  return startDir
}
