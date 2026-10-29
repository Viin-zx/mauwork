/**
 * Thinking depths offered per model, decided from the model name the
 * administration gave it. Catalog entries carry no per-model reasoning
 * metadata, and a gateway's own effort list is shared by every model, so this
 * table is the one place that knows which subset a vendor actually accepts.
 * Wire values are the level strings the vendor documents (forwarded as
 * `reasoning_effort`); a level this table omits is pinned unsupported, and a
 * model matching no row offers no effort menu at all.
 */

import type { PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'

/** One name family and the depths its models accept. */
interface ReasoningFamily {
  /** Tested against the lowercase model id, so `MiniMax-H3` and `minimax-h3` match alike. */
  readonly family: RegExp
  /** Levels in pi-ai's vocabulary; each value is the wire spelling, `null` disables the level. */
  readonly efforts: PiAiReasoningEfforts
}

/**
 * Families in match order, first match wins. Rows follow each vendor's
 * published `reasoning_effort` set (2026-10); a model matching no row offers
 * no depths. Add a row when the catalog starts serving another reasoning model.
 */
const REASONING_FAMILIES: readonly ReasoningFamily[] = [
  // OpenAI: the Responses-era ladders. `off` is omission, which these models read as `none`.
  { family: /^gpt-5\.1-codex-max/u, efforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } },
  { family: /^gpt-5\.5/u, efforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } },
  { family: /^gpt-5-pro/u, efforts: { high: 'high' } },
  { family: /^gpt-5/u, efforts: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' } },
  { family: /^o[134](?:-|$)/u, efforts: { low: 'low', medium: 'medium', high: 'high' } },

  // Anthropic: adaptive thinking is steered by effort; 4.6+ spans three levels, 5.x five.
  { family: /^claude-sonnet-5/u, efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  { family: /^claude-(?:opus|sonnet)-4[.-][6-9]/u, efforts: { low: 'low', medium: 'medium', high: 'high' } },

  // Google: Gemini 3 Pro takes three levels, Flash the same (3.7/3.8 reject `minimal`).
  { family: /^gemini-3(?:\.\d+)?-pro/u, efforts: { low: 'low', medium: 'medium', high: 'high' } },
  { family: /^gemini-3(?:\.\d+)?-flash(?:-lite)?/u, efforts: { low: 'low', medium: 'medium', high: 'high' } },
  { family: /^gemini-2\.5/u, efforts: { off: null, low: 'low', medium: 'medium', high: 'high' } },

  // xAI: Grok 4.x exposes four levels; Grok 3 mini only two.
  { family: /^grok-(?:4|5)/u, efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } },
  { family: /^grok-3-mini/u, efforts: { low: 'low', high: 'high' } },

  // DeepSeek on DashScope: the -0731/-0813 snapshot accepts three levels; siblings collapse to high/max.
  { family: /^deepseek-.*(?:flash-0731|pro-0813)/u, efforts: { low: 'low', high: 'high', max: 'max' } },
  { family: /^deepseek-(?:v4|v3\.1|reasoner|r1)/u, efforts: { high: 'high', max: 'max' } },

  // GLM: 5.3 trimmed the ladder; 5.2 keeps all seven; 5/5.1 stop at xhigh. `none` is its off.
  { family: /^glm-5\.3/u, efforts: { low: 'low', high: 'high', max: 'max' } },
  { family: /^glm-5\.2/u, efforts: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  { family: /^glm-5(?:\.1)?(?:-|$)/u, efforts: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } },

  // Qwen 3.8 renamed its ladder; earlier Qwen generations only toggle thinking.
  { family: /^qwen3\.8/u, efforts: { low: 'low', medium: 'medium', xhigh: 'xhigh' } },

  // Kimi K3 joins the DeepSeek-V4 ladder on DashScope.
  { family: /^kimi(?:-k3|k3)/u, efforts: { high: 'high', max: 'max' } },

  // MiniMax steers depth through effort only on M3.1; M3 and earlier toggle thinking.
  { family: /^minimax-m3\.1/u, efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
]

/**
 * Resolve one catalog model's thinking depths from its name.
 * @param modelId - the administration's model id, as the catalog serves it.
 * @returns the declared depths, or undefined when the model offers none.
 */
export function reasoningEffortsFor(modelId: string): PiAiReasoningEfforts | undefined {
  const id = modelId.toLowerCase()
  return REASONING_FAMILIES.find(rule => rule.family.test(id))?.efforts
}
