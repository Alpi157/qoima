import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { ConfirmModal } from '../../components/ConfirmModal'
import { ListPagination } from '../../components/ListPagination'
import { NotFoundState } from '../../components/NotFoundState'
import { QueryError } from '../../components/QueryError'
import { apiErrorText } from '../../i18n/errorText'
import { formatDateTime } from '../../lib/dates'
import { movementKindLabel, unitLabel } from '../../lib/labels'
import { formatMoney } from '../../lib/money'
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
    <Text span fw={600} c={qty > 0 ? 'green' : 'red'}>
      {qty > 0 ? `+${qty}` : `−${Math.abs(qty)}`}
    </Text>
  )
}

function MovementTable({ items }: { items: Movement[] }) {
  const { t } = useTranslation()
  return (
    <Table.ScrollContainer minWidth={800} visibleFrom="sm">
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('products.movements.date')}</Table.Th>
            <Table.Th>{t('products.movements.kind')}</Table.Th>
            <Table.Th>{t('products.movements.document')}</Table.Th>
            <Table.Th ta="right">{t('products.movements.qty')}</Table.Th>
            <Table.Th ta="right">{t('products.movements.balanceAfter')}</Table.Th>
            <Table.Th>{t('products.movements.author')}</Table.Th>
            <Table.Th>{t('products.movements.note')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((m) => (
            <Table.Tr key={m.id}>
              <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(m.created_at)}</Table.Td>
              <Table.Td>{movementKindLabel(m.kind)}</Table.Td>
              <Table.Td style={{ whiteSpace: 'nowrap' }}>
                <DocumentLink movement={m} />
              </Table.Td>
              <Table.Td ta="right">
                <QtyText qty={m.qty} />
              </Table.Td>
              <Table.Td ta="right">{m.balance_after}</Table.Td>
              <Table.Td>{m.created_by_name}</Table.Td>
              <Table.Td>{m.note}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function MovementCards({ items }: { items: Movement[] }) {
  const { t } = useTranslation()
  return (
    <Stack gap="sm" hiddenFrom="sm">
      {items.map((m) => (
        <Card key={m.id} withBorder padding="sm">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600}>
              {movementKindLabel(m.kind)} <DocumentLink movement={m} />
            </Text>
            <QtyText qty={m.qty} />
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {formatDateTime(m.created_at)}, {m.created_by_name}
            </Text>
            <Text size="sm">{t('products.movements.balance', { balance: m.balance_after })}</Text>
          </Group>
          {m.note && <Text size="sm">{m.note}</Text>}
        </Card>
      ))}
    </Stack>
  )
}

function MovementHistory({ productId }: { productId: number }) {
  const { page, setPage } = useListParams()
  const movements = useProductMovements(productId, page)
  const { t } = useTranslation()

  if (movements.isPending) return <Loader />
  if (movements.isError) {
    return <QueryError error={movements.error} onRetry={() => movements.refetch()} />
  }
  if (movements.data.total === 0) return <Text c="dimmed">{t('products.movements.empty')}</Text>
  return (
    <Stack>
      <MovementTable items={movements.data.items} />
      <MovementCards items={movements.data.items} />
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
    <Stack>
      <Anchor component={Link} to="/products" size="sm">
        {t('products.card.back')}
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="sm">
            <Title order={2} style={{ wordBreak: 'break-all' }}>
              {product.article}
            </Title>
            {product.is_archived && (
              <Badge color="gray" variant="light">
                {t('products.archivedBadge')}
              </Badge>
            )}
          </Group>
          <Text size="lg">{product.name}</Text>
          {product.brand && (
            <Text c="dimmed">{t('products.card.brand', { brand: product.brand })}</Text>
          )}
        </Stack>
        <Group>
          <Button onClick={edit.open}>{t('products.card.edit')}</Button>
          <Button variant="default" onClick={adjust.open}>
            {t('products.card.adjust')}
          </Button>
          <Button variant="default" onClick={archive.open}>
            {product.is_archived ? t('products.card.restore') : t('products.card.archive')}
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3 }} maw={600}>
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="dimmed">
            {t('products.card.stock')}
          </Text>
          <Text size="2rem" fw={700} lh={1.2} c={product.stock <= 0 ? 'red' : undefined}>
            {product.stock} {unitLabel(product.unit)}
          </Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="dimmed">
            {t('products.card.price')}
          </Text>
          <Text size="xl" fw={600} lh={1.6}>
            {formatMoney(product.sale_price)}
          </Text>
        </Paper>
      </SimpleGrid>

      {product.note && <Text style={{ whiteSpace: 'pre-wrap' }}>{product.note}</Text>}

      <Title order={3} mt="md">
        {t('products.movements.title')}
      </Title>
      <MovementHistory productId={product.id} />

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
    </Stack>
  )
}

function ProductNotFound() {
  const { t } = useTranslation()
  return (
    <NotFoundState
      title={t('products.notFound')}
      backTo="/products"
      backLabel={t('products.backToList')}
    />
  )
}

function ProductLoader({ id }: { id: number }) {
  const product = useProduct(id)

  if (product.isPending) return <Loader />
  if (product.isError) {
    if (isApiError(product.error) && product.error.status === 404) return <ProductNotFound />
    return <QueryError error={product.error} onRetry={() => product.refetch()} />
  }
  return <ProductDetails product={product.data} />
}

export function ProductPage() {
  const id = parseId(useParams().id)
  if (id === null) return <ProductNotFound />
  // The key resets page state when navigating from one product to another.
  return <ProductLoader key={id} id={id} />
}
