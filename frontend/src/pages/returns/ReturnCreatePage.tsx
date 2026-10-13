import { Alert, Button, Group, Stack, Text, Textarea } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { hasErrorCode, isApiError, isServerOrNetworkError } from '../../api/errors'
import { ExtraSection } from '../../components/ExtraSection'
import { QtyStepper, TotalsPanel } from '../../components/flow'
import { PageLoader } from '../../components/PageLoader'
import { PaymentMethodChoice, type PaymentMethod } from '../../components/PaymentMethodChoice'
import { QueryError } from '../../components/QueryError'
import { TwoChoice } from '../../components/TwoChoice'
import { Card, PageContainer, PageHeader, Stat } from '../../components/ui'
import { apiErrorText } from '../../i18n/errorText'
import { formatDateTime, localInputToIso, nowLocalInput } from '../../lib/dates'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { serverFormErrors } from '../../lib/formErrors'
import { unitLabel } from '../../lib/labels'
import { formatAmount, formatMoney } from '../../lib/money'
import { parseId } from '../../lib/routeParams'
import { ReturnPage } from '../lazyPages'
import { useCustomer } from '../customers/api'
import { type Sale, useSale } from '../sales/api'
import { type ReturnCreate, usePostReturn } from './api'

type Selection = { qty: number | string; condition: 'good' | 'defective' }
type Split = { credit: number; refund: number }
const QUICK_REASONS = [
  'returns.reasons.defective',
  'returns.reasons.unsuitable',
  'returns.reasons.extra',
] as const

function split(total: number, debt: number): Split {
  const credit = Math.min(total, Math.max(debt, 0))
  return { credit, refund: total - credit }
}

function ReturnForm({
  sale,
  initialDebt,
  reloadDebt,
}: {
  sale: Sale
  initialDebt: number
  reloadDebt: () => Promise<number>
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const desktop = useMediaQuery('(min-width: 48em)')
  const post = usePostReturn()
  const [requestId] = useState(() => crypto.randomUUID())
  const [openedAt] = useState(() => new Date())
  const [selected, setSelected] = useState<Record<number, Selection>>(() =>
    Object.fromEntries(sale.lines.map((line) => [line.id, { qty: 0, condition: 'good' }])),
  )
  const [debt, setDebt] = useState(initialDebt)
  const [serverSplit, setServerSplit] = useState<Split | null>(null)
  const [changed, setChanged] = useState({ credit: false, refund: false })
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [returnedAt, setReturnedAt] = useState<string | null>(() => nowLocalInput(openedAt))
  const [note, setNote] = useState('')
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [debtReadError, setDebtReadError] = useState<unknown>(null)
  const lastBody = useRef<ReturnCreate | null>(null)

  const total = sale.lines.reduce(
    (sum, line) => sum + (Number(selected[line.id]?.qty) || 0) * line.unit_price,
    0,
  )
  const preview = serverSplit ?? split(total, debt)
  const invalid = sale.lines.some((line) => {
    const qty = selected[line.id]?.qty
    return (
      qty === '' ||
      !Number.isInteger(Number(qty)) ||
      Number(qty) < 0 ||
      Number(qty) > line.qty - line.returned_qty
    )
  })

  const update = (id: number, value: Partial<Selection>) => {
    setSelected((prev) => ({ ...prev, [id]: { ...prev[id], ...value } }))
    setErrors((prev) => ({ ...prev, [String(id)]: '' }))
    setServerSplit(null)
    setChanged({ credit: false, refund: false })
  }

  const refreshDebt = async () => {
    setRefreshing(true)
    setDebtReadError(null)
    try {
      const current = await reloadDebt()
      setDebt(current)
      return current
    } catch (error) {
      setDebtReadError(error)
      throw error
    } finally {
      setRefreshing(false)
    }
  }

  const submit = () => {
    if (post.isPending || refreshing) return
    const iso =
      returnedAt === nowLocalInput(openedAt)
        ? openedAt.toISOString()
        : returnedAt
          ? localInputToIso(returnedAt)
          : openedAt.toISOString()
    const dateError =
      !iso || new Date(iso).getTime() > new Date().getTime()
        ? t('validation.date_in_future_returned_at')
        : new Date(iso).getTime() < new Date(sale.sold_at).getTime()
          ? t('validation.returned_at_before_sale')
          : null
    if (!retrying && dateError) {
      setErrors({ date: dateError })
      setExtrasOpen(true)
      return
    }
    if (!retrying && (total <= 0 || invalid)) return
    setMessage(null)
    const lines = sale.lines.filter((line) => Number(selected[line.id]?.qty) > 0)
    const body: ReturnCreate =
      retrying && lastBody.current
        ? lastBody.current
        : {
            request_id: requestId,
            sale_id: sale.id,
            returned_at: iso,
            note: note.trim() || null,
            expected_debt_credit: preview.credit,
            expected_refund_amount: preview.refund,
            ...(preview.refund > 0 ? { refund_method: method } : {}),
            lines: lines.map((line) => ({
              sale_line_id: line.id,
              qty: Number(selected[line.id].qty),
              condition: selected[line.id].condition,
            })),
          }
    lastBody.current = body
    post.mutate(body, {
      onSuccess: (saved) => {
        notifications.show({ color: 'green', message: t('returns.saved') })
        navigate(`/returns/${saved.id}`)
      },
      onError: async (error) => {
        setRetrying(isServerOrNetworkError(error))
        if (hasErrorCode(error, 'return_split_changed') && isApiError(error)) {
          const credit = error.params.debt_credit
          const refund = error.params.refund_amount
          if (typeof credit === 'number' && typeof refund === 'number') {
            setServerSplit({ credit, refund })
            setChanged({
              credit: credit !== body.expected_debt_credit,
              refund: refund !== body.expected_refund_amount,
            })
            setMessage(t('errors.return_split_changed'))
            // Keep the authoritative split for this quantity; fresh debt supports later edits.
            try {
              await refreshDebt()
            } catch {
              /* QueryError and the global handler show the failed read. */
            }
            return
          }
        }
        if (
          isApiError(error) &&
          Object.values(error.fieldErrors).some(
            (field) => field.type === 'refund_method_without_refund',
          )
        ) {
          try {
            const current = await refreshDebt()
            const next = split(total, current)
            setServerSplit(next)
            setChanged({
              credit: next.credit !== preview.credit,
              refund: next.refund !== preview.refund,
            })
          } catch {
            /* The failed debt read must be retried before editing the calculation. */
          }
          setMessage(t('errors.return_split_changed'))
          return
        }
        if (hasErrorCode(error, 'return_qty_exceeds_sold') && isApiError(error)) {
          const line = sale.lines.find((line) => line.article === error.params.article)
          if (line) {
            setErrors({ [line.id]: apiErrorText(error, t) })
            return
          }
        }
        const mapped = serverFormErrors(error, {
          fieldMap: {
            returned_at: 'date',
            note: 'note',
            ...Object.fromEntries(
              lines.map((line, index) => [`lines.${index}.qty`, String(line.id)]),
            ),
          },
        })
        setErrors(mapped.fields)
        if (mapped.fields.date || mapped.fields.note) setExtrasOpen(true)
        setMessage(
          mapped.message ?? (isServerOrNetworkError(error) ? apiErrorText(error, t) : null),
        )
      },
    })
  }

  const calculation = (
    <fieldset
      disabled={post.isPending || retrying}
      style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
    >
      <Stack gap="md">
        {sale.customer && (
          <Text className="return-split" data-changed={changed.credit} data-testid="return-credit">
            {t('returns.creditPreview', { amount: formatMoney(preview.credit) })}
          </Text>
        )}
        <Text className="return-split" data-changed={changed.refund} data-testid="return-refund">
          {t('returns.refundPreview', { amount: formatMoney(preview.refund) })}
        </Text>
        {message && (
          <Alert color="orange" role="alert">
            {message}
          </Alert>
        )}
        {Boolean(debtReadError) && (
          <QueryError
            error={debtReadError}
            onRetry={() => {
              void refreshDebt()
                .then((current) => {
                  const next = split(total, current)
                  setServerSplit(next)
                  setChanged({
                    credit: next.credit !== preview.credit,
                    refund: next.refund !== preview.refund,
                  })
                })
                .catch(() => {
                  /* Keep the form and request id while the debt read is unavailable. */
                })
            }}
          />
        )}
        {preview.refund > 0 && (
          <PaymentMethodChoice
            label={t('returns.refundQuestion')}
            value={method}
            onChange={setMethod}
          />
        )}
      </Stack>
    </fieldset>
  )

  return (
    <PageContainer>
      <PageHeader
        back={{ to: `/sales/${sale.id}`, label: t('returns.backSale') }}
        title={t('returns.createTitle')}
        subtitle={
          <>
            {t('returns.saleDate', { number: sale.number, date: formatDateTime(sale.sold_at) })}
            <br />
            {sale.customer ? (
              <Trans
                i18nKey="sell.done.customer"
                values={{ name: sale.customer.name }}
                components={{ b: <b /> }}
              />
            ) : (
              t('sell.review.retail')
            )}
          </>
        }
      />
      <div className="flow-layout">
        <Stack gap="lg">
          <fieldset
            disabled={post.isPending || retrying}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
          >
            <Stack gap="md">
              <Group>
                <Button
                  variant="default"
                  onClick={() => {
                    setSelected((prev) =>
                      Object.fromEntries(
                        sale.lines.map((line) => [
                          line.id,
                          { ...prev[line.id], qty: line.qty - line.returned_qty },
                        ]),
                      ),
                    )
                    setServerSplit(null)
                    setErrors({})
                    setChanged({ credit: false, refund: false })
                  }}
                >
                  {t('returns.all')}
                </Button>
              </Group>
              {sale.lines.map((line) => {
                const available = line.qty - line.returned_qty
                const selection = selected[line.id]
                const qty = Number(selection?.qty) || 0
                const problem =
                  errors[line.id] ||
                  (selection?.qty === '' || !Number.isInteger(qty) || qty < 0 || qty > available
                    ? t('flow.warn.qty')
                    : null)
                return (
                  <Card
                    key={line.id}
                    className={available === 0 ? 'return-complete' : 'flow-line'}
                    data-warning={problem || undefined}
                  >
                    <Stack gap="md">
                      <Stack gap="xs">
                        <Text className="flow-article">{line.article}</Text>
                        <Text>{line.name}</Text>
                        <Text size="sm">
                          {t('returns.sold', { sold: line.qty, returned: line.returned_qty })}
                        </Text>
                      </Stack>
                      {available === 0 ? (
                        <Text fw={600}>{t('returns.complete')}</Text>
                      ) : (
                        <>
                          <Stack gap="xs">
                            <Text fw={600}>{t('flow.qty')}</Text>
                            <QtyStepper
                              value={selection?.qty ?? 0}
                              onChange={(qty) => update(line.id, { qty })}
                              label={t('flow.qtyOf', { article: line.article })}
                              unit={unitLabel(line.unit)}
                              min={0}
                              max={available}
                            />
                          </Stack>
                          {qty > 0 && (
                            <TwoChoice
                              label={t('returns.condition')}
                              value={selection.condition}
                              options={[
                                { value: 'good', label: t('returns.goodChoice') },
                                { value: 'defective', label: t('returns.defectiveChoice') },
                              ]}
                              onChange={(condition) => update(line.id, { condition })}
                            />
                          )}
                        </>
                      )}
                      {problem && (
                        <Text className="flow-hint-warning" role="alert">
                          {problem}
                        </Text>
                      )}
                    </Stack>
                  </Card>
                )
              })}
              {!desktop && <Card>{calculation}</Card>}
              <ExtraSection
                id="return-extras"
                opened={extrasOpen}
                onToggle={() => setExtrasOpen(!extrasOpen)}
              >
                <DateTimePicker
                  label={t('returns.date')}
                  valueFormat={i18n.language === 'zh' ? 'YYYY/MM/DD HH:mm' : 'DD.MM.YYYY HH:mm'}
                  value={returnedAt}
                  minDate={nowLocalInput(new Date(sale.sold_at))}
                  maxDate={nowLocalInput()}
                  onChange={setReturnedAt}
                  error={errors.date}
                  styles={{ wrapper: { maxWidth: FIELD_WIDTH.date } }}
                />
                <Stack gap="xs">
                  <Group gap="xs" role="group" aria-label={t('returns.reasonLabel')}>
                    {QUICK_REASONS.map((key) => (
                      <Button key={key} size="sm" variant="default" onClick={() => setNote(t(key))}>
                        {t(key)}
                      </Button>
                    ))}
                  </Group>
                  <Textarea
                    label={t('receive.extras.note')}
                    autosize
                    minRows={2}
                    value={note}
                    onChange={(event) => setNote(event.currentTarget.value)}
                    error={errors.note}
                  />
                </Stack>
              </ExtraSection>
            </Stack>
          </fieldset>
        </Stack>
        <TotalsPanel
          belowSummary={desktop ? calculation : undefined}
          summary={
            <Stat size="display" label={t('returns.total')} value={formatAmount(total)} unit="₸" />
          }
          actionLabel={t('returns.save')}
          actionColor="blue"
          onAction={submit}
          blockedReason={
            debtReadError
              ? t('common.retry')
              : !retrying && (total <= 0 || invalid)
                ? t('returns.select')
                : null
          }
          loading={post.isPending || refreshing}
          onCancel={() => navigate(`/sales/${sale.id}`)}
        />
      </div>
    </PageContainer>
  )
}

function CustomerReturn({ sale }: { sale: Sale }) {
  const customer = useCustomer(sale.customer!.id)
  if (customer.isPending) return <PageLoader />
  if (customer.isError && !customer.data)
    return (
      <PageContainer>
        <QueryError error={customer.error} onRetry={() => customer.refetch()} />
      </PageContainer>
    )
  return (
    <ReturnForm
      sale={sale}
      initialDebt={customer.data.debt}
      reloadDebt={async () => {
        const result = await customer.refetch()
        if (result.error || !result.data) throw result.error
        return result.data.debt
      }}
    />
  )
}

function ReturnLoader({ id }: { id: number }) {
  const { t } = useTranslation()
  const sale = useSale(id)
  if (sale.isPending) return <PageLoader />
  if (sale.isError)
    return (
      <PageContainer>
        <PageHeader
          back={{ to: `/sales/${id}`, label: t('returns.backSale') }}
          title={t('returns.createTitle')}
        />
        <QueryError error={sale.error} onRetry={() => sale.refetch()} />
      </PageContainer>
    )
  if (
    sale.data.status !== 'posted' ||
    !sale.data.lines.some((line) => line.returned_qty < line.qty)
  )
    return (
      <PageContainer>
        <PageHeader
          back={{ to: `/sales/${id}`, label: t('returns.backSale') }}
          title={t('returns.createTitle')}
        />
        <Text>{t('returns.unavailable')}</Text>
      </PageContainer>
    )
  return sale.data.customer ? (
    <CustomerReturn sale={sale.data} />
  ) : (
    <ReturnForm sale={sale.data} initialDebt={0} reloadDebt={async () => 0} />
  )
}

export function ReturnCreatePage() {
  useEffect(() => {
    void ReturnPage.preload().catch(console.error)
  }, [])
  const { t } = useTranslation()
  const id = parseId(useParams().id)
  return id === null ? (
    <PageContainer>
      <PageHeader
        back={{ to: '/sales', label: t('sales.card.back') }}
        title={t('sales.notFound')}
      />
    </PageContainer>
  ) : (
    <ReturnLoader key={id} id={id} />
  )
}
