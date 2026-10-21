// @vitest-environment jsdom
import { expect, vi } from 'vitest'
import { openStream, ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { MioAccountInjected } from '../src/client/operations.ts'
import { apply as hostApply } from '../src/index.ts'
import { AGREEMENTS, SIGNED_OUT } from './harness.client.ts'

const SELF = '@deepseek-ai/dsh-client-ui-mio-account'
const roster = webApp.closure([SELF, '@deepseek-ai/dsh-client-ui-settings-general'])
const it = createClientTest({ roster }, { mount: true })

it('keeps the host row inert', () => {
  expect(hostApply).not.toThrow()
})

it('registers the gate and launcher against the account Remote and survives a reload', async ({ start, mock }) => {
  mock.unary('mioAccount/getAgreements', ok(AGREEMENTS))
  const c = await start()
  await c.mock.streams.opened('mioAccount/watch', 1)
  await c.mock.streams.opened('mioAccount/watchExpiry', 1)

  const overlay = c.ctx.slots.entries('shell.overlay').find(entry => entry.options.id === 'mio-account.login')
  const launcher = c.ctx.slots.entries('settings.launcher')[0]
  expect(overlay).toBeDefined()
  expect(launcher).toBeDefined()
  const gate: object = overlay!.inject!()
  const menu: object = launcher!.inject!()
  const gateFace = gate as MioAccountInjected
  const menuFace = menu as MioAccountInjected
  expect(menuFace.hooks.account.getSnapshot().view?.status).toBe('signed-in')
  expect(await gateFace.getAgreements()).toEqual(AGREEMENTS)
  expect(document.querySelector('[data-testid="mio-login-gate"]')).toBeNull()

  await c.reload(SELF)
  await c.mock.streams.opened('mioAccount/watch', 2)
  await c.mock.streams.opened('mioAccount/watchExpiry', 2)
  expect(c.ctx.slots.entries('shell.overlay').some(entry => entry.options.id === 'mio-account.login')).toBe(true)
  expect(c.ctx.slots.entries('settings.launcher')).toHaveLength(1)
}, 60_000)

it('blocks the application with the login gate while the Host reports a signed-out session', async ({ start, mock }) => {
  mock.stream('mioAccount/watch', openStream([SIGNED_OUT]))
  mock.unary('mioAccount/getAgreements', ok(AGREEMENTS))
  await start()
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="mio-login-gate"]')).not.toBeNull()
  })
  expect(document.querySelector('[data-testid="mio-login-form"]')).not.toBeNull()
}, 60_000)
