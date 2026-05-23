import { readFile, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { spawnToFile } from './spawnToFile'

describe('spawnToFile', () => {
  it('writes stdout to a temp file and returns the path', async () => {
    const filePath = await spawnToFile({
      command: 'echo',
      args: ['hello world'],
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('hello world\n')
  })

  it('rejects with stderr when command fails', async () => {
    await expect(
      spawnToFile({
        command: 'git',
        args: ['show', '--end-of-options', 'nonexistent_ref_abc123'],
      })
    ).rejects.toThrow('nonexistent_ref_abc123')
  })

  it('captures large output without exceeding memory buffers', async () => {
    const filePath = await spawnToFile({
      command: 'sh',
      args: ['-c', 'seq 1 100000'],
    })

    const fileStat = await stat(filePath)
    expect(fileStat.size).toBeGreaterThan(500_000)
  })

  it('runs in the specified cwd', async () => {
    const tmp = tmpdir()
    const filePath = await spawnToFile({
      command: 'pwd',
      args: [],
      cwd: tmp,
    })

    const content = await readFile(filePath, 'utf-8')
    expect(content.trim()).toBe(await realpath(tmp))
  })
})
