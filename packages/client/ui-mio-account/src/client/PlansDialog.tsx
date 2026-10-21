/** Plan picker, WeChat Native QR payment, and order polling. */
import { useEffect, useRef, useState } from 'react'
import { toDataURL } from 'qrcode/lib/browser.js'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  MioAgreement, MioOrderStatus, MioPlan, MioPurchaseRequest, MioPurchaseResult,
} from '@deepseek-ai/dsh-mio-account/types'
import { accountMessage } from './operations.ts'
import { formatQuota } from './quota-format.ts'
import { clearPurchaseIntent, purchaseRequestId } from './purchase-intent.ts'
import type { MioAccountKey } from './locales.ts'
import css from './AccountSection.module.css'

/** Order polling interval while a QR code is on screen. */
const POLL_INTERVAL_MS = 3_000

/** One purchase-flow phase; only the browse phases show the plan list. */
type Phase = 'browse' | 'creating' | 'paying' | 'paid' | 'expired' | 'failed'

/** Plan purchase copy and operations. */
export interface PlansDialogProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Close the dialog. */
  onClose: () => void
  /** Re-read account, quota, and subscriptions after a paid order. */
  onPurchased: () => Promise<void>
  readonly getPlans: () => Promise<readonly MioPlan[]>
  readonly getAgreements: () => Promise<readonly MioAgreement[]>
  readonly purchasePlan: (request: MioPurchaseRequest) => Promise<MioPurchaseResult>
  readonly getOrder: (orderNo: string) => Promise<MioOrderStatus>
  /** Localized copy. */
  t: (key: MioAccountKey) => string
}

/** Whether a backend timestamp (local `YYYY-MM-DD HH:mm:ss`) has passed. */
function expiredAt(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false
  const parsed = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(parsed) && parsed <= Date.now()
}

/** Whether an order status means payment can no longer complete. */
function closedPayment(status: string): boolean {
  return ['EXPIRED', 'CLOSED', 'CANCELLED'].includes(status.toUpperCase())
}

/**
 * Render the plan list and the scan-to-pay step.
 * @param props - visibility, purchase operations, and localized copy.
 * @returns the purchase dialog.
 */
export function PlansDialog({
  open, onClose, onPurchased, getPlans, getAgreements, purchasePlan, getOrder, t,
}: PlansDialogProps) {
  const [plans, setPlans] = useState<readonly MioPlan[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [agreement, setAgreement] = useState<MioAgreement | undefined>(undefined)
  const [agreed, setAgreed] = useState(false)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('browse')
  const [message, setMessage] = useState('')
  const [orderNo, setOrderNo] = useState('')
  const [qr, setQr] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  function stopPolling(): void {
    if (timer.current === undefined) return
    clearInterval(timer.current)
    timer.current = undefined
  }

  useEffect(() => {
    if (!open) {
      stopPolling()
      return
    }
    setPhase('browse')
    setMessage('')
    setOrderNo('')
    setQr('')
    setAgreed(false)
    setLoading(true)
    void Promise.allSettled([getPlans(), getAgreements()]).then(([plansResult, agreementsResult]) => {
      if (plansResult.status === 'fulfilled') {
        setPlans(plansResult.value)
        setSelected(plansResult.value[0]?.planId ?? null)
      } else {
        setPlans([])
        setMessage(accountMessage(plansResult.reason, t('plansLoadFailed')))
      }
      if (agreementsResult.status === 'fulfilled') {
        setAgreement(agreementsResult.value.find(item => item.agreementType === 'SUBSCRIPTION'))
      }
      setLoading(false)
    })
    return () => { stopPolling() }
  }, [open, getPlans, getAgreements, t])

  const finish = async (): Promise<void> => {
    stopPolling()
    clearPurchaseIntent()
    setPhase('paid')
    setMessage(t('paySuccess'))
    await onPurchased()
  }

  const poll = async (currentOrderNo: string): Promise<void> => {
    const order = await getOrder(currentOrderNo).catch((_failure: unknown) => undefined)
    if (order === undefined) return
    if (order.paymentStatus.toUpperCase() === 'PAID') {
      await finish()
      return
    }
    if (closedPayment(order.paymentStatus) || expiredAt(order.expireTime)) {
      stopPolling()
      clearPurchaseIntent()
      setPhase('expired')
      setMessage(t('payExpired'))
    }
  }

  const startPolling = (currentOrderNo: string): void => {
    stopPolling()
    void poll(currentOrderNo)
    timer.current = setInterval(() => { void poll(currentOrderNo) }, POLL_INTERVAL_MS)
  }

  const buy = async (): Promise<void> => {
    if (selected === null || phase === 'creating' || phase === 'paying') return
    if (agreement !== undefined && !agreed) {
      setMessage(t('agreementRequired'))
      return
    }
    setPhase('creating')
    setMessage('')
    try {
      const result = await purchasePlan({ planId: selected, requestId: purchaseRequestId(selected) })
      setOrderNo(result.orderNo)
      if (result.paymentStatus.toUpperCase() === 'PAID') {
        await finish()
        return
      }
      if (result.codeUrl === null || result.codeUrl === undefined || result.codeUrl === '') {
        setPhase('failed')
        setMessage(t('payFailed'))
        return
      }
      let dataUrl = ''
      try {
        dataUrl = await toDataURL(result.codeUrl, { margin: 1, width: 192 })
      } catch (_failure) {
        // A renderer without canvas support falls back to the failure copy.
      }
      if (dataUrl === '') {
        setPhase('failed')
        setMessage(t('payFailed'))
        return
      }
      setQr(dataUrl)
      setPhase('paying')
      startPolling(result.orderNo)
    } catch (failure) {
      setPhase('failed')
      setMessage(accountMessage(failure, t('payFailed')))
    }
  }

  const close = (): void => {
    stopPolling()
    onClose()
  }
  const cancel = (): void => {
    clearPurchaseIntent()
    close()
  }

  const browse = phase === 'browse' || phase === 'creating' || phase === 'failed' || phase === 'expired'
  return <>
    <Modal open={open} title={t('plansTitle')} description={t('plansDescription')}
      className={css.wideDialog ?? ''} closeLabel={t('close')} onClose={close}>
      <div className={css.dialog}>
        {browse && <>
          {loading
            ? <div className={css.loading} role="status">{t('plansLoading')}</div>
            : plans.length === 0
              ? <p className={css.empty}>{t('plansEmpty')}</p>
              : <div className={css.plans} role="listbox" aria-label={t('plansTitle')}>
                {plans.map(plan => <button key={plan.planId} type="button" role="option"
                  aria-selected={plan.planId === selected} className={css.plan}
                  data-selected={plan.planId === selected}
                  onClick={() => { setSelected(plan.planId); setMessage('') }}>
                  <span className={css.planName}>{plan.planName}</span>
                  <span className={css.planPrice}>¥{plan.price}<small> {plan.currency}</small></span>
                  {plan.planContent !== ''
                    && <div className={css.planContent} dangerouslySetInnerHTML={{ __html: plan.planContent }} />}
                  <span className={css.planMeta}>
                    <span>{t('planQuota')}: {plan.quota === 0 ? t('unlimited') : formatQuota(plan.quota)}</span>
                    <span>{t('planPurchaseLimit')}: {plan.maxPurchasePerUser === 0 ? t('unlimited') : String(plan.maxPurchasePerUser)}</span>
                  </span>
                </button>)}
              </div>}
          {agreement !== undefined && <label className={css.agreement}>
            <input type="checkbox" checked={agreed}
              onChange={(event) => { setAgreed(event.target.checked); setMessage('') }} />
            <span>
              {t('agreementPrefix')}{' '}
              <button type="button" className={css.link}
                onClick={() => { setAgreementOpen(true) }}>{t('subscriptionAgreement')}</button>
            </span>
          </label>}
          {message !== '' && <p className={css.error} role="alert">{message}</p>}
          <div className={css.footer}>
            <Button variant="outline" onClick={cancel}>{t('cancel')}</Button>
            <Button variant="primary"
              disabled={selected === null || loading || phase === 'creating' || (agreement !== undefined && !agreed)}
              onClick={() => { void buy() }}>
              {phase === 'creating' ? t('purchasing') : t('purchase')}
            </Button>
          </div>
        </>}
        {phase === 'paying' && <div className={css.qrArea}>
          <p className={css.title}>{t('payQrTitle')}</p>
          <img className={css.qrImage} src={qr} alt={t('payQrTitle')} />
          <p className={css.hint}>{t('payQrDescription')}</p>
          {orderNo !== '' && <p className={css.orderNo}>{t('orderNo')}: {orderNo}</p>}
          <div className={css.footer}>
            <Button variant="outline" onClick={close}>{t('close')}</Button>
          </div>
        </div>}
        {phase === 'paid' && <div className={css.paid} role="status">
          <p>{message}</p>
          <Button variant="primary" onClick={close}>{t('done')}</Button>
        </div>}
      </div>
    </Modal>
    <Modal open={agreementOpen} title={t('subscriptionAgreement')} closeLabel={t('close')}
      onClose={() => { setAgreementOpen(false) }}>
      {agreement === undefined
        ? <p className={css.empty}>{t('agreementUnavailable')}</p>
        : <div className={css.agreementBody} dangerouslySetInnerHTML={{ __html: agreement.content }} />}
    </Modal>
  </>
}
