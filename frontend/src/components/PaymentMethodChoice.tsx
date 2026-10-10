import { Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'

import type { PaymentCreate } from '../pages/payments/api'
import { TwoChoice } from './TwoChoice'

export type PaymentMethod = PaymentCreate['payment_method']

export function PaymentMethodChoice({
  value,
  onChange,
  label,
}: {
  value: PaymentMethod
  onChange: (value: PaymentMethod) => void
  label?: string
}) {
  const { t } = useTranslation()
  return (
    <TwoChoice
      label={label ?? t('paymentMethod.question')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'cash', label: t('paymentMethod.cash') },
        { value: 'card', label: t('paymentMethod.card') },
      ]}
    />
  )
}

export function PaymentMethodText({ method }: { method: PaymentMethod | null }) {
  const { t } = useTranslation()
  if (method === null) return null
  return (
    <Text span size="sm" c="dimmed">
      {method === 'card' ? t('paymentMethod.card') : t('paymentMethod.cash')}
    </Text>
  )
}
