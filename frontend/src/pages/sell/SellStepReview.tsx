import { Alert, Anchor, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ArrowLeftIcon, CheckIcon } from '../../components/icons'
import { MoneyInput } from '../../components/MoneyInput'
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
} from './saleDraft'
import { saleTotals } from './saleTotals'

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
}: SellStepReviewProps) {
  const { t } = useTranslation()
  const paymentFields = useRef<HTMLDivElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  const focusPayment = useCallback(() => {
    paymentFields.current?.querySelector('input')?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    const panel = actions.current
    if (!panel) return
    const root = document.documentElement
    const previousPadding = root.style.scrollPaddingBottom
    const reservePanelSpace = () => {
      root.style.scrollPaddingBottom = `${Math.ceil(panel.getBoundingClientRect().height)}px`
    }
    reservePanelSpace()
    const observer = new ResizeObserver(reservePanelSpace)
    observer.observe(panel)
    return () => {
      observer.disconnect()
      root.style.scrollPaddingBottom = previousPadding
    }
  }, [])

  useEffect(() => {
    if (payment.mode === 'debt') focusPayment()
  }, [payment.mode, focusPayment])

  const totals = saleTotals(views)
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
          <SimpleGrid cols={2} spacing="lg">
            <Stat label={t('sell.review.customer')} value={customerName} />
            <Stat
              size="display"
              label={t('sell.total')}
              value={formatAmount(totals.sum)}
              unit="₸"
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
            <Text fz="var(--q-fz-h3)" lh="var(--q-lh-h3)" fw={600}>
              {t('sell.payment.title')}
            </Text>
            <SimpleGrid
              cols={{ base: 1, sm: 2 }}
              spacing="md"
              role="group"
              aria-label={t('sell.payment.title')}
            >
              <Button
                variant={payment.mode === 'full' ? 'light' : 'default'}
                color="blue"
                aria-pressed={payment.mode === 'full'}
                onClick={() => onPaymentChange({ ...payment, mode: 'full' })}
              >
                {t('sell.payment.full')}
              </Button>
              <Button
                variant={payment.mode === 'debt' ? 'light' : 'default'}
                color="blue"
                aria-pressed={payment.mode === 'debt'}
                disabled={!hasCustomer}
                onClick={() => {
                  if (payment.mode === 'debt') focusPayment()
                  else onPaymentChange({ ...payment, mode: 'debt' })
                }}
              >
                {t('sell.payment.debt')}
              </Button>
            </SimpleGrid>
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

        {error}

        <Group ref={actions} justify="space-between" gap="md" className="flow-review-actions">
          <Button variant="default" leftSection={<ArrowLeftIcon size={20} />} onClick={onBack}>
            {t('sell.review.back')}
          </Button>
          <Button
            size="lg"
            color="green"
            leftSection={<CheckIcon />}
            onClick={onSubmit}
            loading={saving}
            disabled={Boolean(paymentError)}
          >
            {t('sell.review.submit')}
          </Button>
        </Group>
      </Stack>
    </>
  )
}

/** «Продажа могла уже пройти»: the request_id was used by a sale with other contents. */
export function RequestConflictAlert() {
  return (
    <Alert color="orange" role="alert">
      <Trans
        i18nKey="sell.review.conflict"
        components={{ history: <Anchor component={Link} to="/sales" inherit /> }}
      />
    </Alert>
  )
}
