import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupTmpDir } from '../testing/setupTmpDir'
import { readOutputFile } from './readOutputFile'

const setup = combineHarnesses(setupTmpDir)

describe('readOutputFile', () => {
  it('returns full content when file fits within limits', async () => {
    await using harness = await setup()
    const { filePath } = await harness.createTempFile({
      content: 'line 1\nline 2\nline 3\n',
    })

    const result = await readOutputFile({
      filePath,
      maxLines: 10,
      maxBytes: 1024,
    })

    expect(result).toEqual({
      content: 'line 1\nline 2\nline 3\n',
      fullOutputPath: undefined,
    })
  })

  it('truncates and returns file path when line limit exceeded', async () => {
    await using harness = await setup()
    const { filePath } = await harness.createTempFile({
      content: 'a\nb\nc\nd\ne\n',
    })

    const result = await readOutputFile({
      filePath,
      maxLines: 3,
      maxBytes: 1024,
    })

    expect(result).toEqual({
      content: 'a\nb\nc\n',
      fullOutputPath: filePath,
    })
  })

  it('truncates and returns file path when byte limit exceeded', async () => {
    await using harness = await setup()
    const { filePath } = await harness.createTempFile({
      content: 'short\nshort\nthis is a longer line\n',
    })

    const result = await readOutputFile({
      filePath,
      maxLines: 100,
      maxBytes: 12,
    })

    expect(result).toEqual({
      content: 'short\nshort\n',
      fullOutputPath: filePath,
    })
  })

  it('truncates and returns file path when first line exceeds byte limit', async () => {
    await using harness = await setup()
    const longLine = 'x'.repeat(200)
    const { filePath } = await harness.createTempFile({
      content: `${longLine}\nshort\n`,
    })

    const result = await readOutputFile({
      filePath,
      maxLines: 100,
      maxBytes: 50,
    })

    expect(result).toEqual({
      content: '',
      fullOutputPath: filePath,
    })
  })

  it('returns empty content for empty file', async () => {
    await using harness = await setup()
    const { filePath } = await harness.createTempFile({ content: '' })

    const result = await readOutputFile({
      filePath,
      maxLines: 10,
      maxBytes: 1024,
    })

    expect(result).toEqual({
      content: '',
      fullOutputPath: undefined,
    })
  })
})
