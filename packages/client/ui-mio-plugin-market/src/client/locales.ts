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
  autoConfigured: 'Auto-configured',
} as const

/** Locale keys the market tab owns. */
export type MioPluginMarketKey = keyof typeof en

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
  autoConfigured: '自动配置',
}
