import { open, readFile } from 'node:fs/promises'
import { createCliRequestOutput } from './createCliRequestOutput'
import { evaluateStreams, type InputSource } from './evaluateStreams'

const defaultDeps = {
  createCliRequestOutput,
}

function chooseInputSource(params: {
  inputText: string | undefined
  inputJsonl: string | undefined
}): InputSource {
  const hasInputText =
    typeof params.inputText === 'string' && params.inputText.length > 0
  const hasInputJsonl =
    typeof params.inputJsonl === 'string' && params.inputJsonl.length > 0
  if (hasInputText && hasInputJsonl) {
    throw new Error('Pass only one of --input-text or --input-jsonl, not both.')
  }
  if (hasInputText && typeof params.inputText === 'string') {
    return { type: 'text', path: params.inputText }
  }
  if (hasInputJsonl && typeof params.inputJsonl === 'string') {
    return { type: 'jsonl', path: params.inputJsonl }
  }
  throw new Error(
    '--input-text or --input-jsonl is required: pass a sample file (use <(cat file) for process substitution).'
  )
}

export async function evaluate(
  params: {
    model: string
    criteria: string
    inputText?: string
    inputJsonl?: string
    output: string
  },
  deps = defaultDeps
): Promise<void> {
  const inputSource = chooseInputSource({
    inputText: params.inputText,
    inputJsonl: params.inputJsonl,
  })

  const { singleShotRequest } = deps.createCliRequestOutput({
    model: params.model,
  })

  const criteria = await readFile(params.criteria, 'utf8')

  await using inputHandle = await open(inputSource.path, 'r')
  await using outputHandle = await open(params.output, 'a')

  await evaluateStreams({
    input: { type: inputSource.type, stream: inputHandle.createReadStream() },
    output: outputHandle.createWriteStream(),
    criteria,
    singleShotRequest,
    onError: ({ error }) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  })
}

evaluate.defaultDeps = defaultDeps
