import { isRequestConflict } from '../../components/flow/documentResultState'
import { Alert, Button, Group, Stack, Text, Textarea } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { DateTimePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { hasErrorCode, type ApiError, isApiError, isServerOrNetworkError } from '../../api/errors'
import { useMe } from '../../auth/useMe'
import { RequestConflictAlert, UnknownResult } from '../../components/flow/DocumentResult'
import {
  readReturnDraft,
  returnDraftKey,
  writeReturnDraft,
  type ReturnSelection,
} from './returnDraft'
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

type Selection = ReturnSelection
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
  storageKey,
  onClear,
}: {
  sale: Sale
  initialDebt: number
  storageKey: string
  onClear: () => void
  reloadDebt: () => Promise<number>
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const desktop = useMediaQuery('(min-width: 48em)')
  const post = usePostReturn()
  const [restored] = useState(() => readReturnDraft(storageKey, sale.id))
  const [requestId] = useState(() => restored?.requestId ?? crypto.randomUUID())
  const [openedAt] = useState(() => (restored ? new Date(restored.openedAt) : new Date()))
  const [selected, setSelected] = useState<Record<number, Selection>>(() =>
    Object.fromEntries(
      sale.lines.map((line) => [
        line.id,
        restored?.selected[line.id] ?? { qty: 0, condition: 'good' },
      ]),
    ),
  )
  const [debt, setDebt] = useState(initialDebt)
  const [serverSplit, setServerSplit] = useState<Split | null>(null)
  const [changed, setChanged] = useState({ credit: false, refund: false })
  const [method, setMethod] = useState<PaymentMethod>(restored?.method ?? 'cash')
  const [returnedAt, setReturnedAt] = useState<string | null>(() =>
    restored ? restored.returnedAt : nowLocalInput(openedAt),
  )
  const [note, setNote] = useState(restored?.note ?? '')
  const [extrasOpen, setExtrasOpen] = useState(restored?.extrasOpen ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(restored?.unknown ?? false)
  const [checking, setChecking] = useState(false)
  const [conflict, setConflict] = useState<ApiError | null>(null)
  const [edited, setEdited] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [debtReadError, setDebtReadError] = useState<unknown>(null)
  const [lastBody, setLastBody] = useState<ReturnCreate | null>(restored?.lastBody ?? null)
  const snapshot = {
    requestId,
    openedAt: openedAt.toISOString(),
    selected,
    method,
    returnedAt,
    note,
    extrasOpen,
    unknown: retrying,
    lastBody: lastBody,
  }
  useEffect(() => {
    writeReturnDraft(storageKey, {
      requestId,
      openedAt: openedAt.toISOString(),
      selected,
      method,
      returnedAt,
      note,
      extrasOpen,
      unknown: retrying,
      lastBody: lastBody,
    })
  }, [
    storageKey,
    requestId,
    openedAt,
    selected,
    method,
    returnedAt,
    note,
    extrasOpen,
    retrying,
    lastBody,
  ])
  const exactRetry = retrying && !edited && lastBody !== null

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
    setEdited(true)
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
    if (!exactRetry && dateError) {
      setErrors({ date: dateError })
      setExtrasOpen(true)
      return
    }
    if (!exactRetry && (total <= 0 || invalid)) return
    setMessage(null)
    const lines = sale.lines.filter((line) => Number(selected[line.id]?.qty) > 0)
    const body: ReturnCreate =
      exactRetry && lastBody
        ? lastBody
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
    setLastBody(body)
    setEdited(false)
    setChecking(retrying)
    setRetrying(true)
    setConflict(null)
    writeReturnDraft(storageKey, { ...snapshot, unknown: true, lastBody: body })
    post.mutate(body, {
      onSuccess: (saved) => {
        writeReturnDraft(storageKey, null)
        notifications.show({ color: 'green', message: t('returns.saved') })
        navigate(`/returns/${saved.id}`)
      },
      onError: async (error) => {
        setRetrying(isServerOrNetworkError(error))
        if (isServerOrNetworkError(error)) return
        if (isRequestConflict(error)) {
          setConflict(error)
          return
        }
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
    <fieldset disabled={post.isPending} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
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
            onChange={(value) => {
              setEdited(true)
              setMethod(value)
            }}
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
          {conflict && <RequestConflictAlert error={conflict} onClear={onClear} />}
          {retrying && (!post.isPending || checking) && (
            <UnknownResult
              onRetry={submit}
              busy={post.isPending}
              disabled={!exactRetry && (total <= 0 || invalid)}
            />
          )}
          <fieldset
            disabled={post.isPending}
            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
          >
            <Stack gap="md">
              <Group>
                <Button
                  variant="default"
                  onClick={() => {
                    setEdited(true)
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
                const available = Math.max(
                  line.qty - line.returned_qty,
                  retrying
                    ? (lastBody?.lines.find((saved) => saved.sale_line_id === line.id)?.qty ?? 0)
                    : 0,
                )
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
                  onChange={(value) => {
                    setEdited(true)
                    setReturnedAt(value)
                  }}
                  error={errors.date}
                  styles={{ wrapper: { maxWidth: FIELD_WIDTH.date } }}
                />
                <Stack gap="xs">
                  <Group gap="xs" role="group" aria-label={t('returns.reasonLabel')}>
                    {QUICK_REASONS.map((key) => (
                      <Button
                        key={key}
                        size="sm"
                        variant="default"
                        onClick={() => {
                          setEdited(true)
                          setNote(t(key))
                        }}
                      >
                        {t(key)}
                      </Button>
                    ))}
                  </Group>
                  <Textarea
                    label={t('receive.extras.note')}
                    autosize
                    minRows={2}
                    value={note}
                    onChange={(event) => {
                      setEdited(true)
                      setNote(event.currentTarget.value)
                    }}
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
          hideAction={retrying && (!post.isPending || checking)}
          actionColor="blue"
          onAction={submit}
          blockedReason={
            debtReadError
              ? t('common.retry')
              : !exactRetry && (total <= 0 || invalid)
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

function CustomerReturn({
  sale,
  storageKey,
  onClear,
}: {
  sale: Sale
  storageKey: string
  onClear: () => void
}) {
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
      storageKey={storageKey}
      onClear={onClear}
      initialDebt={customer.data.debt}
      reloadDebt={async () => {
        const result = await customer.refetch()
        if (result.error || !result.data) throw result.error
        return result.data.debt
      }}
    />
  )
}

function ReturnLoader({ id, userId }: { id: number; userId: number }) {
  const { t } = useTranslation()
  const sale = useSale(id)
  const [revision, setRevision] = useState(0)
  const storageKey = returnDraftKey(userId, id)
  const restoredUnknown = readReturnDraft(storageKey, id)?.unknown === true
  const onClear = () => {
    writeReturnDraft(storageKey, null)
    setRevision((value) => value + 1)
  }
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
    !restoredUnknown &&
    (sale.data.status !== 'posted' || !sale.data.lines.some((line) => line.returned_qty < line.qty))
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
    <CustomerReturn key={revision} sale={sale.data} storageKey={storageKey} onClear={onClear} />
  ) : (
    <ReturnForm
      key={revision}
      sale={sale.data}
      storageKey={storageKey}
      onClear={onClear}
      initialDebt={0}
      reloadDebt={async () => 0}
    />
  )
}

export function ReturnCreatePage() {
  useEffect(() => {
    void ReturnPage.preload().catch(console.error)
  }, [])
  const { t } = useTranslation()
  const id = parseId(useParams().id)
  const me = useMe()
  if (!me.data) return <PageLoader />
  return id === null ? (
    <PageContainer>
      <PageHeader
        back={{ to: '/sales', label: t('sales.card.back') }}
        title={t('sales.notFound')}
      />
    </PageContainer>
  ) : (
    <ReturnLoader key={id} id={id} userId={me.data.id} />
  )
}
