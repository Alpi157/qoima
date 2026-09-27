import {
  Alert,
  Anchor,
  Button,
  Card,
  CloseButton,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useBeforeUnload, useBlocker, useNavigate } from 'react-router-dom'

import { ConfirmModal } from '../../components/ConfirmModal'
import { MoneyInput } from '../../components/MoneyInput'
import { ProductPicker } from '../../components/ProductPicker'
import { WIDE_SCREEN } from '../../lib/breakpoints'
import { localInputToIso, nowLocalInput } from '../../lib/dates'
import { serverFormErrors } from '../../lib/formErrors'
import { formatMoney } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import type { Product } from '../products/api'
import { usePostReceipt } from './api'
import {
  lineHasErrors,
  lineTotal,
  type ReceiptLine,
  receiptBody,
  receiptTotals,
} from './receiptLines'

export const INITIAL_STOCK_SUPPLIER = 'Начальные остатки'

const HEADER_FIELD_MAP = { supplier: 'supplier', note: 'note', received_at: 'receivedAt' }

type LineField = 'qty' | 'cost'

function lineErrorKey(key: number, field: LineField): string {
  return `line.${key}.${field}`
}

interface LineInputsProps {
  line: ReceiptLine
  withLabels: boolean
  serverErrors: Record<string, string>
  qtyRef: (element: HTMLInputElement | null) => void
  onChange: (changes: Partial<Pick<ReceiptLine, 'qty' | 'cost'>>) => void
  onQtyEnter: () => void
  onRemove: () => void
}

/** Quantity, price and the remove button of one line: the same in the table and in a card. */
function lineInputs({
  line,
  withLabels,
  serverErrors,
  qtyRef,
  onChange,
  onQtyEnter,
  onRemove,
}: LineInputsProps) {
  const article = line.product.article
  const qty = (
    <NumberInput
      ref={qtyRef}
      label={withLabels ? 'Количество' : undefined}
      aria-label={`Количество ${article}`}
      value={line.qty}
      onChange={(qty) => onChange({ qty })}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onQtyEnter()
        }
      }}
      min={1}
      allowDecimal={false}
      allowNegative={false}
      clampBehavior="none"
      hideControls
      error={qtyError(line.qty) ?? serverErrors[lineErrorKey(line.key, 'qty')]}
      w={withLabels ? undefined : 110}
    />
  )
  const cost = (
    <MoneyInput
      label={withLabels ? 'Закупочная цена' : undefined}
      aria-label={`Закупочная цена ${article}`}
      placeholder="Необязательно"
      value={line.cost}
      onChange={(cost) => onChange({ cost })}
      error={serverErrors[lineErrorKey(line.key, 'cost')]}
      w={withLabels ? undefined : 150}
    />
  )
  const remove = <CloseButton aria-label={`Удалить строку ${article}`} onClick={onRemove} />
  const total = lineTotal(line)
  const sum = total !== null ? formatMoney(total) : '—'
  return { qty, cost, remove, sum }
}

type LineRowProps = Omit<LineInputsProps, 'withLabels'>

function LineTableRow(props: LineRowProps) {
  const { qty, cost, remove, sum } = lineInputs({ ...props, withLabels: false })
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
      <Table.Td>{cost}</Table.Td>
      <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
        {sum}
      </Table.Td>
      <Table.Td>{remove}</Table.Td>
    </Table.Tr>
  )
}

function LineCard(props: LineRowProps) {
  const { qty, cost, remove, sum } = lineInputs({ ...props, withLabels: true })
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
        {cost}
      </SimpleGrid>
      <Text ta="right" fw={500}>
        Сумма: {sum}
      </Text>
    </Card>
  )
}

export function NewReceiptPage() {
  const navigate = useNavigate()
  const post = usePostReceipt()
  const wide = useMediaQuery(WIDE_SCREEN)

  const [supplier, setSupplier] = useState('')
  const [note, setNote] = useState('')
  // null: the user has not touched the date, the server takes the moment of posting.
  const [receivedAt, setReceivedAt] = useState<string | null>(null)
  const [lines, setLines] = useState<ReceiptLine[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

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
                ? { ...line, qty: typeof line.qty === 'number' ? line.qty + 1 : 1 }
                : line,
            )
          : [...current, { key, product, qty: 1, cost: '' }],
      )
    })
    const input = qtyRefs.current.get(key)
    input?.focus()
    input?.select()
  }

  const changeLine = (key: number, changes: Partial<Pick<ReceiptLine, 'qty' | 'cost'>>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    )
    if ('qty' in changes) clearError(lineErrorKey(key, 'qty'))
    if ('cost' in changes) clearError(lineErrorKey(key, 'cost'))
  }

  const removeLine = (key: number) => {
    setLines((current) => current.filter((line) => line.key !== key))
    pickerRef.current?.focus()
  }

  const totals = receiptTotals(lines)
  const canPost = lines.length > 0 && !lines.some(lineHasErrors)

  const submit = () => {
    if (!canPost) return
    setFormError(null)
    setFieldErrors({})
    // Server errors point at "lines.<index>"; remember which row had which index.
    const fieldMap: Record<string, string> = { ...HEADER_FIELD_MAP }
    lines.forEach((line, index) => {
      fieldMap[`lines.${index}.qty`] = lineErrorKey(line.key, 'qty')
      fieldMap[`lines.${index}.unit_cost`] = lineErrorKey(line.key, 'cost')
    })
    const header = {
      supplier,
      note,
      receivedAt: receivedAt === null ? null : localInputToIso(receivedAt),
    }
    post.mutate(receiptBody(header, lines), {
      onSuccess: (receipt) => {
        posted.current = true
        notifications.show({ color: 'green', message: `Приход №${receipt.number} проведён` })
        navigate(`/receipts/${receipt.id}`)
      },
      onError: (error) => {
        const { fields, message } = serverFormErrors(error, { fieldMap })
        setFieldErrors(fields)
        setFormError(message)
      },
    })
  }

  const rowProps = (line: ReceiptLine): LineRowProps => ({
    line,
    serverErrors: fieldErrors,
    qtyRef: (element) => {
      if (element) qtyRefs.current.set(line.key, element)
      else qtyRefs.current.delete(line.key)
    },
    onChange: (changes) => changeLine(line.key, changes),
    onQtyEnter: () => pickerRef.current?.focus(),
    onRemove: () => removeLine(line.key),
  })

  return (
    <Stack>
      <Anchor component={Link} to="/receipts" size="sm">
        ← Приходы
      </Anchor>
      <Title order={2}>Новый приход</Title>

      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Group align="flex-end" wrap="nowrap" gap="xs">
          <TextInput
            label="Поставщик"
            autoComplete="off"
            style={{ flex: 1 }}
            value={supplier}
            onChange={(event) => {
              setSupplier(event.currentTarget.value)
              clearError('supplier')
            }}
            error={fieldErrors.supplier}
          />
          <Button
            variant="light"
            onClick={() => {
              setSupplier(INITIAL_STOCK_SUPPLIER)
              clearError('supplier')
            }}
          >
            {INITIAL_STOCK_SUPPLIER}
          </Button>
        </Group>
        <DateTimePicker
          label="Дата и время"
          valueFormat="DD.MM.YYYY HH:mm"
          value={receivedAt ?? nowLocalInput()}
          maxDate={nowLocalInput()}
          onChange={(value) => {
            setReceivedAt(value)
            clearError('receivedAt')
          }}
          error={fieldErrors.receivedAt}
        />
      </SimpleGrid>
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

      <ProductPicker ref={pickerRef} autoFocus label="Добавить товар" onSelect={addProduct} />

      {lines.length === 0 ? (
        <Paper withBorder p="lg" radius="md">
          <Text c="dimmed" ta="center">
            Найдите товар по артикулу, чтобы добавить строку
          </Text>
        </Paper>
      ) : wide ? (
        <Table.ScrollContainer minWidth={800}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Артикул</Table.Th>
                <Table.Th>Наименование</Table.Th>
                <Table.Th ta="right">Остаток</Table.Th>
                <Table.Th>Количество</Table.Th>
                <Table.Th>Закупочная цена</Table.Th>
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

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between">
          <Text>Позиций: {totals.positions}</Text>
          <Text>Штук: {totals.pieces}</Text>
          <Text fw={600}>Сумма закупки: {formatMoney(totals.cost)}</Text>
        </Group>
      </Paper>

      {formError && (
        <Alert color="red" role="alert">
          {formError}
        </Alert>
      )}

      <Group justify="flex-end">
        <Button size="md" onClick={submit} disabled={!canPost} loading={post.isPending}>
          Провести приход
        </Button>
      </Group>

      <ConfirmModal
        opened={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title="Уйти без проведения?"
        confirmLabel="Уйти"
        color="red"
        onConfirm={() => blocker.proceed?.()}
      >
        Приход не проведён, добавленные строки пропадут.
      </ConfirmModal>
    </Stack>
  )
}
