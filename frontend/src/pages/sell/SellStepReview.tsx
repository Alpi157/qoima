import { Alert, Anchor, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { ArrowLeftIcon, CheckIcon } from '../../components/icons'
import { Card, DataTable, PageHeader, Stat } from '../../components/ui'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatInteger, formatMoney } from '../../lib/money'
import { linePrice, lineSum, type SaleCustomerChoice, type SaleLineView } from './saleDraft'
import { saleTotals } from './saleTotals'

export interface SellStepReviewProps {
  views: SaleLineView[]
  customer: SaleCustomerChoice
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
  onBack,
  onSubmit,
  saving,
  error,
}: SellStepReviewProps) {
  const { t } = useTranslation()
  const totals = saleTotals(views)
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

        <Group justify="space-between" gap="md" className="flow-review-actions">
          <Button variant="default" leftSection={<ArrowLeftIcon size={20} />} onClick={onBack}>
            {t('sell.review.back')}
          </Button>
          <Button
            size="lg"
            color="green"
            leftSection={<CheckIcon />}
            onClick={onSubmit}
            loading={saving}
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
