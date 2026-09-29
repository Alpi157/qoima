import { Button, Group, Loader, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { BoxIcon } from '../../components/icons'
import { ListPagination } from '../../components/ListPagination'
import { QueryError } from '../../components/QueryError'
import { SearchInput } from '../../components/SearchInput'
import {
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  RowLink,
} from '../../components/ui'
import { unitLabel } from '../../lib/labels'
import { formatInteger, formatMoney } from '../../lib/money'
import { useListParams } from '../../lib/useListParams'
import { type Product, useProducts } from '../products/api'

const productPath = (product: Product) => `/products/${product.id}`

/** «10 дана», or «Жоқ» in red when there is nothing left. */
function StockCell({ product }: { product: Product }) {
  const { t } = useTranslation()
  if (product.stock <= 0) {
    return (
      <Text span inherit c="red" fw={700}>
        {t('stock.none')}
      </Text>
    )
  }
  return (
    <Text span inherit fw={600}>
      {formatInteger(product.stock)} {unitLabel(product.unit)}
    </Text>
  )
}

function StockCard({ product }: { product: Product }) {
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
    </Stack>
  )
}

/** /stock «Қоймада не бар?»: what is in stock, found by article or name. */
export function StockPage() {
  const { t } = useTranslation()
  const { q, page, setQ, setPage } = useListParams()
  const products = useProducts({ q, includeArchived: false, page })

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
        <EmptyState text={q ? t('common.nothingFound') : t('products.list.empty')} />
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
