import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerGuardrail } from './src/register'

export default async function (pi: ExtensionAPI) {
  await registerGuardrail({ pi })
}
