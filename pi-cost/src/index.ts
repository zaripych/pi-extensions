/**
 * Cost extension for pi: subscription spend, model usage, and value.
 *
 * Provides the /cost command — a tabbed report over Pi session tokens and
 * captured provider billing (OpenAI, Anthropic, Neuralwatt), with
 * amortized/consumption cost modes and Artificial Analysis intelligence.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { registerCostCommand } from './cost-command/registerCostCommand'

export default function (pi: ExtensionAPI): void {
  registerCostCommand(pi)
}
