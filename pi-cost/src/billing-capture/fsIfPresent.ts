import { readFile, readdir, stat } from 'node:fs/promises'

export function isAbsentError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function statIfPresent(path: string) {
  try {
    return await stat(path)
  } catch (error) {
    if (isAbsentError(error)) return undefined
    throw error
  }
}

export async function readFileIfPresent(
  path: string
): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isAbsentError(error)) return undefined
    throw error
  }
}

export async function readdirIfPresent(
  path: string
): Promise<string[] | undefined> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isAbsentError(error)) return undefined
    throw error
  }
}
