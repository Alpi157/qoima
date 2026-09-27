import {
  Alert,
  Anchor,
  Box,
  Button,
  Card,
  CloseButton,
  Grid,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useBeforeUnload, useBlocker, useNavigate } from 'react-router-dom'

import { isApiError } from '../../api/errors'
import { ConfirmModal } from '../../components/ConfirmModal'
import { type PickedCustomer, CustomerPicker } from '../../components/CustomerPicker'
import { MoneyInput } from '../../components/MoneyInput'
import { ProductPicker } from '../../components/ProductPicker'
import { WIDE_SCREEN } from '../../lib/breakpoints'
import { localInputToIso, nowLocalInput } from '../../lib/dates'
import { serverFormErrors } from '../../lib/formErrors'
import { formatMoney, tiynToInput } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import type { Product } from '../products/api'
import { SALE_REQUEST_CONFLICT, usePostSale } from './api'
import {
  exceedsStock,
  lineHasErrors,
  lineTotal,
  PRICE_REQUIRED,
  saleBody,
  type SaleLine,
  saleTotal,
} from './saleLines'

const HEADER_FIELD_MAP = { note: 'note', sold_at: 'soldAt' }

type LineField = 'qty' | 'price'

function lineErrorKey(key: number, field: LineField): string {
  return `line.${key}.${field}`
}

function isCtrlEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && event.ctrlKey
}

interface LineInputsProps {
  line: SaleLine
  withLabels: boolean
  serverErrors: Record<string, string>
  qtyRef: (element: HTMLInputElement | null) => void
  onChange: (changes: Partial<Pick<SaleLine, 'qty' | 'price'>>) => void
  onEnter: () => void
  onRemove: () => void
}

/** Quantity, price and the remove button of one line: the same in the table and in a card. */
function lineInputs({
  line,
  withLabels,
  serverErrors,
  qtyRef,
  onChange,
  onEnter,
  onRemove,
}: LineInputsProps) {
  const { article, stock } = line.product
  // Plain Enter goes back to the search; Ctrl+Enter bubbles up and posts the sale.
  const backToSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.ctrlKey) {
      event.preventDefault()
      onEnter()
    }
  }
  const qty = (
    <Stack gap={2}>
      <NumberInput
        ref={qtyRef}
        label={withLabels ? 'Количество' : undefined}
        aria-label={`Количество ${article}`}
        value={line.qty}
        onChange={(qty) => onChange({ qty })}
        onKeyDown={backToSearch}
        min={1}
        allowDecimal={false}
        allowNegative={false}
        clampBehavior="none"
        hideControls
        error={qtyError(line.qty) ?? serverErrors[lineErrorKey(line.key, 'qty')]}
        w={withLabels ? undefined : 100}
      />
      {exceedsStock(line) && (
        <Text size="sm" c="orange" fw={500}>
          На остатке {stock}
        </Text>
      )}
    </Stack>
  )
  const price = (
    <MoneyInput
      label={withLabels ? 'Цена' : undefined}
      aria-label={`Цена ${article}`}
      value={line.price}
      onChange={(price) => onChange({ price })}
      onKeyDown={backToSearch}
      // A malformed amount is reported by MoneyInput itself.
      error={
        serverErrors[lineErrorKey(line.key, 'price')] ??
        (line.price.trim() ? undefined : PRICE_REQUIRED)
      }
      w={withLabels ? undefined : 140}
    />
  )
  const remove = <CloseButton aria-label={`Удалить строку ${article}`} onClick={onRemove} />
  const total = lineTotal(line)
  const sum = total !== null ? formatMoney(total) : '—'
  return { qty, price, remove, sum }
}

type LineRowProps = Omit<LineInputsProps, 'withLabels'>

function LineTableRow(props: LineRowProps) {
  const { qty, price, remove, sum } = lineInputs({ ...props, withLabels: false })
  const { product } = props.line
  return (
    <Table.Tr>
      <Table.Td fw={700} style={{ wordBreak: 'break-all' }}>
        {product.article}
      </Table.Td>
      <Table.Td>{product.name}</Table.Td>
      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
        {product.stock} {product.unit}
      </Table.Td>
      <Table.Td>{qty}</Table.Td>
      <Table.Td>{price}</Table.Td>
      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
        {sum}
      </Table.Td>
      <Table.Td>{remove}</Table.Td>
    </Table.Tr>
  )
}

function LineCard(props: LineRowProps) {
  const { qty, price, remove, sum } = lineInputs({ ...props, withLabels: true })
  const { product } = props.line
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="lg" fw={700} style={{ wordBreak: 'break-all' }}>
            {product.article}
          </Text>
          <Text>{product.name}</Text>
          <Text size="sm" c="dimmed">
            Остаток: {product.stock} {product.unit}
          </Text>
        </Stack>
        {remove}
      </Group>
      <SimpleGrid cols={2} mt="xs">
        {qty}
        {price}
      </SimpleGrid>
      <Text ta="right" fw={500}>
        Сумма: {sum}
      </Text>
    </Card>
  )
}

export function NewSalePage() {
  const navigate = useNavigate()
  const post = usePostSale()
  const wide = useMediaQuery(WIDE_SCREEN)

  // One id per sale form: a resend after any error reuses it, so the sale is not posted twice.
  // A new sale is a new page visit, and with it a new id.
  const [requestId] = useState(() => crypto.randomUUID())
  const [customer, setCustomer] = useState<PickedCustomer | null>(null)
  const [note, setNote] = useState('')
  // null: the user has not touched the date, the server takes the moment of posting.
  const [soldAt, setSoldAt] = useState<string | null>(null)
  const [lines, setLines] = useState<SaleLine[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<ReactNode>(null)

  const pickerRef = useRef<HTMLInputElement>(null)
  const qtyRefs = useRef(new Map<number, HTMLInputElement>())
  const nextKey = useRef(1)
  const posted = useRef(false)

  const hasUnsaved = lines.length > 0
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsaved && !posted.current && currentLocation.pathname !== nextLocation.pathname,
  )
  useBeforeUnload((event) => {
    if (hasUnsaved && !posted.current) event.preventDefault()
  })

  const clearError = (name: string) => {
    if (!(name in fieldErrors)) return
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  const addProduct = (product: Product) => {
    const existing = lines.find((line) => line.product.id === product.id)
    const key = existing ? existing.key : nextKey.current++
    // Commit the new row first, so its quantity field exists when we focus it.
    flushSync(() => {
      setLines((current) =>
        existing
          ? current.map((line) =>
              line.key === key
                ? {
                    ...line,
                    // The search has the latest stock.
                    product,
                    qty: typeof line.qty === 'number' ? line.qty + 1 : 1,
                  }
                : line,
            )
          : [...current, { key, product, qty: 1, price: tiynToInput(product.sale_price) }],
      )
    })
    const input = qtyRefs.current.get(key)
    input?.focus()
    input?.select()
  }

  const changeLine = (key: number, changes: Partial<Pick<SaleLine, 'qty' | 'price'>>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    )
    if ('qty' in changes) clearError(lineErrorKey(key, 'qty'))
    if ('price' in changes) clearError(lineErrorKey(key, 'price'))
  }

  const removeLine = (key: number) => {
    setLines((current) => current.filter((line) => line.key !== key))
    pickerRef.current?.focus()
  }

  const total = saleTotal(lines)
  const canPost =
    lines.length > 0 && !lines.some((line) => lineHasErrors(line) || exceedsStock(line))

  const submit = () => {
    if (!canPost || post.isPending) return
    setFormError(null)
    setFieldErrors({})
    // Server errors point at "lines.<index>"; remember which row had which index.
    const fieldMap: Record<string, string> = { ...HEADER_FIELD_MAP }
    lines.forEach((line, index) => {
      fieldMap[`lines.${index}.qty`] = lineErrorKey(line.key, 'qty')
      fieldMap[`lines.${index}.unit_price`] = lineErrorKey(line.key, 'price')
    })
    const header = {
      requestId,
      customerId: customer?.id ?? null,
      note,
      soldAt: soldAt === null ? null : localInputToIso(soldAt),
    }
    post.mutate(saleBody(header, lines), {
      onSuccess: (sale) => {
        posted.current = true
        notifications.show({ color: 'green', message: `Продажа №${sale.number} проведена` })
        navigate(`/sales/${sale.id}`)
      },
      onError: (error) => {
        if (isApiError(error) && error.status === 409 && error.detail === SALE_REQUEST_CONFLICT) {
          setFormError(
            <>
              Продажа могла уже пройти. Проверьте{' '}
              <Anchor component={Link} to="/sales" inherit>
                историю продаж
              </Anchor>
            </>,
          )
          return
        }
        const { fields, message } = serverFormErrors(error, { fieldMap })
        setFieldErrors(fields)
        setFormError(message)
      },
    })
  }

  const rowProps = (line: SaleLine): LineRowProps => ({
    line,
    serverErrors: fieldErrors,
    qtyRef: (element) => {
      if (element) qtyRefs.current.set(line.key, element)
      else qtyRefs.current.delete(line.key)
    },
    onChange: (changes) => changeLine(line.key, changes),
    onEnter: () => pickerRef.current?.focus(),
    onRemove: () => removeLine(line.key),
  })

  return (
    <Box
      onKeyDown={(event) => {
        // A picker that handled Enter (chose an option) marks the event as handled.
        if (isCtrlEnter(event) && !event.defaultPrevented) {
          event.preventDefault()
          submit()
        }
      }}
    >
      <Title order={2} mb="md">
        Продажа
      </Title>
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack>
            <ProductPicker ref={pickerRef} autoFocus label="Добавить товар" onSelect={addProduct} />

            {lines.length === 0 ? (
              <Paper withBorder p="lg" radius="md">
                <Text c="dimmed" ta="center">
                  Найдите товар по артикулу, чтобы добавить строку
                </Text>
              </Paper>
            ) : wide ? (
              <Table.ScrollContainer minWidth={720}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Артикул</Table.Th>
                      <Table.Th>Наименование</Table.Th>
                      <Table.Th ta="right">Остаток</Table.Th>
                      <Table.Th>Количество</Table.Th>
                      <Table.Th>Цена</Table.Th>
                      <Table.Th ta="right">Сумма</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {lines.map((line) => (
                      <LineTableRow key={line.key} {...rowProps(line)} />
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : (
              <Stack gap="sm">
                {lines.map((line) => (
                  <LineCard key={line.key} {...rowProps(line)} />
                ))}
              </Stack>
            )}
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Paper withBorder p="md" radius="md">
            <Stack>
              <CustomerPicker value={customer} onChange={setCustomer} />
              <DateTimePicker
                label="Дата и время"
                valueFormat="DD.MM.YYYY HH:mm"
                value={soldAt ?? nowLocalInput()}
                maxDate={nowLocalInput()}
                onChange={(value) => {
                  setSoldAt(value)
                  clearError('soldAt')
                }}
                error={fieldErrors.soldAt}
              />
              <Textarea
                label="Заметка"
                autosize
                minRows={1}
                value={note}
                onChange={(event) => {
                  setNote(event.currentTarget.value)
                  clearError('note')
                }}
                error={fieldErrors.note}
              />

              <Group justify="space-between" align="baseline">
                <Text size="xl" fw={700}>
                  ИТОГО
                </Text>
                <Text fz={32} fw={700} data-testid="sale-total">
                  {formatMoney(total)}
                </Text>
              </Group>

              {formError && (
                <Alert color="red" role="alert">
                  {formError}
                </Alert>
              )}

              <Button size="lg" onClick={submit} disabled={!canPost} loading={post.isPending}>
                Провести продажу
              </Button>
              <Text size="xs" c="dimmed" ta="center">
                Ctrl+Enter — провести
              </Text>
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>

      <ConfirmModal
        opened={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Уйти без проведения?"
        confirmLabel="Уйти"
        color="red"
        onConfirm={() => blocker.proceed?.()}
      >
        Продажа не проведена, добавленные строки пропадут.
      </ConfirmModal>
    </Box>
  )
}
