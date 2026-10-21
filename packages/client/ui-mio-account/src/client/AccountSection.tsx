/** Account & balance settings section backed by the mioagent account service. */
import { useCallback, useEffect, useState } from 'react'
import { Button, IconUserOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MioQuotaView, MioSubscriptionsView } from '@deepseek-ai/dsh-mio-account/types'
import type { MioAccountInjected } from './operations.ts'
import { accountMessage } from './operations.ts'
import { ResetPasswordDialog } from './ResetPasswordDialog.tsx'
import { PlansDialog } from './PlansDialog.tsx'
import { formatQuota } from './quota-format.ts'
import type { MioAccountKey } from './locales.ts'
import css from './AccountSection.module.css'

/** Props assembled by the settings renderer. */
export type AccountSectionProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<'mioAccount'>
  & InjectFace<MioAccountInjected>

function shortDate(value: string): string {
  return value.slice(0, 10)
}

function subscriptionStatus(status: string, t: (key: MioAccountKey) => string): string {
  const normalized = status.toLowerCase()
  if (normalized === 'active' || normalized === 'ready') return t('subscriptionActive')
  if (normalized === 'expired' || normalized === 'cancelled') return t('subscriptionExpired')
  return status
}

/**
 * Render account details, quota, change password, and purchased subscriptions.
 * @param props - account hooks, operations, and localized copy.
 * @returns the account settings section.
 */
export function AccountSection({
  useAccount, getQuota, getSubscriptions, getPlans, purchasePlan, getOrder, getAgreements,
  sendSmsCode, resetPassword, t,
}: AccountSectionProps) {
  const state = useAccount(value => value)
  const user = state.view?.status === 'signed-in' ? state.view.user : null
  const [quota, setQuota] = useState<MioQuotaView | undefined>(undefined)
  const [subscriptions, setSubscriptions] = useState<MioSubscriptionsView | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const [quotaResult, subscriptionResult] = await Promise.allSettled([getQuota(), getSubscriptions()])
    if (quotaResult.status === 'fulfilled') setQuota(quotaResult.value)
    if (subscriptionResult.status === 'fulfilled') setSubscriptions(subscriptionResult.value)
    if (quotaResult.status === 'rejected') setError(accountMessage(quotaResult.reason, t('accountLoadFailed')))
    else if (subscriptionResult.status === 'rejected') setError(accountMessage(subscriptionResult.reason, t('accountLoadFailed')))
    else setError('')
  }, [getQuota, getSubscriptions, t])

  useEffect(() => {
    void load().finally(() => { setLoading(false) })
  }, [load])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  if (user === null) return null

  const label = user.nickname === '' ? user.maskedPhone : user.nickname
  const items = [...(subscriptions?.items ?? [])].sort((left, right) =>
    (left.status === 'active' ? 0 : 1) - (right.status === 'active' ? 0 : 1))
  const freeQuota = quota === undefined ? '—' : formatQuota(quota.remainingQuota)
  const totalUsage = quota === undefined ? '—' : formatQuota(quota.usedQuota)

  return <div className={css.root} data-testid="mio-account-section">
    {loading
      ? <div className={css.loading} role="status">{t('loading')}</div>
      : <>
        <section className={css.card} data-testid="mio-account-card">
          <header className={css.cardHeader}>
            <div className={css.identity}>
              <span className={css.avatar} aria-hidden="true">
                {user.nickname === '' ? <IconUserOutlineMedium size={20} /> : label.slice(0, 1)}
              </span>
              <div>
                <div className={css.name}>{label}</div>
                <div className={css.meta}>{user.maskedPhone}</div>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={refreshing} onClick={() => { void refresh() }}>
              {t('refresh')}
            </Button>
          </header>
          <dl className={css.grid}>
            <dt>{t('nickname')}</dt>
            <dd>{user.nickname === '' ? t('notSet') : user.nickname}</dd>
            <dt>{t('phone')}</dt>
            <dd>{user.maskedPhone === '' ? t('notSet') : user.maskedPhone}</dd>
            <dt>{t('freeQuota')}</dt>
            <dd>{freeQuota}</dd>
            <dt>{t('totalUsage')}</dt>
            <dd>{totalUsage}</dd>
          </dl>
          {error !== '' && <p className={css.error} role="alert">{error}</p>}
          <div className={css.actions}>
            <Button variant="outline" size="sm" onClick={() => { setPasswordOpen(true) }}>
              {t('changePassword')}
            </Button>
          </div>
        </section>

        <section className={css.card} data-testid="mio-account-plan">
          <header className={css.cardHeader}>
            <h2 className={css.title}>{t('planSection')}</h2>
            <Button variant="primary" size="sm" onClick={() => { setPlansOpen(true) }}>
              {t('upgradePlan')}
            </Button>
          </header>
          {items.length === 0
            ? <p className={css.empty}>{t('noSubscription')}</p>
            : <div className={css.subList}>
              {items.map(item => <article key={item.subscriptionId} className={css.subCard}
                data-active={item.status === 'active'}>
                <header className={css.subHeader}>
                  <span className={css.subName}>{item.planName}</span>
                  <span className={css.badge}>{subscriptionStatus(item.status, t)}</span>
                </header>
                <div className={css.subQuota}>
                  <span>{t('subRemaining')}</span>
                  <span className={css.subRemaining}>
                    {item.amountTotal === 0 ? t('unlimited') : formatQuota(Math.max(0, item.amountTotal - item.amountUsed))}
                  </span>
                  <span className={css.hint}>/ {item.amountTotal === 0 ? t('unlimited') : formatQuota(item.amountTotal)}</span>
                </div>
                <div className={css.subRows}>
                  <span>{t('subQuotaUsed')} {formatQuota(item.amountUsed)}</span>
                  <span>{shortDate(item.startTime)} ~ {shortDate(item.endTime)}</span>
                </div>
              </article>)}
            </div>}
          {subscriptions !== undefined && !subscriptions.realtime && <p className={css.hint}>{t('dataDelayed')}</p>}
        </section>
      </>}

    <ResetPasswordDialog open={passwordOpen} onClose={() => { setPasswordOpen(false) }} mode="change"
      sendSmsCode={sendSmsCode} resetPassword={resetPassword} t={t} />
    <PlansDialog open={plansOpen} onClose={() => { setPlansOpen(false) }} onPurchased={async () => { await load() }}
      getPlans={getPlans} getAgreements={getAgreements} purchasePlan={purchasePlan} getOrder={getOrder} t={t} />
  </div>
}
