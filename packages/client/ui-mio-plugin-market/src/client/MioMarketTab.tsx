/** The Plugins page tab listing the mioagent plugin catalog. */
import { useEffect, useState } from 'react'
import {
  Button, IconPinFillRegular, IconPinOutlineRegular, Modal, PluginArtworkDefault, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MioPluginListing } from '@deepseek-ai/dsh-mio-account/types'
import { orderMarketItems, updateAvailable, type MioMarketFace } from './market-store.ts'
import css from './MioMarketTab.module.css'

/** Props assembled by the Plugins page tab renderer. */
export type MioMarketTabProps =
  & PropsRuntime<'plugins.tab'>
  & PropsLocale<'mioPluginMarket'>
  & InjectFace<MioMarketFace>

/**
 * Render the account's plugin catalog and install entries through the page's
 * own install dialog. Pinned entries lead the grid in pin order.
 * @param props - tab actions, catalog and pin state, and localized copy.
 * @returns the market tab.
 */
export function MioMarketTab({ install, openPackage, useMarket, usePinned, ensure, reload, update, togglePin, t }: MioMarketTabProps) {
  const state = useMarket(value => value)
  const pinned = usePinned(value => value)
  const [pendingUpdate, setPendingUpdate] = useState<MioPluginListing | null>(null)
  useEffect(() => { ensure() }, [ensure])
  const busy = state.status === 'loading'
  const pinnedNames = new Set(pinned)
  const items = orderMarketItems(state.items, pinned)
  const updateError = state.updateError === 'restart-required'
    ? t('restartToUpdate')
    : state.updateError === 'update-failed' ? t('updateFailed') : state.updateError

  return <section className={css.root} data-testid="mio-plugin-market">
    <header className={css.header}>
      <div className={css.heading}>
        <h2 className={css.title}>{t('title')}</h2>
        <p className={css.description}>{t('description')}</p>
      </div>
      <Button variant="outline" size="sm" disabled={busy} onClick={reload}>{t('refresh')}</Button>
    </header>

    {state.status === 'loading' && state.items.length === 0
      ? <p className={css.status} role="status">{t('loading')}</p>
      : null}
    {state.status === 'error'
      ? <div className={css.failure} role="alert">
        <span>{state.error === '' ? t('readFailed') : state.error}</span>
        <Button variant="outline" size="sm" onClick={reload}>{t('retry')}</Button>
      </div>
      : null}
    {state.status === 'ready' && state.items.length === 0
      ? <p className={css.status}>{t('empty')}</p>
      : null}
    {updateError !== ''
      ? <div className={css.failure} role="alert"><span>{updateError}</span></div>
      : null}

    {items.length > 0
      ? <div className={css.grid}>
        {items.map((item) => {
          const installed = state.installed.includes(item.packageName)
          const installedVersion = state.installedVersions[item.packageName]
          const latest = state.latestVersions[item.packageName]
          const canUpdate = installed && updateAvailable(installedVersion, latest)
          const isPinned = pinnedNames.has(item.packageName)
          return <article className={css.card} key={item.packageName}
            data-testid={`mio-plugin-${item.packageName}`}>
            <header className={css.cardHead}>
              <span className={css.artwork} aria-hidden="true">
                <PluginArtworkDefault size={32} />
              </span>
              <div className={css.identity}>
                <h3 className={css.name}>{item.pluginName}</h3>
                <code className={css.packageName}>{item.packageName}</code>
              </div>
              <Tooltip label={t(isPinned ? 'unpin' : 'pin')} side="bottom" delayMs={300} portal>
                <button
                  type="button"
                  className={css.pinButton}
                  data-pinned={isPinned ? '' : undefined}
                  aria-label={t(isPinned ? 'unpin' : 'pin')}
                  aria-pressed={isPinned}
                  onClick={() => { togglePin(item.packageName) }}
                >
                  {isPinned
                    ? <IconPinFillRegular size={14} aria-hidden="true" />
                    : <IconPinOutlineRegular size={14} aria-hidden="true" />}
                </button>
              </Tooltip>
            </header>
            {item.description !== '' ? <p className={css.cardDescription}>{item.description}</p> : null}
            <div className={css.tags}>
              {item.category !== '' ? <Tag tone="neutral">{item.category}</Tag> : null}
              {item.hasPreset ? <Tag tone="info">{t('autoConfigured')}</Tag> : null}
            </div>
            <div className={css.actions}>
              {installed
                ? <Button variant="outline" size="sm" onClick={() => { openPackage(item.packageName) }}>
                  {installedVersion === undefined ? t('installed') : t('installedVersion', { version: installedVersion })}
                </Button>
                : <Button variant="primary" size="sm" onClick={() => {
                  install({ spec: item.packageName, title: item.pluginName, version: 'latest' })
                }}>
                  {t('install')}
                </Button>}
              {canUpdate
                ? <Button variant="primary" size="sm" disabled={state.updating !== null}
                  onClick={() => { setPendingUpdate(item) }}>
                  {state.updating === item.packageName ? t('updating') : t('update')}
                </Button>
                : null}
            </div>
          </article>
        })}
      </div>
      : null}

    <Modal open={pendingUpdate !== null}
      title={t('updateTitle', { name: pendingUpdate?.pluginName ?? '' })}
      description={t('updateDescription', {
        installed: pendingUpdate === null ? '' : state.installedVersions[pendingUpdate.packageName] ?? '',
        latest: pendingUpdate === null ? '' : state.latestVersions[pendingUpdate.packageName] ?? '',
      })} closeLabel={t('cancel')}
      onClose={() => { setPendingUpdate(null) }}>
      <div className={css.updateActions}>
        <Button variant="outline" onClick={() => { setPendingUpdate(null) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={state.updating !== null} onClick={() => {
          const item = pendingUpdate
          if (item === null) return
          setPendingUpdate(null)
          update(item, install)
        }}>{t('update')}</Button>
      </div>
    </Modal>
  </section>
}
