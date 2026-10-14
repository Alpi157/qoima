import { useDocumentResult } from '../../components/flow/documentResultState'
import { Alert, Button, Group, Stack, Text, Textarea } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { DocumentModal } from '../../components/flow/DocumentModal'
import { useDocumentModalStatus } from '../../components/flow/documentModalState'
import { RequestConflictAlert, UnknownResult } from '../../components/flow/DocumentResult'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { hasErrorCode, isApiError } from '../../api/errors'
import { ExtraSection } from '../../components/ExtraSection'
import { MoneyInput } from '../../components/MoneyInput'
import { TwoChoice } from '../../components/TwoChoice'
import { useInvalidateDebtAdjustments } from '../../api/invalidate'
import { apiErrorText } from '../../i18n/errorText'
import { localInputToIso, nowLocalInput } from '../../lib/dates'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { serverFormErrors } from '../../lib/formErrors'
import { formatMoney, parseMoney, validateMoneyText } from '../../lib/money'
import { reasonError } from '../../lib/validation'
import type { Customer } from '../customers/api'
import { usePostDebtAdjustment } from './api'

type Direction = 'increase' | 'decrease'
const QUICK_REASONS = [
  'debtAdjustments.reasons.opening',
  'debtAdjustments.reasons.forgiven',
  'debtAdjustments.reasons.mistake',
] as const
type QuickReason = (typeof QUICK_REASONS)[number]

function quickReasons(direction: Direction | null): QuickReason[] {
  return QUICK_REASONS.filter(
    (key) =>
      key === 'debtAdjustments.reasons.mistake' ||
      (direction === 'increase' && key === 'debtAdjustments.reasons.opening') ||
      (direction === 'decrease' && key === 'debtAdjustments.reasons.forgiven'),
  )
}

function AdjustmentForm({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const post = usePostDebtAdjustment()
  const [requestId] = useState(() => crypto.randomUUID())
  const result = useDocumentResult()
  const modal = useDocumentModalStatus(result.unknown, post.isPending)
  const [openedAt] = useState(() => new Date())
  const [dateNow, setDateNow] = useState(openedAt)
  const [direction, setDirection] = useState<Direction | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [quickReason, setQuickReason] = useState<QuickReason | null>(null)
  const [reasonTouched, setReasonTouched] = useState(false)
  const [adjustedAt, setAdjustedAt] = useState<string | null>(() => nowLocalInput(openedAt))
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [currentDebt, setCurrentDebt] = useState<number | null>(null)
  const debt = currentDebt ?? customer.debt
  const tiyn = parseMoney(amount)
  const after = debt + (direction === 'decrease' ? -1 : 1) * (tiyn ?? 0)
  const warning = direction === 'increase' && debt > 0 && after >= 2 * debt
  const exceeds = direction === 'decrease' && tiyn !== null && tiyn > debt
  // Preserve the opening second, as in PaymentModal, for stable ordering and retries.
  const iso =
    adjustedAt === nowLocalInput(openedAt)
      ? openedAt.toISOString()
      : adjustedAt
        ? localInputToIso(adjustedAt)
        : null
  const dateError =
    adjustedAt && (!iso || new Date(iso).getTime() > dateNow.getTime())
      ? t('validation.date_in_future')
      : null
  const canSave =
    direction !== null &&
    tiyn !== null &&
    tiyn > 0 &&
    !exceeds &&
    !reasonError(reason) &&
    reason.trim().length <= 500 &&
    !dateError

  const submit = () => {
    if (post.isPending || !canSave || tiyn === null) return
    setMessage(null)
    setErrors({})
    post.mutate(
      {
        request_id: requestId,
        customer_id: customer.id,
        amount: direction === 'decrease' ? -tiyn : tiyn,
        reason: reason.trim(),
        adjusted_at: iso,
      },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('debtAdjustments.saved') })
          onClose()
        },
        onError: (error) => {
          if (result.acceptError(error)) return
          if (hasErrorCode(error, 'debt_adjustment_exceeds_debt')) {
            setErrors({ amount: apiErrorText(error, t) })
            if (isApiError(error) && typeof error.params.debt === 'number')
              setCurrentDebt(error.params.debt)
            return
          }
          const mapped = serverFormErrors(error, {
            fieldMap: { amount: 'amount', adjusted_at: 'adjustedAt', reason: 'reason' },
          })
          setErrors(mapped.fields)
          setMessage(mapped.message)
          if (mapped.fields.adjustedAt) setExtrasOpen(true)
        },
      },
    )
  }

  return (
    <form
      className="q-debt-adjustment-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Stack gap="xs">
        <Text fw={600}>{customer.name}</Text>
        <Text>{t('payments.currentDebt', { amount: formatMoney(debt) })}</Text>
      </Stack>
      <Stack gap="lg" className="q-debt-adjustment-fields">
        <TwoChoice<Direction>
          label={t('debtAdjustments.direction')}
          value={direction}
          options={[
            { value: 'increase', label: t('debtAdjustments.increase') },
            { value: 'decrease', label: t('debtAdjustments.decrease') },
          ]}
          onChange={(value) => {
            setDirection(value)
            if (quickReason && !quickReasons(value).includes(quickReason)) {
              setReason('')
              setQuickReason(null)
              setReasonTouched(false)
            }
            setErrors((previous) => ({ ...previous, amount: '' }))
          }}
        />
        <MoneyInput
          label={t('payments.amount')}
          required
          data-autofocus
          autoFocus
          value={amount}
          onChange={(value) => {
            setAmount(value)
            setErrors((previous) => ({ ...previous, amount: '' }))
          }}
          error={
            errors.amount ||
            (exceeds
              ? t('errors.debt_adjustment_exceeds_debt', { debt: formatMoney(debt) })
              : validateMoneyText(amount) || (tiyn === 0 ? t('payments.positiveAmount') : null))
          }
          styles={{ wrapper: { maxWidth: FIELD_WIDTH.price } }}
        />
        <Stack gap="xs">
          <Group gap="xs" role="group" aria-label={t('common.cancelDocument.quickLabel')}>
            {quickReasons(direction).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={quickReason === key ? 'light' : 'default'}
                aria-pressed={quickReason === key}
                onClick={() => {
                  setReason(t(key))
                  setQuickReason(key)
                  setErrors((previous) => ({ ...previous, reason: '' }))
                }}
              >
                {t(key)}
              </Button>
            ))}
          </Group>
          <Textarea
            label={t('common.cancelDocument.reason')}
            required
            autosize
            minRows={2}
            maxLength={500}
            value={reason}
            onBlur={() => setReasonTouched(true)}
            onChange={(event) => {
              setReason(event.currentTarget.value)
              setQuickReason(null)
              setErrors((previous) => ({ ...previous, reason: '' }))
            }}
            error={errors.reason || (reasonTouched ? reasonError(reason) : null)}
          />
        </Stack>
        <ExtraSection
          id="debt-adjustment-extras"
          opened={extrasOpen}
          onToggle={() => setExtrasOpen(!extrasOpen)}
        >
          <DateTimePicker
            label={t('receive.extras.date')}
            valueFormat={i18n.language === 'zh' ? 'YYYY/MM/DD HH:mm' : 'DD.MM.YYYY HH:mm'}
            value={adjustedAt}
            maxDate={nowLocalInput(dateNow)}
            onChange={(value) => {
              setAdjustedAt(value)
              setDateNow(new Date())
              setErrors((previous) => ({ ...previous, adjustedAt: '' }))
            }}
            error={errors.adjustedAt || dateError}
            clearable
            styles={{ wrapper: { maxWidth: FIELD_WIDTH.date } }}
          />
        </ExtraSection>
        {result.conflict && (
          <RequestConflictAlert
            error={result.conflict}
            onClear={() => modal?.clear()}
            onOpen={() => modal?.openSaved()}
            customerId={customer.id}
          />
        )}
        {result.unknown && (
          <UnknownResult onRetry={submit} busy={post.isPending} disabled={!canSave} />
        )}
        {message && (
          <Alert color="red" role="alert">
            {message}
          </Alert>
        )}
      </Stack>
      {direction && (
        <Stack gap="xs">
          <Text fw={600} c={warning ? 'var(--q-color-warning-text)' : undefined}>
            {t('debtAdjustments.after', { amount: formatMoney(after) })}
          </Text>
          {warning && (
            <Text size="sm" c="var(--q-color-warning-text)">
              {t('debtAdjustments.checkAmount')}
            </Text>
          )}
        </Stack>
      )}
      <Group justify="flex-end" gap="sm" className="q-modal-actions">
        <Button variant="default" onClick={() => modal?.close()} disabled={post.isPending}>
          {t('common.cancel')}
        </Button>
        {!result.unknown && (
          <Button type="submit" loading={post.isPending} disabled={!canSave}>
            {t('common.save')}
          </Button>
        )}
      </Group>
    </form>
  )
}

export function DebtAdjustmentModal({
  customer,
  opened,
  onClose,
}: {
  customer: Customer
  opened: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const invalidate = useInvalidateDebtAdjustments()
  return (
    <DocumentModal
      invalidate={invalidate}
      opened={opened}
      onClose={onClose}
      title={t('debtAdjustments.title')}
      classNames={{ content: 'q-debt-adjustment-modal', body: 'q-debt-adjustment-body' }}
    >
      {opened && <AdjustmentForm customer={customer} onClose={onClose} />}
    </DocumentModal>
  )
}
