/** Copy for the mioagent plugin market tab. */

export const en = {
  title: 'Plugin market',
  description: 'Plugins published for this account. Install one to use it in the current workspace.',
  refresh: 'Refresh',
  retry: 'Try again',
  loading: 'Loading plugins…',
  empty: 'No plugins are available for this account.',
  readFailed: 'Could not load the plugin market.',
  install: 'Install',
  installed: 'Installed',
  installedVersion: 'Installed v{version}',
  update: 'Update',
  updating: 'Updating…',
  updateTitle: 'Update {name}',
  updateDescription: 'The current version {installed} will be uninstalled and version {latest} reinstalled in its place. Plugin settings are kept.',
  restartToUpdate: 'Restart the client before updating this plugin.',
  updateFailed: 'Could not update the plugin.',
  updateAvailableDot: 'A plugin update is available.',
  cancel: 'Cancel',
  autoConfigured: 'Auto-configured',
} as const

/** Locale keys the market tab owns. */
export type MioPluginMarketKey = keyof typeof en

/** The market tab's Chinese copy, required to carry every {@link MioPluginMarketKey}. */
export const zh: Record<MioPluginMarketKey, string> = {
  title: '插件市场',
  description: '这里列出当前账号可安装的插件，安装后可在当前工作区直接使用。',
  refresh: '刷新',
  retry: '重试',
  loading: '正在加载插件…',
  empty: '当前账号暂无可安装的插件。',
  readFailed: '插件市场加载失败。',
  install: '安装',
  installed: '已安装',
  installedVersion: '已安装 v{version}',
  update: '更新',
  updating: '正在更新…',
  updateTitle: '更新 {name}',
  updateDescription: '会先卸载当前版本 {installed}，再重新安装最新版本 {latest}；插件设置会保留。',
  restartToUpdate: '需要重启客户端后再更新该插件。',
  updateFailed: '插件更新失败。',
  updateAvailableDot: '有可用的插件更新。',
  cancel: '取消',
  autoConfigured: '自动配置',
}
