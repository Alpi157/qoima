import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Link, useNavigate } from 'react-router-dom'

import { EmptyState } from '../../components/EmptyState'
import { ListPagination } from '../../components/ListPagination'
import { QueryError } from '../../components/QueryError'
import { SearchInput } from '../../components/SearchInput'
import { formatMoney } from '../../lib/money'
import { useListParams } from '../../lib/useListParams'
import { type Product, useProducts } from './api'
import { ProductFormModal } from './ProductFormModal'

const ARCHIVED_PARAM = 'archived'

function StockText({ product, size }: { product: Product; size?: string }) {
  return (
    <Text
      span
      size={size}
      c={product.stock <= 0 ? 'red' : undefined}
      fw={product.stock <= 0 ? 600 : undefined}
    >
      {product.stock} {product.unit}
    </Text>
  )
}

function ArchivedBadge() {
  return (
    <Badge color="gray" variant="light">
      Архив
    </Badge>
  )
}

function ProductTable({ items }: { items: Product[] }) {
  const navigate = useNavigate()
  return (
    <Table.ScrollContainer minWidth={600} visibleFrom="sm">
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Артикул</Table.Th>
            <Table.Th>Наименование</Table.Th>
            <Table.Th ta="right">Цена</Table.Th>
            <Table.Th ta="right">Остаток</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((product) => (
            <Table.Tr
              key={product.id}
              onClick={() => navigate(`/products/${product.id}`)}
              style={{ cursor: 'pointer' }}
              c={product.is_archived ? 'dimmed' : undefined}
            >
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  {/* A real link, so the card opens from the keyboard and in a new tab. */}
                  <Anchor
                    component={Link}
                    to={`/products/${product.id}`}
                    fw={600}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {product.article}
                  </Anchor>
                  {product.is_archived && <ArchivedBadge />}
                </Group>
              </Table.Td>
              <Table.Td>{product.name}</Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                {formatMoney(product.sale_price)}
              </Table.Td>
              <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                <StockText product={product} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function ProductCards({ items }: { items: Product[] }) {
  return (
    <Stack gap="sm" hiddenFrom="sm">
      {items.map((product) => (
        <Card
          key={product.id}
          component={Link}
          to={`/products/${product.id}`}
          withBorder
          padding="sm"
          c={product.is_archived ? 'dimmed' : undefined}
          style={{ textDecoration: 'none' }}
        >
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Text size="xl" fw={700} style={{ wordBreak: 'break-all' }}>
              {product.article}
            </Text>
            {product.is_archived && <ArchivedBadge />}
          </Group>
          <Text>{product.name}</Text>
          <Group justify="space-between" mt={4}>
            <Text fw={500}>{formatMoney(product.sale_price)}</Text>
            <StockText product={product} />
          </Group>
        </Card>
      ))}
    </Stack>
  )
}

export function ProductsPage() {
  const { q, page, searchParams, setQ, setPage, setParam } = useListParams()
  const includeArchived = searchParams.get(ARCHIVED_PARAM) === '1'
  const [formOpened, form] = useDisclosure()
  const products = useProducts({ q, includeArchived, page })

  const isFiltered = Boolean(q) || includeArchived

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Товары</Title>
        <Button onClick={form.open}>Добавить товар</Button>
      </Group>

      <Group align="center">
        <Box style={{ flex: 1, minWidth: 220 }}>
          <SearchInput
            value={q}
            onSearch={setQ}
            autoFocus
            placeholder="Артикул или название"
            aria-label="Поиск товара"
          />
        </Box>
        <Switch
          label="Показывать архивные"
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
          <EmptyState text="Ничего не найдено" />
        ) : (
          <EmptyState
            text="Товаров пока нет"
            actionLabel="Добавить первый товар"
            onAction={form.open}
          />
        )
      ) : (
        <>
          <Text c="dimmed" size="sm">
            Найдено: {products.data.total}
          </Text>
          <ProductTable items={products.data.items} />
          <ProductCards items={products.data.items} />
          <ListPagination total={products.data.total} page={page} onChange={setPage} />
        </>
      )}

      <ProductFormModal opened={formOpened} onClose={form.close} />
    </Stack>
  )
}
