import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readdirIfPresent,
  readFileIfPresent,
  statIfPresent,
} from './fsIfPresent'

describe('fsIfPresent', () => {
  it('treats a missing path as absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fs-if-present-spec-'))
    const missing = join(dir, 'missing')

    await expect(statIfPresent(missing)).resolves.toBeUndefined()
    await expect(readFileIfPresent(missing)).resolves.toBeUndefined()
    await expect(readdirIfPresent(missing)).resolves.toBeUndefined()
  })

  it('returns the value when the path exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fs-if-present-spec-'))

    await writeFile(join(dir, 'file.txt'), 'content')

    expect((await statIfPresent(join(dir, 'file.txt')))?.isFile()).toBe(true)
    await expect(readFileIfPresent(join(dir, 'file.txt'))).resolves.toBe(
      'content'
    )
    await expect(readdirIfPresent(dir)).resolves.toEqual(['file.txt'])
  })

  it('rethrows errors other than absence', async () => {
    const tooLong = 'a'.repeat(10_000)

    await expect(statIfPresent(tooLong)).rejects.toThrow('ENAMETOOLONG')
    await expect(readFileIfPresent(tooLong)).rejects.toThrow('ENAMETOOLONG')
  })
})
