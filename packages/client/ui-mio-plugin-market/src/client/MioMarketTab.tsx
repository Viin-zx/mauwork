/** The Plugins page tab listing the mioagent plugin catalog. */
import { useEffect, useState } from 'react'
import {
  Button, IconPinFillRegular, IconPinOutlineRegular, Modal, PluginArtworkDefault, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MioPluginListing } from '@deepseek-ai/dsh-mio-account/types'
import { orderMarketItems, updatableItems, updateAvailable, type MioMarketFace, type MioUpdateAllError } from './market-store.ts'
import css from './MioMarketTab.module.css'

/** Props assembled by the Plugins page tab renderer. */
export type MioMarketTabProps =
  & PropsRuntime<'plugins.tab'>
  & PropsLocale<'mioPluginMarket'>
  & InjectFace<MioMarketFace>

/**
 * The alert text for a stopped update-all run.
 * @param error - the plugin that stopped it and why.
 * @param t - the tab's translate seat.
 * @returns the localized reason, with the Host's words appended for an unexplained failure.
 */
function updateAllErrorText(error: MioUpdateAllError, t: MioMarketTabProps['t']): string {
  if (error.kind === 'restart-required') return t('updateAllRestartRequired', { name: error.pluginName })
  if (error.kind === 'build-approval') return t('updateAllNeedsApproval', { name: error.pluginName })
  const failure = t('updateAllFailed', { name: error.pluginName })
  return error.reason === '' ? failure : `${failure} ${error.reason}`
}

/**
 * Render the account's plugin catalog and install entries through the page's
 * own install dialog. Pinned entries lead the grid in pin order.
 * @param props - tab actions, catalog and pin state, and localized copy.
 * @returns the market tab.
 */
export function MioMarketTab({
  install, openPackage, useMarket, usePinned, ensure, reload, update, updateAll, togglePin, t,
}: MioMarketTabProps) {
  const state = useMarket(value => value)
  const pinned = usePinned(value => value)
  const [pendingUpdate, setPendingUpdate] = useState<MioPluginListing | null>(null)
  const [confirmingAll, setConfirmingAll] = useState(false)
  useEffect(() => { ensure() }, [ensure])
  const busy = state.status === 'loading'
  const updating = state.updating !== null || state.updatingAll !== null
  const targets = updatableItems(state)
  const pinnedNames = new Set(pinned)
  const items = orderMarketItems(state.items, pinned)
  const updateError = state.updateError === 'restart-required'
    ? t('restartToUpdate')
    : state.updateError === 'update-failed' ? t('updateFailed') : state.updateError
  const updateAllError = state.updateAllError === null ? null : updateAllErrorText(state.updateAllError, t)

  return <section className={css.root} data-testid="mio-plugin-market">
    <header className={css.header}>
      <div className={css.heading}>
        <h2 className={css.title}>{t('title')}</h2>
        <p className={css.description}>{t('description')}</p>
      </div>
      <div className={css.headerActions}>
        {targets.length > 0
          ? <Button variant="primary" size="sm" disabled={busy || updating} onClick={() => { setConfirmingAll(true) }}>
            {t('updateAll', { count: targets.length })}
          </Button>
          : null}
        <Button variant="outline" size="sm" disabled={busy || updating} onClick={reload}>{t('refresh')}</Button>
      </div>
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
    {updateAllError !== null
      ? <div className={css.failure} role="alert"><span>{updateAllError}</span></div>
      : null}
    {state.updatingAll !== null
      ? <p className={css.notice} role="status">
        {t('updatingAll', {
          current: state.updatingAll.done + 1, total: state.updatingAll.total, name: state.updatingAll.pluginName,
        })}
      </p>
      : null}
    {state.updateAllRestart > 0
      ? <p className={css.notice} role="status">{t('updateAllRestartNotice', { count: state.updateAllRestart })}</p>
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
                ? <Button variant="primary" size="sm" disabled={updating}
                  onClick={() => { setPendingUpdate(item) }}>
                  {state.updating === item.packageName || state.updatingAll?.packageName === item.packageName
                    ? t('updating')
                    : t('update')}
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
        <Button variant="primary" disabled={updating} onClick={() => {
          const item = pendingUpdate
          if (item === null) return
          setPendingUpdate(null)
          update(item, install)
        }}>{t('update')}</Button>
      </div>
    </Modal>

    <Modal open={confirmingAll}
      title={t('updateAllTitle')}
      description={t('updateAllDescription')}
      closeLabel={t('cancel')}
      onClose={() => { setConfirmingAll(false) }}>
      <ul className={css.updateList}>
        {targets.map(({ item, installed, latest }) => (
          <li key={item.packageName} className={css.updateRow}>
            <span>{item.pluginName}</span>
            <span className={css.updateVersions}>{`${installed} → ${latest}`}</span>
          </li>
        ))}
      </ul>
      <div className={css.updateActions}>
        <Button variant="outline" onClick={() => { setConfirmingAll(false) }}>{t('cancel')}</Button>
        <Button variant="primary" onClick={() => {
          setConfirmingAll(false)
          updateAll()
        }}>{t('updateAllConfirm')}</Button>
      </div>
    </Modal>
  </section>
}
