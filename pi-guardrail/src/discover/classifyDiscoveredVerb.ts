// Verb-based read/write heuristic adapted from ~/Projects/assist (MIT-licensed)
// permitCliReads/classifyVerb. Dangerous is never inferred automatically; a
// discovered command is classified read, write, or unknown only.
export type DiscoveredClassification = 'read' | 'write' | 'unknown'

const READ_VERBS = new Set([
  'list',
  'show',
  'view',
  'export',
  'get',
  'diff',
  'status',
  'search',
  'checks',
  'describe',
  'inspect',
  'logs',
  'cat',
  'top',
  'explain',
  'exists',
  'browse',
  'watch',
])

const WRITE_VERBS = new Set([
  'create',
  'delete',
  'import',
  'set',
  'update',
  'merge',
  'close',
  'reopen',
  'edit',
  'apply',
  'patch',
  'drain',
  'cordon',
  'taint',
  'push',
  'deploy',
  'add',
  'remove',
  'assign',
  'unassign',
  'lock',
  'unlock',
  'start',
  'stop',
  'restart',
  'enable',
  'disable',
  'revoke',
  'rotate',
])

export function classifyDiscoveredVerb(
  path: readonly string[]
): DiscoveredClassification {
  let hasRead = false
  for (const segment of path) {
    if (WRITE_VERBS.has(segment)) return 'write'
    if (READ_VERBS.has(segment)) hasRead = true
  }
  return hasRead ? 'read' : 'unknown'
}
