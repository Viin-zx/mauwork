import { app } from 'electron'
import path from 'node:path'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'

/** 未登录（或缺少 userId）时使用的匿名账号标识 */
export const ANONYMOUS_ACCOUNT_KEY = 'anonymous'

/** 账号隔离数据的根目录名，位于全局 userData 下 */
const ACCOUNTS_DIR_NAME = 'accounts'

/**
 * 账号切换通过重启应用完成，因此这里用模块级状态记录「本次进程」的账号。
 * 启动阶段解析出账号后调用 setActiveAccountKey，之后所有账号路径都基于它计算。
 */
let activeAccountKey = ANONYMOUS_ACCOUNT_KEY

/** 把后端 userId 归一化为账号目录名；未登录统一落到匿名账号 */
export function resolveAccountKey(userId?: string | null): string {
  const normalized = userId?.trim()
  return normalized || ANONYMOUS_ACCOUNT_KEY
}

export function setActiveAccountKey(accountKey: string): void {
  activeAccountKey = resolveAccountKey(accountKey)
}

export function getActiveAccountKey(): string {
  return activeAccountKey
}

export function isAnonymousAccount(): boolean {
  return activeAccountKey === ANONYMOUS_ACCOUNT_KEY
}

/** 设备级数据根目录：登录凭据、日志、数据库加密元数据等不随账号隔离 */
export function getGlobalDataRoot(): string {
  return app.getPath('userData')
}

export function getAccountsRoot(): string {
  return path.join(getGlobalDataRoot(), ACCOUNTS_DIR_NAME)
}

/** 当前账号的数据根目录：所有按账号隔离的业务数据都放在这里 */
export function getAccountDataRoot(): string {
  return path.join(getAccountsRoot(), activeAccountKey)
}

/** 主库所在目录；知识库（KnowledgeBase）与记忆向量（AgentMemory）都是它的子目录 */
export function getAccountDatabaseDir(): string {
  return path.join(getAccountDataRoot(), 'app_db')
}

export function getAccountDatabasePath(): string {
  return path.join(getAccountDatabaseDir(), 'agent.db')
}

/** electron-store 配置目录（app-settings.json 等） */
export function getAccountSettingsDir(): string {
  return path.join(getAccountDataRoot(), 'settings')
}

export function getAccountSyncDir(): string {
  return path.join(getAccountDataRoot(), 'sync')
}

/** 账号默认 skill 目录 */
export function getAccountSkillsDir(): string {
  return path.join(getAccountDataRoot(), 'skills')
}

/** 旧版本使用的全局 skill 目录 */
function getLegacySkillsDir(): string {
  return path.join(app.getPath('home'), '.mauwork', 'skills')
}

/**
 * 老版本把业务数据直接放在 userData 下。首次以真实账号启动时，把这些历史数据整体归属到
 * 该账号目录，避免升级后数据「消失」。幂等：源目录不存在或目标已存在时跳过。
 *
 * 未登录（匿名）启动时不认领历史数据，历史数据会保留到用户首次登录后再归属。
 */
export function adoptLegacyGlobalData(): void {
  if (isAnonymousAccount()) {
    return
  }

  const globalRoot = getGlobalDataRoot()
  mkdirSync(getAccountDataRoot(), { recursive: true })

  moveEntry(path.join(globalRoot, 'app_db'), getAccountDatabaseDir())
  moveEntry(
    path.join(globalRoot, 'provider_models'),
    path.join(getAccountDataRoot(), 'provider_models')
  )

  const settingsFile = path.join(getAccountSettingsDir(), 'app-settings.json')
  moveEntry(path.join(globalRoot, 'app-settings.json'), settingsFile)
  // app-settings 里持久化的 skillsPath / syncFolderPath 默认值仍指向旧的全局目录，
  // 归属到账号后需要同步改写，否则会继续读写账号外的路径。
  rewriteLegacyAccountPaths(settingsFile, globalRoot)

  // 旧 skills 目录在 home 下，同样按账号归属；账号已有 skills 时不覆盖
  if (!existsSync(getAccountSkillsDir())) {
    moveEntry(getLegacySkillsDir(), getAccountSkillsDir())
  }
  // 旧默认同步目录在全局 userData 下，仅在未被用户自定义时才归属
  moveEntry(path.join(globalRoot, 'sync'), getAccountSyncDir())
}

/** 把 app-settings.json 中指向旧全局位置的 skillsPath / syncFolderPath 改写为账号目录 */
function rewriteLegacyAccountPaths(settingsFile: string, globalRoot: string): void {
  if (!existsSync(settingsFile)) {
    return
  }
  let snapshot: Record<string, unknown>
  try {
    snapshot = JSON.parse(readFileSync(settingsFile, 'utf-8')) as Record<string, unknown>
  } catch {
    return
  }

  let changed = false
  if (snapshot.skillsPath === getLegacySkillsDir()) {
    snapshot.skillsPath = getAccountSkillsDir()
    changed = true
  }
  if (snapshot.syncFolderPath === path.join(globalRoot, 'sync')) {
    snapshot.syncFolderPath = getAccountSyncDir()
    changed = true
  }

  if (changed) {
    writeFileSync(settingsFile, JSON.stringify(snapshot, null, '\t'), 'utf-8')
  }
}

/** 同分区优先 rename；跨分区回退为复制后删除 */
function moveEntry(source: string, target: string): void {
  if (!existsSync(source) || existsSync(target)) {
    return
  }
  mkdirSync(path.dirname(target), { recursive: true })
  try {
    renameSync(source, target)
  } catch {
    cpSync(source, target, { recursive: true })
    rmSync(source, { recursive: true, force: true })
  }
}
