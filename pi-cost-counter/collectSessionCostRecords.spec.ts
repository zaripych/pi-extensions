import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { combineHarnesses } from 'foundation/testing/harness/combineHarnesses'
import { describe, expect, it } from 'vitest'
import { setupCollectSessionCostRecords } from './collectSessionCostRecords.harness'

const setup = combineHarnesses(setupCollectSessionCostRecords)

function sessionHeaderLine(params: { id: string; cwd: string }) {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id: params.id,
    timestamp: new Date(0).toISOString(),
    cwd: params.cwd,
  })
}

function costOf(total: number) {
  return { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total }
}

function assistantMessageLine(params: {
  ts: number
  provider: string
  model: string
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  tokens?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
}) {
  return JSON.stringify({
    type: 'message',
    message: {
      role: 'assistant',
      provider: params.provider,
      model: params.model,
      timestamp: params.ts,
      content: [{ type: 'text', text: 'hi' }],
      usage: { ...params.tokens, cost: params.cost },
    },
  })
}

async function writeSessionFile(params: {
  sessionsDir: string
  relativePath: string
  lines: string[]
}) {
  const path = join(params.sessionsDir, params.relativePath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${params.lines.join('\n')}\n`, 'utf8')
}

describe('collectSessionCostRecords', () => {
  it('collects cost records from assistant messages across nested session files', async () => {
    await using harness = await setup()
    const { collectSessionCostRecords, sessionsDir } = harness

    await writeSessionFile({
      sessionsDir,
      relativePath: join('project-a', 'session-1.jsonl'),
      lines: [
        assistantMessageLine({
          ts: 1000,
          provider: 'anthropic',
          model: 'model-a',
          cost: {
            input: 0.1,
            output: 0.2,
            cacheRead: 0.01,
            cacheWrite: 0.02,
            total: 0.33,
          },
          tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
        }),
      ],
    })
    await writeSessionFile({
      sessionsDir,
      relativePath: join('project-b', 'session-2.jsonl'),
      lines: [
        assistantMessageLine({
          ts: 2000,
          provider: 'openai',
          model: 'model-b',
          cost: {
            input: 0.5,
            output: 0.6,
            cacheRead: 0,
            cacheWrite: 0,
            total: 1.1,
          },
        }),
      ],
    })

    const result = await collectSessionCostRecords({
      start: new Date(0),
      end: new Date(10_000),
    })

    expect(result).toEqual({
      stats: { invalidJsonLines: 0, schemaMismatchLines: 0 },
      records: [
      {
        ts: 1000,
        sessionId: 'unknown',
        cwd: 'unknown',
        provider: 'anthropic',
        model: 'model-a',
        tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
        cost: {
          input: 0.1,
          output: 0.2,
          cacheRead: 0.01,
          cacheWrite: 0.02,
          total: 0.33,
        },
      },
      {
        ts: 2000,
        sessionId: 'unknown',
        cwd: 'unknown',
        provider: 'openai',
        model: 'model-b',
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: { input: 0.5, output: 0.6, cacheRead: 0, cacheWrite: 0, total: 1.1 },
      },
      ],
    })
  })

  it('excludes messages outside the range even when their session file spans the boundary', async () => {
    await using harness = await setup()
    const { collectSessionCostRecords, sessionsDir } = harness

    await writeSessionFile({
      sessionsDir,
      relativePath: join('project-a', 'spanning-session.jsonl'),
      lines: [
        assistantMessageLine({
          ts: 500,
          provider: 'anthropic',
          model: 'model-a',
          cost: costOf(0.1),
        }),
        assistantMessageLine({
          ts: 1500,
          provider: 'anthropic',
          model: 'model-a',
          cost: costOf(0.2),
        }),
        assistantMessageLine({
          ts: 2500,
          provider: 'anthropic',
          model: 'model-a',
          cost: costOf(0.4),
        }),
      ],
    })

    const result = await collectSessionCostRecords({
      start: new Date(1000),
      end: new Date(2000),
    })

    expect(result).toEqual({
      stats: { invalidJsonLines: 0, schemaMismatchLines: 0 },
      records: [
      {
        ts: 1500,
        sessionId: 'unknown',
        cwd: 'unknown',
        provider: 'anthropic',
        model: 'model-a',
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: costOf(0.2),
      },
      ],
    })
  })

  it('skips non-assistant messages, assistant messages without cost, and malformed lines', async () => {
    await using harness = await setup()
    const { collectSessionCostRecords, sessionsDir } = harness

    await writeSessionFile({
      sessionsDir,
      relativePath: join('project-a', 'session.jsonl'),
      lines: [
        JSON.stringify({ type: 'session', version: 3, id: 'abc' }),
        JSON.stringify({
          type: 'message',
          message: { role: 'user', content: [], timestamp: 1100 },
        }),
        JSON.stringify({
          type: 'message',
          message: { role: 'assistant', content: [], timestamp: 1200 },
        }),
        'not json at all {{{',
        assistantMessageLine({
          ts: 1300,
          provider: 'anthropic',
          model: 'model-a',
          cost: costOf(0.7),
        }),
      ],
    })

    const result = await collectSessionCostRecords({
      start: new Date(0),
      end: new Date(10_000),
    })

    expect(result).toEqual({
      stats: { invalidJsonLines: 1, schemaMismatchLines: 1 },
      records: [
      {
        ts: 1300,
        sessionId: 'unknown',
        cwd: 'unknown',
        provider: 'anthropic',
        model: 'model-a',
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: costOf(0.7),
      },
      ],
    })
  })

  it('attaches sessionId and cwd from the session header to each record', async () => {
    await using harness = await setup()
    const { collectSessionCostRecords, sessionsDir } = harness

    await writeSessionFile({
      sessionsDir,
      relativePath: join('project-a', 'session-1.jsonl'),
      lines: [
        sessionHeaderLine({ id: 'session-one', cwd: '/home/user/project-a' }),
        assistantMessageLine({
          ts: 1000,
          provider: 'anthropic',
          model: 'model-a',
          cost: costOf(0.1),
        }),
      ],
    })
    await writeSessionFile({
      sessionsDir,
      relativePath: join('project-b', 'session-2.jsonl'),
      lines: [
        sessionHeaderLine({ id: 'session-two', cwd: '/home/user/project-b' }),
        assistantMessageLine({
          ts: 2000,
          provider: 'anthropic',
          model: 'model-a',
          cost: costOf(0.2),
        }),
      ],
    })

    const result = await collectSessionCostRecords({
      start: new Date(0),
      end: new Date(10_000),
    })

    expect(result.records).toEqual([
      expect.objectContaining({
        ts: 1000,
        sessionId: 'session-one',
        cwd: '/home/user/project-a',
      }),
      expect.objectContaining({
        ts: 2000,
        sessionId: 'session-two',
        cwd: '/home/user/project-b',
      }),
    ])
  })

  it('returns no records when the sessions directory does not exist', async () => {
    await using harness = await setup({
      getSessionsDir: () => '/nonexistent/sessions/dir',
    })
    const { collectSessionCostRecords } = harness

    const result = await collectSessionCostRecords({
      start: new Date(0),
      end: new Date(10_000),
    })

    expect(result).toEqual({
      records: [],
      stats: { invalidJsonLines: 0, schemaMismatchLines: 0 },
    })
  })
})
