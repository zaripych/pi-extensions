import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { faker } from '@faker-js/faker'
import { setupTmpDir } from './setupTmpDir'

const execFileAsync = promisify(execFile)

export async function setupGitRepo() {
  const tmpDir = await setupTmpDir()
  const dir = tmpDir.tmpDir()

  const git = async (...args: string[]) => {
    const { stdout } = await execFileAsync('git', args, { cwd: dir })
    return stdout
  }

  await git('init', '-b', 'main')
  await git('config', 'user.email', faker.internet.email())
  await git('config', 'user.name', faker.person.fullName())

  const commitFile = async (params: {
    fileName: string
    message?: string
    authorName?: string
    date?: string
  }) => {
    await writeFile(join(dir, params.fileName), faker.lorem.paragraph())
    await git('add', params.fileName)
    const commitArgs = [
      'commit',
      '-m',
      params.message ?? faker.git.commitMessage(),
    ]
    if (params.authorName !== undefined) {
      commitArgs.push(
        '--author',
        `${params.authorName} <${faker.internet.email()}>`
      )
    }
    const env =
      params.date !== undefined
        ? {
            ...process.env,
            GIT_COMMITTER_DATE: params.date,
            GIT_AUTHOR_DATE: params.date,
          }
        : process.env
    await execFileAsync('git', commitArgs, { cwd: dir, env })
  }

  return {
    repoDir: () => dir,
    git,
    commitFile,
    [Symbol.asyncDispose]: tmpDir[Symbol.asyncDispose],
  }
}
