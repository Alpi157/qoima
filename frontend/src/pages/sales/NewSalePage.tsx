import {
  Alert,
  Anchor,
  Box,
  Button,
  CloseButton,
  Grid,
  Group,
  NumberInput,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
} from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { flushSync } from 'react-dom'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useBeforeUnload, useBlocker, useNavigate } from 'react-router-dom'

import { hasErrorCode } from '../../api/errors'
import { ConfirmModal } from '../../components/ConfirmModal'
import { type PickedCustomer, CustomerPicker } from '../../components/CustomerPicker'
import { MoneyInput } from '../../components/MoneyInput'
import { ProductPicker } from '../../components/ProductPicker'
import { Card, PageContainer, PageHeader, Stat } from '../../components/ui'
import { WIDE_SCREEN } from '../../lib/breakpoints'
import { localInputToIso, nowLocalInput } from '../../lib/dates'
import { serverFormErrors } from '../../lib/formErrors'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatMoney, tiynToInput } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import type { Product } from '../products/api'
import { SALE_REQUEST_CONFLICT, usePostSale } from './api'
import {
  exceedsStock,
  lineHasErrors,
  lineTotal,
  priceError,
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
  t: TFunction
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
  t,
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
    <Stack gap="xs">
      <NumberInput
        ref={qtyRef}
        label={withLabels ? t('sales.new.qty') : undefined}
        aria-label={t('sales.new.qtyOf', { article })}
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
        <Text size="sm" c="orange.9" fw={600}>
          {t('sales.new.inStock', { stock })}
        </Text>
      )}
    </Stack>
  )
  const price = (
    <MoneyInput
      label={withLabels ? t('sales.new.price') : undefined}
      aria-label={t('sales.new.priceOf', { article })}
      value={line.price}
      onChange={(price) => onChange({ price })}
      onKeyDown={backToSearch}
      // A malformed amount is reported by MoneyInput itself.
      error={
        serverErrors[lineErrorKey(line.key, 'price')] ??
        (line.price.trim() ? undefined : (priceError(line.price) ?? undefined))
      }
      w={withLabels ? undefined : 140}
    />
  )
  const remove = <CloseButton aria-label={t('common.removeLine', { article })} onClick={onRemove} />
  const total = lineTotal(line)
  const sum = total !== null ? formatMoney(total) : '—'
  return { qty, price, remove, sum }
}

type LineRowProps = Omit<LineInputsProps, 'withLabels' | 't'>

function LineTableRow(props: LineRowProps) {
  const { t } = useTranslation()
  const { qty, price, remove, sum } = lineInputs({ ...props, withLabels: false, t })
  const { product } = props.line
  return (
    <Table.Tr>
      <Table.Td fw={600} style={{ wordBreak: 'break-all' }}>
        {product.article}
      </Table.Td>
      <Table.Td>{product.name}</Table.Td>
      <Table.Td data-numeric>
        {product.stock} {unitLabel(product.unit)}
      </Table.Td>
      <Table.Td>{qty}</Table.Td>
      <Table.Td>{price}</Table.Td>
      <Table.Td data-numeric>{sum}</Table.Td>
      <Table.Td>{remove}</Table.Td>
    </Table.Tr>
  )
}

function LineCard(props: LineRowProps) {
  const { t } = useTranslation()
  const { qty, price, remove, sum } = lineInputs({ ...props, withLabels: true, t })
  const { product } = props.line
  return (
    <Card>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fw={600} style={{ wordBreak: 'break-all' }}>
            {product.article}
          </Text>
          <Text>{product.name}</Text>
          <Text size="sm" c="dimmed">
            {t('products.picker.stock', { stock: `${product.stock} ${unitLabel(product.unit)}` })}
          </Text>
        </Stack>
        {remove}
      </Group>
      <SimpleGrid cols={2} mt="md" spacing="md">
        {qty}
        {price}
      </SimpleGrid>
      <Text ta="right" fw={600} mt="md">
        {t('common.lineSum', { amount: sum })}
      </Text>
    </Card>
  )
}

export function NewSalePage() {
  const navigate = useNavigate()
  const post = usePostSale()
  const wide = useMediaQuery(WIDE_SCREEN)
  const { t } = useTranslation()

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
        notifications.show({
          color: 'green',
          message: t('sales.new.posted', { number: sale.number }),
        })
        navigate(`/sales/${sale.id}/print?auto=1`)
      },
      onError: (error) => {
        if (hasErrorCode(error, SALE_REQUEST_CONFLICT)) {
          setFormError(
            <Trans
              i18nKey="sales.new.requestConflict"
              components={{ history: <Anchor component={Link} to="/sales" inherit /> }}
            />,
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
      <PageContainer>
        <PageHeader title={t('sales.new.title')} />
        <Grid gap="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Stack gap="lg">
              <ProductPicker
                ref={pickerRef}
                autoFocus
                label={t('sales.new.addProduct')}
                onSelect={addProduct}
              />

              {lines.length === 0 ? (
                <Card>
                  <Text c="dimmed" ta="center">
                    {t('sales.new.emptyLines')}
                  </Text>
                </Card>
              ) : wide ? (
                <Card padding={0}>
                  <Table.ScrollContainer minWidth={720} type="native">
                    <Table className="q-table">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t('sales.lines.article')}</Table.Th>
                          <Table.Th>{t('sales.lines.name')}</Table.Th>
                          <Table.Th data-numeric>{t('sales.new.stock')}</Table.Th>
                          <Table.Th>{t('sales.new.qty')}</Table.Th>
                          <Table.Th>{t('sales.new.price')}</Table.Th>
                          <Table.Th data-numeric>{t('sales.lines.sum')}</Table.Th>
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
                </Card>
              ) : (
                <Stack gap="md">
                  {lines.map((line) => (
                    <LineCard key={line.key} {...rowProps(line)} />
                  ))}
                </Stack>
              )}
            </Stack>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card>
              <Stack gap="lg">
                <CustomerPicker value={customer} onChange={setCustomer} />
                <DateTimePicker
                  label={t('sales.new.date')}
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
                  label={t('sales.new.note')}
                  autosize
                  minRows={1}
                  value={note}
                  onChange={(event) => {
                    setNote(event.currentTarget.value)
                    clearError('note')
                  }}
                  error={fieldErrors.note}
                />

                <Stat
                  size="display"
                  label={t('sales.new.total')}
                  value={formatAmount(total)}
                  unit="₸"
                  testId="sale-total"
                />

                {formError && (
                  <Alert color="red" role="alert">
                    {formError}
                  </Alert>
                )}

                <Stack gap="xs">
                  <Button
                    size="lg"
                    color="green"
                    onClick={submit}
                    disabled={!canPost}
                    loading={post.isPending}
                  >
                    {t('sales.new.submit')}
                  </Button>
                  <Text size="sm" c="dimmed" ta="center">
                    {t('sales.new.submitHint')}
                  </Text>
                </Stack>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      </PageContainer>

      <ConfirmModal
        opened={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        title={t('common.leave.title')}
        confirmLabel={t('common.leave.confirm')}
        color="red"
        onConfirm={() => blocker.proceed?.()}
      >
        {t('sales.new.leaveText')}
      </ConfirmModal>
    </Box>
  )
}
