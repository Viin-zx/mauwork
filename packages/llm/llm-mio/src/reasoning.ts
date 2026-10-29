/**
 * The selectable thinking depths each mioagent model offers, decided from the
 * model name the administration gave it rather than from a backend field:
 * catalog entries carry no per-model reasoning metadata, and the gateway's own
 * level list is shared by every model.
 */

import type { PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'

/** One name family and the depths its models accept. */
interface ReasoningFamily {
  /** Tested against the administration's model id; case-insensitive so `MiniMax-H3` matches. */
  readonly family: RegExp
  /** pi-ai levels this family offers; the value is the wire spelling sent as `reasoning_effort`. */
  readonly efforts: PiAiReasoningEfforts
}

/**
 * Families in match order, first match wins. Add a row when the catalog starts
 * serving another reasoning model; a model matching no row offers no depths and
 * the selector hides the effort menu for it.
 */
const REASONING_FAMILIES: readonly ReasoningFamily[] = [
  { family: /^deepseek-(?:v4|reasoner|r1)/iu, efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },
  { family: /^minimax-/iu, efforts: { off: null, low: 'low', high: 'high' } },
]

/**
 * Resolve one catalog model's thinking depths from its name.
 * @param modelId - the administration's model id, as the catalog serves it.
 * @returns the declared depths, or undefined when the model offers none.
 */
export function reasoningEffortsFor(modelId: string): PiAiReasoningEfforts | undefined {
  return REASONING_FAMILIES.find(rule => rule.family.test(modelId))?.efforts
}
