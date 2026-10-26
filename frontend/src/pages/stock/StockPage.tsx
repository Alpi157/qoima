import { Button, Group, Loader, SimpleGrid, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { BoxIcon } from '../../components/icons'
import { ListPagination } from '../../components/ListPagination'
import { QueryError } from '../../components/QueryError'
import { SearchInput } from '../../components/SearchInput'
import {
  DataTable,
  Card,
  Stat,
  StatusBadge,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  RowLink,
} from '../../components/ui'
import { unitLabel } from '../../lib/labels'
import { formatInteger, formatMoney, formatRoundedMoney } from '../../lib/money'
import { useListParams } from '../../lib/useListParams'
import { type Product, useProducts } from '../products/api'
import { useStockSummary } from './api'
import { StockBuyToday } from './StockBuyToday'

const productPath = (product: Product) => `/products/${product.id}`

/** «10 дана», or «Жоқ» in red when there is nothing left. */
function StockCell({ product }: { product: Product }) {
  const { t } = useTranslation()
  const state =
    product.stock === 0
      ? 'out'
      : product.min_qty !== null && product.stock <= product.min_qty
        ? 'low'
        : null
  return (
    <Stack gap="xs" align="flex-end">
      <Text span inherit fw={600}>
        {formatInteger(product.stock)} {unitLabel(product.unit)}
      </Text>
      {state && (
        <StatusBadge tone="warning">
          {state === 'out' ? t('stock.out') : t('stock.low')}
        </StatusBadge>
      )}
    </Stack>
  )
}

function StockSummary() {
  const { t } = useTranslation()
  const query = useStockSummary()
  if (query.isPending) return <Loader />
  if (query.isError) return <QueryError error={query.error} onRetry={() => query.refetch()} />
  const data = query.data
  return (
    <Card>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
        <Stat label={t('stock.kinds')} value={formatInteger(data.products_count)} />
        <Stat label={t('stock.total')} value={formatInteger(data.total_qty)} unit={t('flow.pcs')} />
        <Stat
          label={t('stock.costValue')}
          value={formatRoundedMoney(data.cost_value, false)}
          unit="₸"
        />
        <Stat
          label={t('stock.retailValue')}
          value={formatRoundedMoney(data.retail_value, false)}
          unit="₸"
        />
      </SimpleGrid>
      <StockBuyToday />
      {data.archived_products_count > 0 && (
        <Text mt="md" size="sm" c="dimmed">
          {t('stock.archivedStock', {
            count: data.archived_products_count,
            amount: formatRoundedMoney(data.archived_cost_value),
          })}
        </Text>
      )}
      {data.unknown_cost_count > 0 && (
        <Text mt="md" size="sm" c="dimmed">
          {t('stock.unknownCost', { count: data.unknown_cost_count })}
        </Text>
      )}
    </Card>
  )
}

function StockCard({ product }: { product: Product }) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs">
      <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
        {product.article}
      </Text>
      <Text>{product.name}</Text>
      <Group justify="space-between">
        <Text>{formatMoney(product.sale_price)}</Text>
        <StockCell product={product} />
      </Group>
      {product.avg_cost !== null && (
        <Text size="sm">
          {t('stock.cost')}: {formatRoundedMoney(product.avg_cost)}
        </Text>
      )}
    </Stack>
  )
}

/** /stock «Қоймада не бар?»: what is in stock, found by article or name. */
export function StockPage() {
  const { t } = useTranslation()
  const { q, page, setQ, setPage, searchParams, setParam } = useListParams()
  const rawState = searchParams.get('state')
  const stockState = rawState === 'out' || rawState === 'low' ? rawState : undefined
  const products = useProducts({ q, includeArchived: false, page, stockState })
  const summary = useStockSummary()

  const columns: DataTableColumn<Product>[] = [
    {
      key: 'article',
      header: t('stock.columns.article'),
      cell: (product) => <RowLink to={productPath(product)}>{product.article}</RowLink>,
    },
    { key: 'name', header: t('stock.columns.name'), cell: (product) => product.name },
    {
      key: 'price',
      header: t('stock.columns.price'),
      numeric: true,
      cell: (product) => formatMoney(product.sale_price),
    },
    {
      key: 'cost',
      header: t('stock.cost'),
      numeric: true,
      cell: (product) => (product.avg_cost === null ? null : formatRoundedMoney(product.avg_cost)),
    },
    {
      key: 'stock',
      header: t('stock.columns.stock'),
      numeric: true,
      cell: (product) => <StockCell product={product} />,
    },
  ]

  return (
    <PageContainer>
      <PageHeader
        title={t('stock.title')}
        actions={
          <Button component={Link} to="/receive" leftSection={<BoxIcon size={20} />}>
            {t('stock.receive')}
          </Button>
        }
      />

      <StockSummary />
      {summary.data && (
        <Group gap="md">
          <Button
            variant={stockState === 'out' ? 'light' : 'default'}
            aria-pressed={stockState === 'out'}
            onClick={() => setParam('state', stockState === 'out' ? null : 'out')}
          >
            {t('stock.out')} ({formatInteger(summary.data.out_of_stock_count)})
          </Button>
          <Button
            variant={stockState === 'low' ? 'light' : 'default'}
            aria-pressed={stockState === 'low'}
            onClick={() => setParam('state', stockState === 'low' ? null : 'low')}
          >
            {t('stock.low')} ({formatInteger(summary.data.low_stock_count)})
          </Button>
        </Group>
      )}
      <SearchInput
        value={q}
        onSearch={setQ}
        autoFocus
        size="lg"
        label={t('stock.search')}
        placeholder={t('stock.placeholder')}
      />

      {products.isPending ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : products.isError ? (
        <QueryError error={products.error} onRetry={() => products.refetch()} />
      ) : products.data.items.length === 0 && page === 1 ? (
        <EmptyState text={q || stockState ? t('common.nothingFound') : t('products.list.empty')} />
      ) : (
        <Stack gap="md">
          <Text c="dimmed" size="sm">
            {t('common.found', { count: products.data.total })}
          </Text>
          <DataTable
            rows={products.data.items}
            rowKey={(product) => product.id}
            columns={columns}
            rowHref={productPath}
            mobileCard={(product) => <StockCard product={product} />}
          />
          <ListPagination total={products.data.total} page={page} onChange={setPage} />
        </Stack>
      )}
    </PageContainer>
  )
}
