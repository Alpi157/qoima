import { Alert, Button, Group, Modal, Stack, Text, Textarea } from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { hasErrorCode, isApiError } from '../../api/errors'
import { ExtraSection } from '../../components/ExtraSection'
import { MoneyInput } from '../../components/MoneyInput'
import { PaymentMethodChoice, type PaymentMethod } from '../../components/PaymentMethodChoice'
import { apiErrorText } from '../../i18n/errorText'
import { localInputToIso, nowLocalInput } from '../../lib/dates'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { serverFormErrors } from '../../lib/formErrors'
import { formatMoney, parseMoney, tiynToInput, validateMoneyText } from '../../lib/money'
import type { Customer } from '../customers/api'
import { usePostPayment } from './api'

function PaymentForm({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const post = usePostPayment()
  const [requestId] = useState(() => crypto.randomUUID())
  const [openedAt] = useState(() => new Date())
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [paidAt, setPaidAt] = useState<string | null>(() => nowLocalInput(openedAt))
  const [note, setNote] = useState('')
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [currentDebt, setCurrentDebt] = useState<number | null>(null)
  const debt = currentDebt ?? customer.debt

  const submit = () => {
    if (post.isPending) return
    const tiyn = parseMoney(amount)
    const amountError =
      validateMoneyText(amount) ||
      (tiyn === null || tiyn <= 0 ? t('payments.positiveAmount') : null)
    // Keep the opening second: rounding to minutes could put payment before a just saved sale.
    const iso =
      paidAt === nowLocalInput(openedAt)
        ? openedAt.toISOString()
        : paidAt
          ? localInputToIso(paidAt)
          : null
    const dateError =
      paidAt && (!iso || new Date(iso).getTime() > Date.now())
        ? t('validation.date_in_future')
        : null
    setErrors({
      ...(amountError ? { amount: amountError } : {}),
      ...(dateError ? { paidAt: dateError } : {}),
    })
    if (amountError || dateError || tiyn === null) return
    setMessage(null)
    post.mutate(
      {
        request_id: requestId,
        customer_id: customer.id,
        amount: tiyn,
        payment_method: method,
        paid_at: iso,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          notifications.show({ color: 'green', message: t('payments.saved') })
          onClose()
        },
        onError: (error) => {
          if (hasErrorCode(error, 'payment_exceeds_debt')) {
            setErrors({ amount: apiErrorText(error, t) })
            if (isApiError(error) && typeof error.params.debt === 'number')
              setCurrentDebt(error.params.debt)
            return
          }
          const result = serverFormErrors(error, {
            fieldMap: { amount: 'amount', paid_at: 'paidAt', note: 'note' },
          })
          setErrors(result.fields)
          setMessage(result.message)
        },
      },
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Stack gap="lg">
        <Stack gap="xs">
          <Text fw={600}>{customer.name}</Text>
          <Text>{t('payments.currentDebt', { amount: formatMoney(debt) })}</Text>
        </Stack>
        <Stack gap="xs">
          <MoneyInput
            label={t('payments.amount')}
            required
            data-autofocus
            autoFocus
            value={amount}
            onChange={(value) => {
              setAmount(value)
              setErrors((prev) => ({ ...prev, amount: '' }))
            }}
            error={errors.amount}
            styles={{ wrapper: { maxWidth: FIELD_WIDTH.price } }}
          />
          <Group>
            <Button
              variant="default"
              onClick={() => {
                setAmount(tiynToInput(Math.max(0, debt)))
                setErrors((prev) => ({ ...prev, amount: '' }))
              }}
            >
              {t('payments.allDebt', { amount: formatMoney(debt) })}
            </Button>
          </Group>
        </Stack>
        <ExtraSection
          id="payment-extras"
          opened={extrasOpen}
          onToggle={() => setExtrasOpen(!extrasOpen)}
        >
          <DateTimePicker
            label={t('receive.extras.date')}
            valueFormat={i18n.language === 'zh' ? 'YYYY/MM/DD HH:mm' : 'DD.MM.YYYY HH:mm'}
            value={paidAt}
            maxDate={nowLocalInput()}
            onChange={setPaidAt}
            error={errors.paidAt}
            clearable
            styles={{ wrapper: { maxWidth: FIELD_WIDTH.date } }}
          />
          <Textarea
            label={t('receive.extras.note')}
            autosize
            minRows={2}
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            error={errors.note}
          />
        </ExtraSection>
        {message && (
          <Alert color="red" role="alert">
            {message}
          </Alert>
        )}
        <PaymentMethodChoice value={method} onChange={setMethod} />
        <Group justify="flex-end" gap="sm" className="q-modal-actions">
          <Button variant="default" onClick={onClose} disabled={post.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={post.isPending}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}

export function PaymentModal({
  customer,
  opened,
  onClose,
}: {
  customer: Customer
  opened: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal opened={opened} onClose={onClose} title={t('payments.title')}>
      {opened && <PaymentForm customer={customer} onClose={onClose} />}
    </Modal>
  )
}
