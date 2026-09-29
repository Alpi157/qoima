import { Box, Button, Group, Loader, Stack, Switch, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { QueryError } from '../../components/QueryError'
import { SearchInput } from '../../components/SearchInput'
import {
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  RowLink,
  StatusBadge,
  useBackToMore,
} from '../../components/ui'
import { unitLabel } from '../../lib/labels'
import { formatMoney } from '../../lib/money'
import { useListParams } from '../../lib/useListParams'
import { type Product, useProducts } from './api'
import { ProductFormModal } from './ProductFormModal'

const ARCHIVED_PARAM = 'archived'
// Until step 16.3 the simple «Қоймада не бар?» screen shows this list without the way back.
const STOCK_PATH = '/stock'

const productPath = (product: Product) => `/products/${product.id}`

function StockText({ product }: { product: Product }) {
  return (
    <Text
      span
      inherit
      c={product.stock <= 0 ? 'red' : undefined}
      fw={product.stock <= 0 ? 600 : undefined}
    >
      {product.stock} {unitLabel(product.unit)}
    </Text>
  )
}

function ArchivedBadge() {
  const { t } = useTranslation()
  return <StatusBadge tone="archived">{t('products.archivedBadge')}</StatusBadge>
}

function ProductCard({ product }: { product: Product }) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
          {product.article}
        </Text>
        {product.is_archived && <ArchivedBadge />}
      </Group>
      <Text>{product.name}</Text>
      <Group justify="space-between">
        <Text>{formatMoney(product.sale_price)}</Text>
        <StockText product={product} />
      </Group>
    </Stack>
  )
}

function ProductTable({ items }: { items: Product[] }) {
  const { t } = useTranslation()
  const columns: DataTableColumn<Product>[] = [
    {
      key: 'article',
      header: t('products.list.article'),
      cell: (product) => (
        <Group gap="xs" wrap="nowrap">
          <RowLink to={productPath(product)}>{product.article}</RowLink>
          {product.is_archived && <ArchivedBadge />}
        </Group>
      ),
    },
    { key: 'name', header: t('products.list.name'), cell: (product) => product.name },
    {
      key: 'price',
      header: t('products.list.price'),
      numeric: true,
      cell: (product) => formatMoney(product.sale_price),
    },
    {
      key: 'stock',
      header: t('products.list.stock'),
      numeric: true,
      cell: (product) => <StockText product={product} />,
    },
  ]
  return (
    <DataTable
      rows={items}
      rowKey={(product) => product.id}
      columns={columns}
      rowHref={productPath}
      dimmed={(product) => product.is_archived}
      mobileCard={(product) => <ProductCard product={product} />}
    />
  )
}

export function ProductsPage() {
  const { q, page, searchParams, setQ, setPage, setParam } = useListParams()
  const includeArchived = searchParams.get(ARCHIVED_PARAM) === '1'
  const [formOpened, form] = useDisclosure()
  const products = useProducts({ q, includeArchived, page })
  const { t } = useTranslation()
  const backToMore = useBackToMore()
  const isStockScreen = useLocation().pathname === STOCK_PATH

  const isFiltered = Boolean(q) || includeArchived

  return (
    <PageContainer>
      <PageHeader
        back={isStockScreen ? undefined : backToMore}
        title={t('products.list.title')}
        actions={<Button onClick={form.open}>{t('products.list.add')}</Button>}
      />

      <Group align="center" gap="lg">
        <Box style={{ flex: '1 1 280px' }}>
          <SearchInput
            value={q}
            onSearch={setQ}
            autoFocus
            size="lg"
            placeholder={t('products.list.searchPlaceholder')}
            aria-label={t('products.list.searchLabel')}
          />
        </Box>
        <Switch
          size="md"
          label={t('products.list.showArchived')}
          checked={includeArchived}
          onChange={(event) => setParam(ARCHIVED_PARAM, event.currentTarget.checked ? '1' : null)}
        />
      </Group>

      {products.isPending ? (
        <Group justify="center" p="xl">
          <Loader />
        </Group>
      ) : products.isError ? (
        <QueryError error={products.error} onRetry={() => products.refetch()} />
      ) : products.data.items.length === 0 && page === 1 ? (
        isFiltered ? (
          <EmptyState text={t('common.nothingFound')} />
        ) : (
          <EmptyState
            text={t('products.list.empty')}
            actionLabel={t('products.list.addFirst')}
            onAction={form.open}
          />
        )
      ) : (
        <Stack gap="md">
          <Text c="dimmed" size="sm">
            {t('common.found', { count: products.data.total })}
          </Text>
          <ProductTable items={products.data.items} />
          <ListPagination total={products.data.total} page={page} onChange={setPage} />
        </Stack>
      )}

      <ProductFormModal opened={formOpened} onClose={form.close} />
    </PageContainer>
  )
}
