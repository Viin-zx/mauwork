import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { MioAccountView } from '@deepseek-ai/dsh-mio-account/types'
import { createMioAccountState } from '../src/client/account-state.ts'
import { SIGNED_IN, SIGNED_OUT } from './harness.client.ts'

type Frame<T> = { value: T; accept: () => void }
type OpenedStream = {
  name: string
  open(signal: AbortSignal): AsyncIterable<unknown>
  ended(accepted: boolean): Error
}

class Queue<T> {
  private items: Array<{ item?: Frame<T>; failure?: unknown }> = []
  private wake: (() => void) | undefined
  private disposed = false

  push(item: Frame<T>): void {
    this.items.push({ item })
    this.wake?.()
  }

  fail(error: unknown): void {
    this.items.push({ failure: error })
    this.wake?.()
  }

  dispose(): void {
    this.disposed = true
    this.wake?.()
  }

  async *frames(): AsyncIterable<Frame<T>> {
    while (!this.disposed) {
      const next = this.items.shift()
      if (next !== undefined) {
        if (next.failure !== undefined) throw next.failure
        if (next.item !== undefined) {
          yield next.item
          continue
        }
      }
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
  }
}

function frame<T>(value: T): Frame<T> {
  return { value, accept: vi.fn() }
}

function fixture() {
  const views = new Queue<MioAccountView>()
  const expiries = new Queue<'session-expired'>()
  const opened: OpenedStream[] = []
  const remote = {
    mioAccount: {
      watch: vi.fn(() => 'watch-handle'),
      watchExpiry: vi.fn(() => 'expiry-handle'),
    },
    $stream: vi.fn((options: OpenedStream) => {
      opened.push(options)
      options.open(new AbortController().signal)
      const queue = options.name === 'mioAccount' ? views : expiries
      return { [Symbol.asyncIterator]: () => queue.frames(), dispose: () => { queue.dispose() } }
    }),
  }
  const ctx = new Context()
  ctx.provide('remote', remote as never)
  const source = createMioAccountState(ctx)
  return { source, views, expiries, opened, remote }
}

afterEach(() => { vi.restoreAllMocks() })

describe('account state', () => {
  it('publishes the first snapshot, accepts each frame, and drops unsubscribed listeners', async () => {
    const { source, views, opened } = fixture()
    expect(source.state.getSnapshot()).toEqual({ view: undefined, expired: false })
    const listener = vi.fn()
    const stop = source.state.subscribe(listener)
    const first = frame(SIGNED_OUT)
    views.push(first)
    await vi.waitFor(() => { expect(source.state.getSnapshot().view).toBe(SIGNED_OUT) })
    expect(first.accept).toHaveBeenCalledTimes(1)
    expect(opened.map(option => option.name)).toEqual(['mioAccount', 'mioAccountExpiry'])

    stop()
    listener.mockClear()
    views.push(frame(SIGNED_OUT))
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(listener).not.toHaveBeenCalled()
    source.dispose()
  })

  it('marks an expiry, keeps it while signed out, and clears it on sign-in', async () => {
    const { source, views, expiries } = fixture()
    expiries.push(frame('session-expired'))
    await vi.waitFor(() => { expect(source.state.getSnapshot().expired).toBe(true) })
    views.push(frame(SIGNED_OUT))
    await vi.waitFor(() => { expect(source.state.getSnapshot().view).toBe(SIGNED_OUT) })
    expect(source.state.getSnapshot().expired).toBe(true)
    views.push(frame(SIGNED_IN))
    await vi.waitFor(() => { expect(source.state.getSnapshot().view).toBe(SIGNED_IN) })
    expect(source.state.getSnapshot().expired).toBe(false)
    source.dispose()
  })

  it('keeps the last snapshot when either stream fails', async () => {
    const { source, views, expiries } = fixture()
    views.push(frame(SIGNED_IN))
    await vi.waitFor(() => { expect(source.state.getSnapshot().view).toBe(SIGNED_IN) })
    views.fail(new Error('carrier lost'))
    expiries.fail(new Error('carrier lost'))
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(source.state.getSnapshot()).toEqual({ view: SIGNED_IN, expired: false })
    source.dispose()
  })

  it('classifies a normal stream end and closes both streams on dispose', () => {
    const { source, opened, remote } = fixture()
    expect(opened[0]?.ended(true)).toBeInstanceOf(Error)
    expect(opened[1]?.ended(false)).toBeInstanceOf(Error)
    source.dispose()
    expect(remote.$stream).toHaveBeenCalledTimes(2)
    const first = remote.$stream.mock.results[0]?.value as { dispose: () => void }
    expect(first.dispose).toBeTypeOf('function')
  })
})
