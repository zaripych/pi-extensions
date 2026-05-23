import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function spawnToFile(params: {
  command: string
  args: string[]
  cwd?: string
}): Promise<string> {
  const filePath = join(
    tmpdir(),
    `pi-review-${randomBytes(8).toString('hex')}.txt`
  )

  const handle = await open(filePath, 'w')
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(params.command, params.args, {
        stdio: ['ignore', handle.fd, 'pipe'],
        cwd: params.cwd,
      })

      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `Command failed: ${params.command} ${params.args.join(' ')}\n${stderr}`.trim()
            )
          )
        } else {
          resolve(filePath)
        }
      })
    })
  } finally {
    await handle.close()
  }
}
