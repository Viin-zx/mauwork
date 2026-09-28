import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  paths: { userData: '', home: '' }
}))

// 该用例依赖真实文件系统做目录搬迁，需还原 test/setup.ts 对 fs 的全局 mock
vi.unmock('fs')

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return mocks.paths.userData
      if (name === 'home') return mocks.paths.home
      return '/mock/path'
    }
  }
}))

import {
  ANONYMOUS_ACCOUNT_KEY,
  adoptLegacyGlobalData,
  getAccountDataRoot,
  getAccountDatabasePath,
  getAccountSettingsDir,
  getAccountSkillsDir,
  getAccountSyncDir,
  getAccountsRoot,
  getActiveAccountKey,
  resolveAccountKey,
  setActiveAccountKey
} from '@/app/accountDataRoot'

const ACCOUNT_KEY = '42'

let userDataRoot: string
let homeRoot: string

const legacySkillsDir = (): string => path.join(homeRoot, '.deepchat', 'skills')
const accountRoot = (key = ACCOUNT_KEY): string => path.join(userDataRoot, 'accounts', key)

function seedLegacyGlobalData(): void {
  mkdirSync(path.join(userDataRoot, 'app_db'), { recursive: true })
  writeFileSync(path.join(userDataRoot, 'app_db', 'agent.db'), 'legacy-db')

  mkdirSync(path.join(userDataRoot, 'provider_models'), { recursive: true })
  writeFileSync(path.join(userDataRoot, 'provider_models', 'openai.json'), '{}')

  writeFileSync(
    path.join(userDataRoot, 'app-settings.json'),
    JSON.stringify({
      skillsPath: legacySkillsDir(),
      syncFolderPath: path.join(userDataRoot, 'sync'),
      appVersion: '1.0.0'
    })
  )

  mkdirSync(legacySkillsDir(), { recursive: true })
  writeFileSync(path.join(legacySkillsDir(), 'SKILL.md'), 'legacy-skill')

  mkdirSync(path.join(userDataRoot, 'sync'), { recursive: true })
  writeFileSync(path.join(userDataRoot, 'sync', 'snapshot.json'), '{}')
}

beforeEach(() => {
  userDataRoot = mkdtempSync(path.join(os.tmpdir(), 'mauwork-userdata-'))
  homeRoot = mkdtempSync(path.join(os.tmpdir(), 'mauwork-home-'))
  mocks.paths.userData = userDataRoot
  mocks.paths.home = homeRoot
  setActiveAccountKey(ANONYMOUS_ACCOUNT_KEY)
})

afterEach(() => {
  rmSync(userDataRoot, { recursive: true, force: true })
  rmSync(homeRoot, { recursive: true, force: true })
})

describe('resolveAccountKey', () => {
  it('falls back to the anonymous key when no user id is present', () => {
    expect(resolveAccountKey(undefined)).toBe(ANONYMOUS_ACCOUNT_KEY)
    expect(resolveAccountKey(null)).toBe(ANONYMOUS_ACCOUNT_KEY)
    expect(resolveAccountKey('')).toBe(ANONYMOUS_ACCOUNT_KEY)
    expect(resolveAccountKey('   ')).toBe(ANONYMOUS_ACCOUNT_KEY)
  })

  it('trims and keeps a real user id', () => {
    expect(resolveAccountKey(' 42 ')).toBe('42')
  })
})

describe('account paths', () => {
  it('resolves every business path under the active account directory', () => {
    setActiveAccountKey(ACCOUNT_KEY)

    expect(getActiveAccountKey()).toBe(ACCOUNT_KEY)
    expect(getAccountsRoot()).toBe(path.join(userDataRoot, 'accounts'))
    expect(getAccountDataRoot()).toBe(accountRoot())
    expect(getAccountDatabasePath()).toBe(path.join(accountRoot(), 'app_db', 'agent.db'))
    expect(getAccountSettingsDir()).toBe(path.join(accountRoot(), 'settings'))
    expect(getAccountSkillsDir()).toBe(path.join(accountRoot(), 'skills'))
    expect(getAccountSyncDir()).toBe(path.join(accountRoot(), 'sync'))
  })

  it('normalizes an empty account key back to anonymous', () => {
    setActiveAccountKey('')

    expect(getActiveAccountKey()).toBe(ANONYMOUS_ACCOUNT_KEY)
    expect(getAccountDataRoot()).toBe(accountRoot(ANONYMOUS_ACCOUNT_KEY))
  })
})

describe('adoptLegacyGlobalData', () => {
  it('leaves legacy global data untouched when starting as anonymous', () => {
    seedLegacyGlobalData()

    adoptLegacyGlobalData()

    expect(existsSync(path.join(userDataRoot, 'app_db', 'agent.db'))).toBe(true)
    expect(existsSync(path.join(userDataRoot, 'app-settings.json'))).toBe(true)
    expect(existsSync(accountRoot(ANONYMOUS_ACCOUNT_KEY))).toBe(false)
  })

  it('moves legacy global data into the signed-in account and rewrites paths', () => {
    seedLegacyGlobalData()
    setActiveAccountKey(ACCOUNT_KEY)

    adoptLegacyGlobalData()

    expect(readFileSync(path.join(accountRoot(), 'app_db', 'agent.db'), 'utf-8')).toBe('legacy-db')
    expect(existsSync(path.join(accountRoot(), 'provider_models', 'openai.json'))).toBe(true)
    expect(existsSync(path.join(accountRoot(), 'skills', 'SKILL.md'))).toBe(true)
    expect(existsSync(path.join(accountRoot(), 'sync', 'snapshot.json'))).toBe(true)

    expect(existsSync(path.join(userDataRoot, 'app_db'))).toBe(false)
    expect(existsSync(path.join(userDataRoot, 'provider_models'))).toBe(false)
    expect(existsSync(path.join(userDataRoot, 'app-settings.json'))).toBe(false)
    expect(existsSync(path.join(userDataRoot, 'sync'))).toBe(false)
    expect(existsSync(legacySkillsDir())).toBe(false)

    const settings = JSON.parse(
      readFileSync(path.join(accountRoot(), 'settings', 'app-settings.json'), 'utf-8')
    )
    expect(settings.skillsPath).toBe(getAccountSkillsDir())
    expect(settings.syncFolderPath).toBe(getAccountSyncDir())
    expect(settings.appVersion).toBe('1.0.0')
  })

  it('is idempotent and never overwrites data already owned by the account', () => {
    seedLegacyGlobalData()
    setActiveAccountKey(ACCOUNT_KEY)
    adoptLegacyGlobalData()

    // 再次出现同名历史目录时，账号目录已有数据，不应被覆盖
    mkdirSync(path.join(userDataRoot, 'app_db'), { recursive: true })
    writeFileSync(path.join(userDataRoot, 'app_db', 'agent.db'), 'stale-legacy-db')

    adoptLegacyGlobalData()

    expect(readFileSync(path.join(accountRoot(), 'app_db', 'agent.db'), 'utf-8')).toBe('legacy-db')
    expect(existsSync(path.join(userDataRoot, 'app_db'))).toBe(true)
  })
})
