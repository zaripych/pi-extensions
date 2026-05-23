import { stringify as stringifyYaml } from 'yaml'
import { reviewConfigSchema } from './validateConfig'

function wrapComment(text: string, maxWidth = 80): string {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = '#'
  for (const word of words) {
    if (current.length + 1 + word.length > maxWidth && current !== '#') {
      lines.push(current)
      current = `# ${word}`
    } else {
      current += ` ${word}`
    }
  }
  if (current !== '#') lines.push(current)
  return lines.join('\n')
}

function commentOutYaml(yaml: string): string {
  return yaml
    .split('\n')
    .map((line) => (line.length > 0 ? `# ${line}` : ''))
    .join('\n')
}

export function generateExampleConfig(): string {
  const shape = reviewConfigSchema._zod.def.shape
  const sections: string[] = []

  for (const [key, field] of Object.entries(shape)) {
    const schema = field
    const description = schema.description
    const defaultValue =
      'defaultValue' in schema._zod.def
        ? schema._zod.def.defaultValue
        : undefined

    if (description) {
      sections.push(wrapComment(description))
    }

    const hasDefault = defaultValue !== undefined
    const isOptionalNoDefault = !hasDefault

    if (isOptionalNoDefault) {
      const exampleLines =
        key === 'model' ? 'model: provider/model-id' : `${key}:`
      sections.push(commentOutYaml(exampleLines))
    } else {
      const yaml = stringifyYaml({ [key]: defaultValue }).trimEnd()
      sections.push(yaml)
    }

    sections.push('')
  }

  return [sections.join('\n').trimEnd(), ''].join('\n')
}
