import { describe, expect, it } from 'vitest'
import { reasoningEffortsFor } from '../src/reasoning.ts'

describe('thinking depths by model name', () => {
  it('offers the DeepSeek chat families three thinking levels and off', () => {
    const deepseek = { off: null, low: 'low', medium: 'medium', high: 'high' }
    expect(reasoningEffortsFor('deepseek-v4.1-flash-1017')).toEqual(deepseek)
    expect(reasoningEffortsFor('deepseek-v4-flash-0731')).toEqual(deepseek)
    expect(reasoningEffortsFor('deepseek-reasoner')).toEqual(deepseek)
    expect(reasoningEffortsFor('deepseek-r1')).toEqual(deepseek)
  })

  it('matches MiniMax ids case-insensitively', () => {
    const minimax = { off: null, low: 'low', high: 'high' }
    expect(reasoningEffortsFor('minimax-m3')).toEqual(minimax)
    expect(reasoningEffortsFor('MiniMax-H3')).toEqual(minimax)
  })

  it('offers nothing to models outside the table', () => {
    for (const id of [
      'text-embedding-v4', 'Doubao-Seedream-5.0-lite', 'gemini-nano-banana-2.1',
      'gpt-image-2.5-sunburst', 'wan2.7-image', 'wan3.0-video', 'model-a',
    ]) {
      expect(reasoningEffortsFor(id)).toBeUndefined()
    }
  })
})
