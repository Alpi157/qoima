import { Anchor, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ArrowLeftIcon, CheckIcon } from '../../components/icons'
import { StickyActions } from '../../components/flow/StickyActions'
import { MoneyInput } from '../../components/MoneyInput'
import { PaymentMethodChoice } from '../../components/PaymentMethodChoice'
import { TwoChoice } from '../../components/TwoChoice'
import { Card, DataTable, PageHeader, Stat } from '../../components/ui'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatInteger, formatMoney } from '../../lib/money'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import {
  linePrice,
  lineSum,
  salePaid,
  salePaymentError,
  type SalePayment,
  type SaleCustomerChoice,
  type SaleLineView,
  type SaleDraftLine,
} from './saleDraft'
import { qtyError } from '../../lib/validation'
import { saleTotals } from './saleTotals'
import { UnloadedLine } from '../../components/flow/LineLoadNotice'

export interface SellStepReviewProps {
  views: SaleLineView[]
  customer: SaleCustomerChoice
  payment: SalePayment
  onPaymentChange: (payment: SalePayment) => void
  onBack: () => void
  onSubmit: () => void
  saving: boolean
  /** A failed save: shown above the button. */
  error: ReactNode
  incomplete: boolean
  unknown: boolean
  unresolved: SaleDraftLine[]
}

function ProductCell({ article, name }: { article: string; name: string }) {
  return (
    <Stack gap={0}>
      <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
        {article}
      </Text>
      <Text c="dimmed">{name}</Text>
    </Stack>
  )
}

/** Step 3 «Тексеріңіз»: the whole sale once more and one button to save it. */
export function SellStepReview({
  views,
  customer,
  payment,
  onPaymentChange,
  onBack,
  onSubmit,
  saving,
  error,
  incomplete,
  unknown,
  unresolved,
}: SellStepReviewProps) {
  const { t } = useTranslation()
  const paymentFields = useRef<HTMLDivElement>(null)
  const focusPayment = useCallback(() => {
    paymentFields.current?.querySelector('input')?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (payment.mode === 'debt') focusPayment()
  }, [payment.mode, focusPayment])

  const totals = saleTotals(views)
  totals.kinds += unresolved.length
  totals.qty += unresolved.reduce(
    (sum, line) => sum + (qtyError(line.qty) === null ? (line.qty as number) : 0),
    0,
  )
  const paymentError = salePaymentError(payment, totals.sum)
  const hasCustomer = customer !== null && customer !== 'none'
  const customerName =
    customer !== null && customer !== 'none' ? customer.name : t('sell.review.retail')

  const qty = ({ line, product }: SaleLineView) =>
    `${formatInteger(line.qty as number)} ${unitLabel(product.unit)}`
  const price = ({ line, product }: SaleLineView) => formatMoney(linePrice(line, product) ?? 0)
  const sum = ({ line, product }: SaleLineView) => formatMoney(lineSum(line, product) ?? 0)

  return (
    <>
      <PageHeader title={t('sell.review.title')} />
      <Stack gap="lg" maw={1000}>
        <Card>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <Stat label={t('sell.review.customer')} value={customerName} />
            <Stat
              size="display"
              label={t('sell.total')}
              value={incomplete ? '—' : formatAmount(totals.sum)}
              unit={incomplete ? undefined : '₸'}
              testId="review-total"
            />
            <Stat label={t('sell.review.kinds')} value={totals.kinds} />
            <Stat
              label={t('sell.review.pieces')}
              value={formatInteger(totals.qty)}
              unit={t('flow.pcs')}
            />
          </SimpleGrid>
        </Card>

        <Card>
          <Stack gap="md">
            <TwoChoice
              heading
              label={t('sell.payment.title')}
              value={payment.mode}
              options={[
                { value: 'full', label: t('sell.payment.full') },
                { value: 'debt', label: t('sell.payment.debt'), disabled: !hasCustomer },
              ]}
              onChange={(mode) => {
                if (mode === 'debt' && payment.mode === 'debt') focusPayment()
                else onPaymentChange({ ...payment, mode })
              }}
            />
            {!hasCustomer && (
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  {t('sell.payment.requiresCustomer')}
                </Text>
                <Anchor component="button" type="button" onClick={onBack}>
                  {t('sell.payment.chooseCustomer')}
                </Anchor>
              </Stack>
            )}
            {payment.mode === 'debt' && (
              <Stack ref={paymentFields} gap="md">
                <MoneyInput
                  label={t('sell.payment.paidNow')}
                  value={payment.paid}
                  onChange={(paid) => onPaymentChange({ ...payment, paid })}
                  onFocus={() => paymentFields.current?.scrollIntoView({ block: 'center' })}
                  error={paymentError}
                  styles={{ wrapper: { maxWidth: FIELD_WIDTH.price } }}
                />
                <Text fz="var(--q-fz-h2)" lh="var(--q-lh-h2)" fw={700}>
                  {t('sell.payment.remaining', {
                    amount: formatMoney(
                      Math.max(0, totals.sum - (salePaid(payment, totals.sum) ?? 0)),
                    ),
                  })}
                </Text>
              </Stack>
            )}
            {(salePaid(payment, totals.sum) ?? 0) > 0 && (
              <PaymentMethodChoice
                value={payment.method}
                onChange={(method) => onPaymentChange({ ...payment, method })}
              />
            )}
          </Stack>
        </Card>

        <DataTable
          rows={views}
          rowKey={({ product }) => product.id}
          columns={[
            {
              key: 'product',
              header: t('sell.review.product'),
              cell: ({ product }) => <ProductCell article={product.article} name={product.name} />,
            },
            { key: 'qty', header: t('flow.qty'), cell: qty, numeric: true },
            { key: 'price', header: t('sell.review.price'), cell: price, numeric: true },
            {
              key: 'sum',
              header: t('sell.sum'),
              cell: (view) => <Text fw={600}>{sum(view)}</Text>,
              numeric: true,
            },
          ]}
          mobileCard={(view) => (
            <Stack gap="xs">
              <ProductCell article={view.product.article} name={view.product.name} />
              <Group justify="space-between" gap="md">
                <Text>
                  {qty(view)} × {price(view)}
                </Text>
                <Text fw={600}>{sum(view)}</Text>
              </Group>
            </Stack>
          )}
        />

        {unresolved.map((line) => (
          <UnloadedLine key={line.productId} article={line.article} name={line.name}>
            <Text>
              {t('flow.qty')}: {line.qty}
            </Text>
          </UnloadedLine>
        ))}
        {incomplete && <Text fw={600}>{t('flow.blocked.loading')}</Text>}
        {error}

        <StickyActions>
          <Button variant="default" leftSection={<ArrowLeftIcon size={20} />} onClick={onBack}>
            {t('sell.review.back')}
          </Button>
          {!unknown && (
            <Button
              size="lg"
              color="green"
              leftSection={<CheckIcon />}
              onClick={onSubmit}
              loading={saving}
              disabled={incomplete || views.length === 0 || Boolean(paymentError)}
            >
              {t('sell.review.submit')}
            </Button>
          )}
        </StickyActions>
      </Stack>
    </>
  )
}
