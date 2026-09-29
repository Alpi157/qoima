import { Anchor, Button, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { ConfirmModal } from '../../components/ConfirmModal'
import { ListPagination } from '../../components/ListPagination'
import { NotFoundState } from '../../components/NotFoundState'
import { PageLoader } from '../../components/PageLoader'
import { QueryError } from '../../components/QueryError'
import {
  Card,
  DataTable,
  type DataTableColumn,
  PageContainer,
  PageHeader,
  SectionTitle,
  Stat,
  StatusBadge,
} from '../../components/ui'
import { apiErrorText } from '../../i18n/errorText'
import { formatDateTime } from '../../lib/dates'
import { movementKindLabel, unitLabel } from '../../lib/labels'
import { formatAmount } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { useListParams } from '../../lib/useListParams'
import {
  type Movement,
  type Product,
  useProduct,
  useProductMovements,
  useUpdateProduct,
} from './api'
import { ProductFormModal } from './ProductFormModal'
import { StockAdjustmentModal } from './StockAdjustmentModal'

const DOCUMENT_PATHS: Record<string, string> = {
  receipt: '/receipts',
  sale: '/sales',
}

function DocumentLink({ movement }: { movement: Movement }) {
  const { t } = useTranslation()
  const base = movement.doc_type ? DOCUMENT_PATHS[movement.doc_type] : undefined
  if (!base || movement.doc_id === null) return <>—</>
  return (
    <Anchor component={Link} to={`${base}/${movement.doc_id}`}>
      {t('common.documentNumber', { number: movement.doc_number ?? movement.doc_id })}
    </Anchor>
  )
}

function QtyText({ qty }: { qty: number }) {
  return (
    <Text span inherit fw={600} c={qty > 0 ? 'green' : 'red'}>
      {qty > 0 ? `+${qty}` : `−${Math.abs(qty)}`}
    </Text>
  )
}

function MovementCard({ movement: m }: { movement: Movement }) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text fw={600}>
          {movementKindLabel(m.kind)} <DocumentLink movement={m} />
        </Text>
        <QtyText qty={m.qty} />
      </Group>
      <Text size="sm" c="dimmed">
        {formatDateTime(m.created_at)}, {m.created_by_name}
      </Text>
      <Text size="sm">{t('products.movements.balance', { balance: m.balance_after })}</Text>
      {m.note && <Text size="sm">{m.note}</Text>}
    </Stack>
  )
}

function MovementTable({ items }: { items: Movement[] }) {
  const { t } = useTranslation()
  const columns: DataTableColumn<Movement>[] = [
    {
      key: 'date',
      header: t('products.movements.date'),
      nowrap: true,
      cell: (m) => formatDateTime(m.created_at),
    },
    { key: 'kind', header: t('products.movements.kind'), cell: (m) => movementKindLabel(m.kind) },
    {
      key: 'document',
      header: t('products.movements.document'),
      nowrap: true,
      cell: (m) => <DocumentLink movement={m} />,
    },
    {
      key: 'qty',
      header: t('products.movements.qty'),
      numeric: true,
      cell: (m) => <QtyText qty={m.qty} />,
    },
    {
      key: 'balance',
      header: t('products.movements.balanceAfter'),
      numeric: true,
      cell: (m) => m.balance_after,
    },
    { key: 'author', header: t('products.movements.author'), cell: (m) => m.created_by_name },
    { key: 'note', header: t('products.movements.note'), cell: (m) => m.note },
  ]
  return (
    <DataTable
      rows={items}
      rowKey={(m) => m.id}
      columns={columns}
      minWidth={900}
      mobileCard={(m) => <MovementCard movement={m} />}
    />
  )
}

function MovementHistory({ productId }: { productId: number }) {
  const { page, setPage } = useListParams()
  const movements = useProductMovements(productId, page)
  const { t } = useTranslation()

  if (movements.isPending) return <PageLoader />
  if (movements.isError) {
    return <QueryError error={movements.error} onRetry={() => movements.refetch()} />
  }
  if (movements.data.total === 0) return <Text c="dimmed">{t('products.movements.empty')}</Text>
  return (
    <Stack gap="md">
      <MovementTable items={movements.data.items} />
      <ListPagination total={movements.data.total} page={page} onChange={setPage} />
    </Stack>
  )
}

function ProductDetails({ product }: { product: Product }) {
  const [editOpened, edit] = useDisclosure()
  const [archiveOpened, archive] = useDisclosure()
  const [adjustOpened, adjust] = useDisclosure()
  const update = useUpdateProduct(product.id)
  const { t } = useTranslation()

  const toggleArchived = () => {
    const isArchived = !product.is_archived
    update.mutate(
      { is_archived: isArchived },
      {
        onSuccess: (saved) => {
          archive.close()
          notifications.show({
            color: 'green',
            message: isArchived
              ? t('products.archive.archived', { article: saved.article })
              : t('products.archive.restored', { article: saved.article }),
          })
        },
        onError: (error) => {
          archive.close()
          // 5xx and network errors are already shown by the global handler.
          if (isApiError(error) && error.status >= 400 && error.status < 500) {
            notifications.show({
              color: 'red',
              title: t('common.error'),
              message: apiErrorText(error, t),
            })
          }
        },
      },
    )
  }

  return (
    <PageContainer>
      <PageHeader
        back={{ to: '/products', label: t('products.card.back') }}
        title={product.article}
        titleAside={
          product.is_archived && (
            <StatusBadge tone="archived">{t('products.archivedBadge')}</StatusBadge>
          )
        }
        subtitle={
          <>
            {product.name}
            {product.brand && <> · {t('products.card.brand', { brand: product.brand })}</>}
          </>
        }
        actions={
          <>
            <Button onClick={edit.open}>{t('products.card.edit')}</Button>
            <Button variant="default" onClick={adjust.open}>
              {t('products.card.adjust')}
            </Button>
            <Button variant="default" onClick={archive.open}>
              {product.is_archived ? t('products.card.restore') : t('products.card.archive')}
            </Button>
          </>
        }
      />

      <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md" maw={720}>
        <Card>
          <Stat
            size="display"
            label={t('products.card.stock')}
            value={product.stock}
            unit={unitLabel(product.unit)}
            color={product.stock <= 0 ? 'red' : undefined}
          />
        </Card>
        <Card>
          <Stat
            label={t('products.card.price')}
            value={formatAmount(product.sale_price)}
            unit="₸"
          />
        </Card>
      </SimpleGrid>

      {product.note && <Text style={{ whiteSpace: 'pre-wrap' }}>{product.note}</Text>}

      <Stack gap="md">
        <SectionTitle>{t('products.movements.title')}</SectionTitle>
        <MovementHistory productId={product.id} />
      </Stack>

      <ProductFormModal opened={editOpened} onClose={edit.close} product={product} />
      <StockAdjustmentModal product={product} opened={adjustOpened} onClose={adjust.close} />
      <ConfirmModal
        opened={archiveOpened}
        onClose={archive.close}
        title={
          product.is_archived ? t('products.archive.restoreTitle') : t('products.archive.title')
        }
        confirmLabel={
          product.is_archived ? t('products.archive.restoreConfirm') : t('products.archive.confirm')
        }
        onConfirm={toggleArchived}
        loading={update.isPending}
      >
        {product.is_archived
          ? t('products.archive.restoreText', { article: product.article })
          : t('products.archive.text', { article: product.article })}
      </ConfirmModal>
    </PageContainer>
  )
}

function ProductNotFound() {
  const { t } = useTranslation()
  return (
    <NotFoundState
      title={t('products.notFound')}
      back={{ to: '/products', label: t('products.card.back') }}
    />
  )
}

function ProductLoader({ id }: { id: number }) {
  const product = useProduct(id)

  if (product.isPending) return <PageLoader />
  if (product.isError) {
    if (isApiError(product.error) && product.error.status === 404) return <ProductNotFound />
    return (
      <PageContainer>
        <QueryError error={product.error} onRetry={() => product.refetch()} />
      </PageContainer>
    )
  }
  return <ProductDetails product={product.data} />
}

export function ProductPage() {
  const id = parseId(useParams().id)
  if (id === null) return <ProductNotFound />
  // The key resets page state when navigating from one product to another.
  return <ProductLoader key={id} id={id} />
}
