import { open, stat } from 'node:fs/promises'
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from '@earendil-works/pi-coding-agent'

export async function readOutputFile(params: {
  filePath: string
  maxLines?: number
  maxBytes?: number
}): Promise<{ content: string; fullOutputPath: string | undefined }> {
  const maxLines = params.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = params.maxBytes ?? DEFAULT_MAX_BYTES

  const fileSize = (await stat(params.filePath)).size
  if (fileSize === 0) {
    return { content: '', fullOutputPath: undefined }
  }

  const handle = await open(params.filePath, 'r')
  try {
    const lines: string[] = []
    let totalBytes = 0

    for await (const line of handle.readLines({ encoding: 'utf-8' })) {
      const lineBytes = Buffer.byteLength(line, 'utf-8') + 1
      if (lines.length >= maxLines || totalBytes + lineBytes > maxBytes) {
        return {
          content: lines.length > 0 ? `${lines.join('\n')}\n` : '',
          fullOutputPath: params.filePath,
        }
      }
      lines.push(line)
      totalBytes += lineBytes
    }

    return { content: `${lines.join('\n')}\n`, fullOutputPath: undefined }
  } finally {
    await handle.close()
  }
}
