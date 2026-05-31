import type { AutocompleteItem } from '@earendil-works/pi-tui'

const guardrailSubcommands: readonly AutocompleteItem[] = [
  { value: 'status', label: 'status', description: 'Show the current mode and policy health.' },
  { value: 'read-only', label: 'read-only', description: 'Switch to read-only mode.' },
  { value: 'hand-hold', label: 'hand-hold', description: 'Switch to hand-hold mode.' },
  { value: 'off', label: 'off', description: 'Disable enforcement for the model.' },
  { value: 'reload', label: 'reload', description: 'Re-read and apply guardrail.yaml.' },
  { value: 'doctor', label: 'doctor', description: 'Diagnose the policy configuration.' },
  { value: 'discover', label: 'discover <cli>', description: 'Discover a CLI\u2019s commands into an import policy.' },
  {
    value: 'reset-to-default',
    label: 'reset-to-default',
    description: 'Overwrite guardrail.yaml with the shipped default.',
  },
]

export function completeGuardrailArguments(
  argumentPrefix: string
): AutocompleteItem[] | null {
  const prefix = argumentPrefix.trimStart()
  const matches = guardrailSubcommands.filter((item) =>
    item.value.startsWith(prefix)
  )
  return matches.length > 0 ? [...matches] : null
}
