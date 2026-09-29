import { Button, Group, Loader, Stack, Text, Title } from '@mantine/core'
import { Trans, useTranslation } from 'react-i18next'

import { LineCard, ProductSearch, QtyStepper, TotalsPanel } from '../../components/flow'
import { PlusIcon } from '../../components/icons'
import { MoneyInput } from '../../components/MoneyInput'
import { PageHeader, Stat } from '../../components/ui'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatMoney } from '../../lib/money'
import { type Product, useFrequentProducts } from '../products/api'
import {
  lineSum,
  linePriceText,
  type SaleDraft,
  type SaleDraftLine,
  type SaleLineView,
  saleLineWarning,
} from './saleDraft'
import { saleTotals } from './saleTotals'

interface FrequentProps {
  onAdd: (product: Product) => void
}

/** «Жиі сатылатындар»: one press adds the product. */
function FrequentProducts({ onAdd }: FrequentProps) {
  const { t } = useTranslation()
  const frequent = useFrequentProducts()
  if (!frequent.data || frequent.data.length === 0) return null
  return (
    <Stack gap="xs">
      <Text c="dimmed">{t('sell.products.frequent')}</Text>
      <Group gap="sm">
        {frequent.data.map((product) => (
          <Button
            key={product.id}
            size="sm"
            variant="light"
            color="green"
            leftSection={<PlusIcon size={20} />}
            onClick={() => onAdd(product)}
            aria-label={t('flow.addOf', { article: product.article })}
          >
            {product.article}
          </Button>
        ))}
      </Group>
    </Stack>
  )
}

function StockText({ product }: { product: Product }) {
  const { t } = useTranslation()
  return product.stock > 0 ? (
    <Text>
      {t('sell.products.inStock', { stock: product.stock, unit: unitLabel(product.unit) })}
    </Text>
  ) : (
    <Text c="red" fw={600}>
      {t('sell.products.outOfStock')}
    </Text>
  )
}

export interface SellStepProductsProps {
  draft: SaleDraft
  views: SaleLineView[]
  /** Products of a restored draft are still loading. */
  loadingLines: boolean
  query: string
  onQueryChange: (query: string) => void
  onAdd: (product: Product) => void
  onChangeLines: (change: (lines: SaleDraftLine[]) => SaleDraftLine[]) => void
  onNext: () => void
  onCancel: () => void
}

/** Step 1 «Не сатамыз?»: search, the lines with quantity and price, the totals. */
export function SellStepProducts({
  draft,
  views,
  loadingLines,
  query,
  onQueryChange,
  onAdd,
  onChangeLines,
  onNext,
  onCancel,
}: SellStepProductsProps) {
  const { t } = useTranslation()
  const totals = saleTotals(views)
  const changeLine = (productId: number, change: Partial<SaleDraftLine>) =>
    onChangeLines((lines) =>
      lines.map((line) => (line.productId === productId ? { ...line, ...change } : line)),
    )

  const warnings = views.map(({ line, product }) => saleLineWarning(line, product))
  const blockedReason =
    draft.lines.length === 0 || loadingLines
      ? t('flow.blocked.empty')
      : warnings.some(Boolean)
        ? t('flow.blocked.fix')
        : null

  return (
    <>
      <PageHeader title={t('sell.products.title')} />
      <div className="flow-layout">
        <Stack gap="lg">
          <ProductSearch
            query={query}
            onQueryChange={onQueryChange}
            onAdd={onAdd}
            label={t('flow.search')}
            placeholder={t('sell.products.placeholder')}
            details={(product) => (
              <>
                <Text fw={600}>{formatMoney(product.sale_price)}</Text>
                <StockText product={product} />
              </>
            )}
            idle={<FrequentProducts onAdd={onAdd} />}
            notFound={(text) => (
              <div className="flow-empty" role="status">
                {t('sell.products.notFound', { query: text })}
              </div>
            )}
          />

          <Title order={2}>{t('sell.products.lines')}</Title>
          {loadingLines && <Loader />}
          {!loadingLines && views.length === 0 && (
            <div className="flow-empty">{t('flow.empty')}</div>
          )}
          {views.map(({ line, product }, index) => {
            const sum = lineSum(line, product)
            return (
              <LineCard
                key={product.id}
                article={product.article}
                name={product.name}
                onRemove={() =>
                  onChangeLines((lines) => lines.filter((item) => item.productId !== product.id))
                }
                warning={warnings[index]}
                sum={
                  <Group justify="flex-end" align="baseline" gap="sm">
                    <Text c="dimmed">{t('sell.sum')}</Text>
                    <Text fz="var(--q-fz-h2)" lh="var(--q-lh-h2)" fw={700}>
                      {sum === null ? '—' : formatMoney(sum)}
                    </Text>
                  </Group>
                }
              >
                <Stack gap="xs">
                  <Text fw={600}>{t('flow.qty')}</Text>
                  <QtyStepper
                    value={line.qty}
                    onChange={(qty) => changeLine(product.id, { qty })}
                    label={t('flow.qtyOf', { article: product.article })}
                    unit={unitLabel(product.unit)}
                  />
                </Stack>
                <MoneyInput
                  label={t('sell.price')}
                  aria-label={t('sell.priceOf', { article: product.article })}
                  value={linePriceText(line, product)}
                  onChange={(price) => changeLine(product.id, { price })}
                  w={FIELD_WIDTH.price}
                />
              </LineCard>
            )
          })}
        </Stack>

        <TotalsPanel
          actionLabel={t('sell.products.next')}
          actionColor="green"
          onAction={onNext}
          blockedReason={blockedReason}
          onCancel={onCancel}
          summary={
            <Stat
              size="display"
              label={t('sell.total')}
              value={formatAmount(totals.sum)}
              unit="₸"
              testId="sale-total"
            />
          }
        >
          <Text>
            <Trans
              i18nKey="flow.kinds"
              values={{ kinds: totals.kinds }}
              components={{ b: <b /> }}
            />
          </Text>
          <Text>
            <Trans i18nKey="flow.pieces" values={{ qty: totals.qty }} components={{ b: <b /> }} />
          </Text>
        </TotalsPanel>
      </div>
    </>
  )
}
