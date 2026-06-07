import { hashContent } from './hashContent'

const displayHashLength = 7

export function shortHash(content: string): string {
  return hashContent(content).slice(0, displayHashLength)
}
