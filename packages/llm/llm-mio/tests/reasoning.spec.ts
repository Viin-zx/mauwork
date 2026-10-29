import { describe, expect, it } from 'vitest'
import { reasoningEffortsFor } from '../src/reasoning.ts'

describe('thinking depths by model name', () => {
  it('gives each DeepSeek snapshot the ladder its vendor accepts', () => {
    expect(reasoningEffortsFor('deepseek-v4-flash-0731')).toEqual({ low: 'low', high: 'high', max: 'max' })
    expect(reasoningEffortsFor('deepseek-v4-pro-0813')).toEqual({ low: 'low', high: 'high', max: 'max' })
    expect(reasoningEffortsFor('deepseek-v4.1-flash-1017')).toEqual({ high: 'high', max: 'max' })
    expect(reasoningEffortsFor('deepseek-v4-pro')).toEqual({ high: 'high', max: 'max' })
  })

  it('follows OpenAI ladders: GPT-5, GPT-5-pro, Codex-max, and o-series differ', () => {
    expect(reasoningEffortsFor('gpt-5')).toEqual({ off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' })
    expect(reasoningEffortsFor('gpt-5-pro')).toEqual({ high: 'high' })
    expect(reasoningEffortsFor('gpt-5.1-codex-max')).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' })
    expect(reasoningEffortsFor('gpt-5.5')).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' })
    expect(reasoningEffortsFor('o3-mini')).toEqual({ low: 'low', medium: 'medium', high: 'high' })
  })

  it('follows Anthropic: 4.6+ three levels, Sonnet 5 five', () => {
    expect(reasoningEffortsFor('claude-opus-4-7')).toEqual({ low: 'low', medium: 'medium', high: 'high' })
    expect(reasoningEffortsFor('claude-sonnet-5-5')).toEqual({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' })
  })

  it('follows Google: Gemini 3 three levels, 2.5 keeps an off', () => {
    expect(reasoningEffortsFor('gemini-3-pro')).toEqual({ low: 'low', medium: 'medium', high: 'high' })
    expect(reasoningEffortsFor('gemini-3.8-flash')).toEqual({ low: 'low', medium: 'medium', high: 'high' })
    expect(reasoningEffortsFor('gemini-2.5-pro')).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })
  })

  it('follows xAI: Grok 4.x four levels, Grok 3 mini two', () => {
    expect(reasoningEffortsFor('grok-4.7')).toEqual({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' })
    expect(reasoningEffortsFor('grok-3-mini')).toEqual({ low: 'low', high: 'high' })
  })

  it('follows GLM: 5.3 trimmed, 5.2 full, 5/5.1 stop at xhigh with none as off', () => {
    expect(reasoningEffortsFor('glm-5.3')).toEqual({ low: 'low', high: 'high', max: 'max' })
    expect(reasoningEffortsFor('glm-5.2')).toEqual({
      off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
    })
    expect(reasoningEffortsFor('glm-5.1')).toEqual({
      off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh',
    })
    expect(reasoningEffortsFor('glm-5')).toEqual({
      off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh',
    })
  })

  it('follows Qwen 3.8, Kimi K3, and MiniMax M3.1', () => {
    expect(reasoningEffortsFor('qwen3.8-max')).toEqual({ low: 'low', medium: 'medium', xhigh: 'xhigh' })
    expect(reasoningEffortsFor('kimi-k3')).toEqual({ high: 'high', max: 'max' })
    expect(reasoningEffortsFor('minimax-m3.1-flash')).toEqual({
      low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max',
    })
  })

  it('offers nothing to models that only toggle thinking or sit outside the table', () => {
    for (const id of [
      'minimax-m3', 'MiniMax-H3', 'text-embedding-v4', 'Doubao-Seedream-5.0-lite',
      'gemini-nano-banana-2.1', 'gpt-image-2.5-sunburst', 'wan2.7-image', 'wan3.0-video',
      'qwen3-max', 'kimi-k2', 'model-a',
    ]) {
      expect(reasoningEffortsFor(id)).toBeUndefined()
    }
  })
})
