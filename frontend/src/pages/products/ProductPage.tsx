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
import { Link, useParams } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { ConfirmModal } from '../../components/ConfirmModal'
import { ListPagination } from '../../components/ListPagination'
import { NotFoundState } from '../../components/NotFoundState'
import { QueryError } from '../../components/QueryError'
import { formatDateTime } from '../../lib/dates'
import { movementKindLabel } from '../../lib/labels'
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

const DOCUMENT_PATHS: Record<string, string> = {
  receipt: '/receipts',
  sale: '/sales',
}

function DocumentLink({ movement }: { movement: Movement }) {
  const base = movement.doc_type ? DOCUMENT_PATHS[movement.doc_type] : undefined
  if (!base || movement.doc_id === null) return <>—</>
  return (
    <Anchor component={Link} to={`${base}/${movement.doc_id}`}>
      № {movement.doc_number ?? movement.doc_id}
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
  return (
    <Table.ScrollContainer minWidth={800} visibleFrom="sm">
      <Table verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Дата</Table.Th>
            <Table.Th>Операция</Table.Th>
            <Table.Th>Документ</Table.Th>
            <Table.Th ta="right">Количество</Table.Th>
            <Table.Th ta="right">Остаток после</Table.Th>
            <Table.Th>Кто</Table.Th>
            <Table.Th>Примечание</Table.Th>
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
            <Text size="sm">Остаток: {m.balance_after}</Text>
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

  if (movements.isPending) return <Loader />
  if (movements.isError) {
    return <QueryError error={movements.error} onRetry={() => movements.refetch()} />
  }
  if (movements.data.total === 0) return <Text c="dimmed">Движений пока не было</Text>
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
  const update = useUpdateProduct(product.id)

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
              ? `Товар ${saved.article} перенесён в архив`
              : `Товар ${saved.article} возвращён из архива`,
          })
        },
        onError: (error) => {
          archive.close()
          // 5xx and network errors are already shown by the global handler.
          if (isApiError(error) && error.status >= 400 && error.status < 500) {
            notifications.show({ color: 'red', title: 'Ошибка', message: error.detail })
          }
        },
      },
    )
  }

  return (
    <Stack>
      <Anchor component={Link} to="/products" size="sm">
        ← Товары
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="sm">
            <Title order={2} style={{ wordBreak: 'break-all' }}>
              {product.article}
            </Title>
            {product.is_archived && (
              <Badge color="gray" variant="light">
                Архив
              </Badge>
            )}
          </Group>
          <Text size="lg">{product.name}</Text>
          {product.brand && <Text c="dimmed">Бренд: {product.brand}</Text>}
        </Stack>
        <Group>
          <Button onClick={edit.open}>Изменить</Button>
          <Button variant="default" onClick={archive.open}>
            {product.is_archived ? 'Вернуть из архива' : 'В архив'}
          </Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3 }} maw={600}>
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="dimmed">
            Остаток
          </Text>
          <Text size="2rem" fw={700} lh={1.2} c={product.stock <= 0 ? 'red' : undefined}>
            {product.stock} {product.unit}
          </Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="dimmed">
            Цена
          </Text>
          <Text size="xl" fw={600} lh={1.6}>
            {formatMoney(product.sale_price)}
          </Text>
        </Paper>
      </SimpleGrid>

      {product.note && <Text style={{ whiteSpace: 'pre-wrap' }}>{product.note}</Text>}

      <Title order={3} mt="md">
        История движений
      </Title>
      <MovementHistory productId={product.id} />

      <ProductFormModal opened={editOpened} onClose={edit.close} product={product} />
      <ConfirmModal
        opened={archiveOpened}
        onClose={archive.close}
        title={product.is_archived ? 'Вернуть из архива?' : 'Перенести в архив?'}
        confirmLabel={product.is_archived ? 'Вернуть' : 'В архив'}
        onConfirm={toggleArchived}
        loading={update.isPending}
      >
        {product.is_archived
          ? `Товар ${product.article} снова появится в списке и в поиске.`
          : `Товар ${product.article} пропадёт из списка и поиска. История и остаток сохранятся.`}
      </ConfirmModal>
    </Stack>
  )
}

function ProductNotFound() {
  return <NotFoundState title="Товар не найден" backTo="/products" backLabel="К списку товаров" />
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
