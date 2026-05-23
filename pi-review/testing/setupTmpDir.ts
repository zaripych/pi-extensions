import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { faker } from '@faker-js/faker'

export async function setupTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-test-'))

  return {
    tmpDir: () => dir,
    createTempFile: async (
      params: { content: string } | { randomTextLength: number }
    ): Promise<{ filePath: string }> => {
      const content =
        'content' in params
          ? params.content
          : faker.lorem
              .paragraphs({ min: 1, max: 5 })
              .slice(0, params.randomTextLength)
      const filePath = join(dir, `${randomBytes(8).toString('hex')}.txt`)
      await writeFile(filePath, content)
      return { filePath }
    },
    [Symbol.asyncDispose]: async () => {
      await rm(dir, { recursive: true })
    },
  }
}
