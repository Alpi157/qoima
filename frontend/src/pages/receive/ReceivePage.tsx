import { isRequestConflict } from '../../components/flow/documentResultState'
import {
  Alert,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { DateTimePicker } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { type ApiError, hasErrorCode, isApiError, isServerOrNetworkError } from '../../api/errors'
import { useMe } from '../../auth/useMe'
import {
  CancelFlowModal,
  DraftNotice,
  LineCard,
  ProductSearch,
  QtyStepper,
  TotalsPanel,
  useDraft,
  useLineProducts,
} from '../../components/flow'
import { PlusIcon } from '../../components/icons'
import { ExtraSection } from '../../components/ExtraSection'
import { MoneyInput } from '../../components/MoneyInput'
import { PageLoader } from '../../components/PageLoader'
import { PageContainer, PageHeader } from '../../components/ui'
import { RequestConflictAlert, UnknownResult } from '../../components/flow/DocumentResult'
import { LineLoadNotice, UnloadedLine } from '../../components/flow/LineLoadNotice'
import { apiErrorText, fieldErrorText } from '../../i18n/errorText'
import { nowLocalInput, todayLocal } from '../../lib/dates'
import {
  CURRENCY_SYMBOL,
  convertMinor,
  displayRate,
  formatCurrency,
  halfUp,
  parseRate,
} from '../../lib/currency'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { unitLabel } from '../../lib/labels'
import { formatMoney, parseMoney } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import { ReceiveDonePage } from '../lazyPages'
import { type Product, useRememberProduct } from '../products/api'
import {
  fetchReceiptDefaults,
  fetchReceiptPreview,
  type ReceiptWarning,
  usePostReceipt,
} from '../receipts/api'
import { CurrencyFields } from './CurrencyFields'
import { ReceiptExpenses } from './ReceiptExpenses'
import { ReceiptWarnings } from './ReceiptWarnings'
import { ReceiveStepReview } from './ReceiveStepReview'
import { NewProductForm } from './NewProductForm'
import {
  addReceiptLine,
  createReceiptDraft,
  isReceiptDraftEmpty,
  parseReceiptDraft,
  type ReceiptDraft,
  type ReceiptDraftLine,
  receiptBody,
  receiptLineWarning,
  emptyRate,
  previewBody,
  purchasePrice,
} from './receiptDraft'

function ReceiveFlow({ userId }: { userId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const rememberProduct = useRememberProduct()
  const post = usePostReceipt()
  const [searchParams, setSearchParams] = useSearchParams()

  const draft = useDraft({
    userId,
    flow: 'receipt',
    create: createReceiptDraft,
    parse: parseReceiptDraft,
    isEmpty: isReceiptDraftEmpty,
  })
  const { value, update: updateDraft, clear: clearSaved } = draft
  const [query, setQuery] = useState('')
  // The article of a product being created from the search, or null.
  const [newArticle, setNewArticle] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [saveError, setSaveError] = useState<ReactNode>(null)
  const [rateMismatch, setRateMismatch] = useState(false)
  const [checking, setChecking] = useState(false)
  const [conflict, setConflict] = useState<ApiError | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [costsSubmitted, setCostsSubmitted] = useState(false)
  const [focusCostId, setFocusCostId] = useState<number | null>(null)
  const costInputs = useRef(new Map<number, HTMLInputElement>())
  const [serverWarnings, setServerWarnings] = useState<ReceiptWarning[]>([])
  const [expenseValidity, setExpenseValidity] = useState<Record<string, boolean>>({})
  const expenseValid = useCallback(
    (id: string, valid: boolean) =>
      setExpenseValidity((current) =>
        current[id] === valid ? current : { ...current, [id]: valid },
      ),
    [],
  )
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null)
  const reviewRequired = value.currency !== 'KZT' || value.expenses.length > 0
  const review = reviewRequired && value.lines.length > 0 && searchParams.get('step') === 'review'
  useEffect(() => {
    if (searchParams.get('step') === 'review' && (!reviewRequired || value.lines.length === 0))
      setSearchParams({}, { replace: true })
  }, [searchParams, reviewRequired, value.lines.length, setSearchParams])
  const latest = useRef(value)
  const update = useCallback(
    (fn: (current: ReceiptDraft) => ReceiptDraft, dismiss = true) =>
      updateDraft((current) => {
        const next = fn(current)
        latest.current = next
        return next
      }, dismiss),
    [updateDraft],
  )
  useEffect(() => {
    latest.current = value
  })
  const supplierSeen = useRef<string | null>(draft.restored ? value.supplier : null)
  const clear = () => {
    clearSaved()
    setRateMismatch(false)
    setServerWarnings([])
    supplierSeen.current = null
    setExpenseValidity({})
  }

  useEffect(() => {
    if (focusCostId === null) return
    const input = costInputs.current.get(focusCostId)
    if (input) {
      input.focus()
      input.scrollIntoView?.({ block: 'center' })
      setFocusCostId(null)
    }
  }, [focusCostId, review])

  const change = useCallback(
    (changes: Partial<ReceiptDraft> | ((current: ReceiptDraft) => Partial<ReceiptDraft>)) => {
      update((current) => ({
        ...current,
        ...(typeof changes === 'function' ? changes(current) : changes),
        editedSinceSubmit: true,
      }))
      setSaveError(null)
      setServerWarnings([])
    },
    [update],
  )
  const changeLines = useCallback(
    (fn: (lines: ReceiptDraftLine[]) => ReceiptDraftLine[]) => {
      update((current) => {
        const lines = fn(current.lines)
        return {
          ...current,
          lines,
          editedSinceSubmit: true,
          expenses: current.expenses.map((expense) => ({
            ...expense,
            productIds: expense.productIds.filter((id) =>
              lines.some((line) => line.productId === id),
            ),
            manual: Object.fromEntries(
              lines.map((line) => [
                line.productId,
                expense.manual[line.productId] ?? (expense.method === 'manual' ? '0' : ''),
              ]),
            ),
          })),
        }
      })
      setSaveError(null)
      setServerWarnings([])
    },
    [update],
  )
  const changeLine = (productId: number, changes: Partial<ReceiptDraftLine>) =>
    changeLines((lines) =>
      lines.map((line) => (line.productId === productId ? { ...line, ...changes } : line)),
    )
  const dropMissing = useCallback(
    (ids: number[], products: Map<number, Product>) => {
      if (value.unknown) return
      setRemoved((previous) => [
        ...new Set([
          ...previous,
          ...value.lines
            .filter((line) => ids.includes(line.productId))
            .map(
              (line) =>
                line.article ?? products.get(line.productId)?.article ?? t('common.notFoundShort'),
            ),
        ]),
      ])
      changeLines((lines) => lines.filter((line) => !ids.includes(line.productId)))
    },
    [changeLines, value.lines, value.unknown, t],
  )
  const {
    views,
    products,
    unresolved,
    incomplete,
    isPending: loadingLines,
    hasLoadError,
    reload,
  } = useLineProducts(value.lines, dropMissing)
  useEffect(() => {
    if (
      value.lines.some((line) => {
        const product = products.get(line.productId)
        return product && (line.article !== product.article || line.name !== product.name)
      })
    )
      update(
        (current) => ({
          ...current,
          lines: current.lines.map((line) => {
            const product = products.get(line.productId)
            return product ? { ...line, article: product.article, name: product.name } : line
          }),
        }),
        false,
      )
  }, [products, value.lines, update])

  const addProduct = (product: Product) => {
    rememberProduct(product)
    changeLines((lines) =>
      addReceiptLine(
        lines,
        product.id,
        purchasePrice(product, value.currency),
        {
          article: product.article,
          name: product.name,
        },
        value.currency,
      ),
    )
    setNewArticle(null)
  }

  useEffect(() => {
    if (value.unknown || value.currencyChosen || supplierSeen.current === value.supplier) return
    supplierSeen.current = value.supplier
    let active = true
    void fetchReceiptDefaults(value.supplier)
      .then((result) => {
        const current = latest.current
        if (
          !active ||
          current.unknown ||
          current.currencyChosen ||
          current.supplier !== value.supplier ||
          current.currency === result.currency
        )
          return
        change({ currency: result.currency, rate: emptyRate() })
      })
      .catch(() => {
        /* Keep the existing currency; manual selection remains available. */
      })
    return () => {
      active = false
    }
  }, [value.requestId, value.supplier, value.currencyChosen, value.unknown, change])

  useEffect(() => {
    if (!focusTarget || review) return
    const element = document.getElementById(focusTarget.id)
    if (element) {
      element.scrollIntoView?.({ block: 'center' })
      element.querySelector('input')?.focus({ preventScroll: true })
    }
  }, [focusTarget, review])

  let body: ReturnType<typeof receiptBody> | null = null
  try {
    body = receiptBody(value)
  } catch {
    /* Fields explain incomplete input. */
  }
  const exactRetry =
    value.unknown === true &&
    value.lastBody !== undefined &&
    (!value.editedSinceSubmit ||
      (body !== null &&
        JSON.stringify({ ...body, confirmed_warnings: [] }) ===
          JSON.stringify({ ...value.lastBody, confirmed_warnings: [] })))
  const previewInput = body ? previewBody(value) : null
  useEffect(() => {
    if (review && previewInput === null && !exactRetry) setSearchParams({}, { replace: true })
  }, [review, previewInput, exactRetry, setSearchParams])
  const refreshMismatchedRate = (error: ApiError) => {
    const currency = error.params.currency
    update((current) => ({
      ...current,
      rate:
        current.rate.source === 'nbk' && current.currency === currency ? emptyRate() : current.rate,
      expenses: current.expenses.map((expense) => ({
        ...expense,
        rate:
          expense.rate.source === 'nbk' && expense.currency === currency
            ? emptyRate()
            : expense.rate,
      })),
    }))
    setRateMismatch(true)
    setSearchParams({})
  }
  const preview = useQuery({
    queryKey: ['receipt-preview', previewInput],
    queryFn: async () => {
      try {
        return await fetchReceiptPreview(previewInput!)
      } catch (error) {
        if (hasErrorCode(error, 'nbk_rate_mismatch') && isApiError(error)) {
          let currentInput: ReturnType<typeof previewBody> | null = null
          try {
            currentInput = previewBody(latest.current)
          } catch {
            /* Incomplete edits supersede the old preview. */
          }
          if (JSON.stringify(currentInput) === JSON.stringify(previewInput))
            refreshMismatchedRate(error)
        }
        throw error
      }
    },
    enabled: review && previewInput !== null && !exactRetry,
    retry: false,
    meta: { handlesError: true },
  })
  const shownWarnings = review ? (preview.data?.warnings ?? serverWarnings) : serverWarnings
  const fixWarning = (warning: ReceiptWarning) => {
    if (warning.code === 'rate_deviation') {
      const expense =
        warning.params.target === 'expense' ? value.expenses[warning.params.index ?? -1] : null
      if (expense) {
        change({ expensesOpen: true })
        setFocusTarget({ id: `expense-rate-${expense.id}` })
      } else setFocusTarget({ id: 'receipt-currency' })
    } else setFocusCostId(warning.params.product_id)
    setSearchParams({})
  }
  const warningsBlock = (
    <ReceiptWarnings warnings={shownWarnings} expenses={value.expenses} onFix={fixWarning} />
  )

  const warnings = views.map(({ line }) => receiptLineWarning(line))
  const kinds = value.lines.length
  const pieces = value.lines.reduce(
    (sum, line) => sum + (qtyError(line.qty) === null ? (line.qty as number) : 0),
    0,
  )
  const purchaseTotal = value.lines.reduce(
    (sum, line) =>
      sum +
      (qtyError(line.qty) === null
        ? BigInt(line.qty as number) * BigInt(parseMoney(line.cost) ?? 0)
        : 0n),
    0n,
  )
  const invalidExpenseReason = value.expenses
    .map((expense) =>
      (parseMoney(expense.amount) ?? 0) <= 0
        ? t('receive.expenses.required')
        : expense.currency !== 'KZT' &&
            (!parseRate(expense.rate.value) ||
              (expense.rate.source === 'nbk' && !expense.rate.date))
          ? t('validation.rate_required')
          : (expense.method === 'selected' && expense.productIds.length === 0) ||
              (expense.method === 'manual' && expenseValidity[expense.id] !== true)
            ? t('validation.expense_targets_required')
            : null,
    )
    .find(Boolean)
  const blockedReason = incomplete
    ? t('flow.blocked.loading')
    : value.lines.length === 0
      ? t('flow.blocked.empty')
      : value.currency !== 'KZT' &&
          (!parseRate(value.rate.value) || (value.rate.source === 'nbk' && !value.rate.date))
        ? t('validation.rate_required')
        : (invalidExpenseReason ?? (warnings.some(Boolean) ? t('flow.blocked.fix') : null))

  const cancel = () => {
    clear()
    setConflict(null)
    setRemoved([])
    setConfirmCancel(false)
    navigate('/')
  }

  const submit = () => {
    if (post.isPending || (!exactRetry && blockedReason)) return
    setCostsSubmitted(true)
    const missing = value.lines.find((line) => parseMoney(line.cost) === null)
    if (missing && !exactRetry) {
      setFocusCostId(missing.productId)
      return
    }
    setSaveError(null)
    setConflict(null)
    setChecking(value.unknown === true)
    const submitted = exactRetry
      ? value.lastBody!
      : { ...receiptBody(value), confirmed_warnings: shownWarnings.map((warning) => warning.key) }
    update((current) => ({
      ...current,
      unknown: true,
      lastBody: submitted,
      editedSinceSubmit: false,
    }))
    post.mutate(submitted, {
      onSuccess: (receipt) => {
        clear()
        navigate(`/receive/done/${receipt.id}`)
      },
      onError: (error) => {
        update((current) => ({ ...current, unknown: isServerOrNetworkError(error) }))
        if (isServerOrNetworkError(error)) return
        if (hasErrorCode(error, 'receipt_warnings') && isApiError(error)) {
          setServerWarnings(
            Array.isArray(error.params.warnings) ? (error.params.warnings as ReceiptWarning[]) : [],
          )
          if (review) void preview.refetch()
          else setFocusTarget({ id: 'receipt-warnings-block' })
          return
        }
        if (hasErrorCode(error, 'nbk_rate_mismatch') && isApiError(error)) {
          refreshMismatchedRate(error)
          return
        }
        if (isRequestConflict(error)) {
          setConflict(error)
          return
        }
        setSaveError(
          <Alert color="red" role="alert">
            {isApiError(error) && Object.keys(error.fieldErrors).length > 0 ? (
              <Stack gap="xs">
                {Object.entries(error.fieldErrors).map(([field, detail]) => (
                  <Text key={field}>{fieldErrorText(detail, field, t)}</Text>
                ))}
              </Stack>
            ) : (
              apiErrorText(error, t)
            )}
          </Alert>,
        )
      },
    })
  }

  const next = () => {
    if (post.isPending || blockedReason) return
    setCostsSubmitted(true)
    const missing = value.lines.find((line) => parseMoney(line.cost) === null)
    if (missing) {
      setFocusCostId(missing.productId)
      return
    }
    setRateMismatch(false)
    setSearchParams({ step: 'review' })
  }

  return (
    <PageContainer>
      {!review && <PageHeader title={t('receive.title')} />}
      {draft.restored && (
        <DraftNotice
          text={t('receive.draftRestored')}
          onClear={() => {
            clear()
            setConflict(null)
            setRemoved([])
          }}
          onClose={draft.dismissRestored}
        />
      )}
      {review ? (
        <>
          {preview.isFetching && <Loader />}
          <ReceiveStepReview
            preview={
              preview.isFetching || preview.isError || exactRetry ? null : (preview.data ?? null)
            }
            draft={value}
            onBack={() => setSearchParams({})}
            onSave={submit}
            busy={post.isPending}
            unknown={value.unknown === true}
            warnings={warningsBlock}
            error={
              <>
                {saveError}
                {preview.isError && (
                  <Alert color="red">
                    <Text>{apiErrorText(preview.error, t)}</Text>
                    <Button variant="default" onClick={() => void preview.refetch()}>
                      {t('receive.review.reload')}
                    </Button>
                  </Alert>
                )}
                {conflict && (
                  <RequestConflictAlert
                    error={conflict}
                    onClear={() => {
                      clear()
                      setConflict(null)
                      setSearchParams({})
                    }}
                  />
                )}
                {value.unknown && (!post.isPending || checking) && (
                  <UnknownResult
                    onRetry={submit}
                    busy={post.isPending}
                    disabled={!exactRetry && Boolean(blockedReason)}
                  />
                )}
              </>
            }
          />
        </>
      ) : (
        <div className="flow-layout">
          <Stack gap="lg">
            <ProductSearch
              query={query}
              onQueryChange={(text) => {
                setQuery(text)
                if (newArticle !== null && text.trim() !== '') setNewArticle(null)
              }}
              onAdd={addProduct}
              label={t('flow.search')}
              placeholder={t('receive.placeholder')}
              details={(product) => (
                <Text>
                  {t('receive.inStock', { stock: product.stock, unit: unitLabel(product.unit) })}
                </Text>
              )}
              notFound={(text) => (
                <Stack className="flow-empty" gap="md" align="flex-start" role="status">
                  <Text>{t('receive.notFound', { query: text })}</Text>
                  <Button
                    leftSection={<PlusIcon size={20} />}
                    onClick={() => {
                      setNewArticle(text)
                      setQuery('')
                    }}
                  >
                    {t('receive.addNew')}
                  </Button>
                </Stack>
              )}
            />

            {newArticle !== null && (
              <NewProductForm
                initialArticle={newArticle}
                onSaved={addProduct}
                onCancel={() => setNewArticle(null)}
              />
            )}

            {rateMismatch && (
              <Alert color="orange" role="alert">
                {t('errors.nbk_rate_mismatch')}
              </Alert>
            )}
            <CurrencyFields
              currency={value.currency}
              rate={value.rate}
              date={value.receivedAt?.slice(0, 10) ?? todayLocal()}
              unknown={value.unknown === true}
              id="receipt-currency"
              onCurrency={(currency) =>
                change({
                  currency,
                  currencyChosen: true,
                  rate: currency === value.currency ? value.rate : emptyRate(),
                })
              }
              onRate={(rate) => change({ rate })}
            />
            <Title order={2}>{t('receive.lines')}</Title>
            <LineLoadNotice error={hasLoadError} reload={reload} removed={removed} />
            {conflict && (
              <RequestConflictAlert
                error={conflict}
                onClear={() => {
                  clear()
                  setConflict(null)
                  setRemoved([])
                }}
              />
            )}
            {value.unknown && (!post.isPending || checking) && (
              <UnknownResult
                onRetry={submit}
                busy={post.isPending}
                disabled={!exactRetry && Boolean(blockedReason)}
              />
            )}
            {loadingLines && <Loader />}
            {unresolved.map((line) => (
              <UnloadedLine key={line.productId} article={line.article} name={line.name}>
                <Text>
                  {t('flow.qty')}: {line.qty}
                </Text>
                <Text>
                  {t('receive.cost')}: {line.cost || '—'}
                </Text>
              </UnloadedLine>
            ))}
            {!loadingLines && value.lines.length === 0 && (
              <div className="flow-empty">{t('flow.empty')}</div>
            )}
            {views.map(({ line, product }, index) => {
              const unit = unitLabel(product.unit)
              const cost = parseMoney(line.cost)
              const expensive =
                value.currency === 'KZT' && cost !== null && cost >= product.sale_price
              const qty = qtyError(line.qty) === null ? (line.qty as number) : 0
              return (
                <LineCard
                  key={product.id}
                  article={product.article}
                  name={product.name}
                  onRemove={() =>
                    changeLines((lines) => lines.filter((item) => item.productId !== product.id))
                  }
                  warning={warnings[index]}
                  sum={
                    <Group justify="flex-end" align="baseline" gap="sm">
                      <Text c="dimmed">{t('sell.sum')}</Text>
                      <Text fz="var(--q-fz-h2)" lh="var(--q-lh-h2)" fw={700}>
                        {cost === null || qtyError(line.qty) !== null
                          ? '—'
                          : formatCurrency(BigInt(qty) * BigInt(cost), value.currency)}
                      </Text>
                    </Group>
                  }
                  hint={
                    <Text c="dimmed">
                      {t('receive.after', {
                        stock: product.stock,
                        after: product.stock + qty,
                        unit,
                      })}
                    </Text>
                  }
                >
                  <Stack gap="xs">
                    <Text fw={600}>{t('flow.qty')}</Text>
                    <QtyStepper
                      value={line.qty}
                      onChange={(next) => changeLine(product.id, { qty: next })}
                      label={t('flow.qtyOf', { article: product.article })}
                      unit={unit}
                    />
                  </Stack>
                  <Stack gap="xs" miw={0}>
                    <MoneyInput
                      label={
                        value.currency === 'KZT'
                          ? t('receive.cost')
                          : t('receive.fx.price', { symbol: CURRENCY_SYMBOL[value.currency] })
                      }
                      required
                      showHint={false}
                      aria-label={t('receive.extras.costOf', { article: product.article })}
                      ref={(input) => {
                        if (input) costInputs.current.set(product.id, input)
                        else costInputs.current.delete(product.id)
                      }}
                      error={
                        costsSubmitted && line.cost.trim() === ''
                          ? t('receive.warn.costRequired')
                          : undefined
                      }
                      value={line.cost}
                      onChange={(cost) =>
                        changeLine(product.id, { cost, priceCurrency: value.currency })
                      }
                      w={FIELD_WIDTH.date}
                      styles={{ wrapper: { maxWidth: FIELD_WIDTH.price } }}
                    />
                    {line.priceCurrency !== value.currency && (
                      <Text c="var(--q-color-warning-text)">{t('receive.fx.otherCurrency')}</Text>
                    )}
                    {value.currency !== 'KZT' &&
                      cost !== null &&
                      convertMinor(cost, value.rate.value) !== null && (
                        <Text c="dimmed">
                          {formatCurrency(cost, value.currency)} × {displayRate(value.rate.value)} ={' '}
                          {formatMoney(halfUp(convertMinor(cost, value.rate.value)!, 100n) * 100n)}
                        </Text>
                      )}
                    <Text
                      size="sm"
                      c={expensive ? 'var(--q-color-warning-text)' : 'dimmed'}
                      maw={FIELD_WIDTH.date}
                    >
                      {t('receive.salePrice', { amount: formatMoney(product.sale_price) })}
                    </Text>
                    {expensive && (
                      <Text size="sm" c="var(--q-color-warning-text)">
                        {t('receive.costWarning')}
                      </Text>
                    )}
                  </Stack>
                </LineCard>
              )
            })}

            <ReceiptExpenses draft={value} onChange={change} onValidity={expenseValid} />
            <ExtraSection
              id="receive-extras"
              opened={value.extrasOpen}
              onToggle={() => change({ extrasOpen: !value.extrasOpen })}
            >
              <Stack gap="xs">
                <TextInput
                  label={t('receive.extras.supplier')}
                  value={value.supplier}
                  onChange={(event) => change({ supplier: event.currentTarget.value })}
                />
                <Group>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => change({ supplier: t('receive.extras.initialStock') })}
                  >
                    {t('receive.extras.initialStock')}
                  </Button>
                </Group>
              </Stack>
              <DateTimePicker
                label={t('receive.extras.date')}
                description={t('receive.extras.dateHint')}
                valueFormat="DD.MM.YYYY HH:mm"
                value={value.receivedAt}
                maxDate={nowLocalInput()}
                onChange={(receivedAt) => change({ receivedAt })}
                clearable
                styles={{ wrapper: { maxWidth: FIELD_WIDTH.date } }}
              />
              <Textarea
                label={t('receive.extras.note')}
                autosize
                minRows={2}
                value={value.note}
                onChange={(event) => change({ note: event.currentTarget.value })}
              />
            </ExtraSection>
          </Stack>

          <TotalsPanel
            beforeAction={shownWarnings.length ? warningsBlock : undefined}
            actionLabel={
              reviewRequired
                ? t('receive.review.next')
                : shownWarnings.length
                  ? t('receive.warnings.confirm')
                  : t('receive.submit')
            }
            actionColor="blue"
            onAction={reviewRequired ? next : submit}
            blockedReason={blockedReason}
            loading={post.isPending}
            error={saveError}
            hideAction={value.unknown === true && (!post.isPending || checking)}
            onCancel={() => (value.lines.length > 0 ? setConfirmCancel(true) : cancel())}
            summary={
              <Stack gap="xs">
                <Text>
                  <Trans i18nKey="flow.pieces" values={{ qty: pieces }} components={{ b: <b /> }} />
                </Text>
                <Text data-testid="receipt-total">
                  {t('sell.sum')}: <b>{formatCurrency(purchaseTotal, value.currency)}</b>
                </Text>
              </Stack>
            }
          >
            <Text>
              <Trans i18nKey="flow.kinds" values={{ kinds }} components={{ b: <b /> }} />
            </Text>
          </TotalsPanel>
        </div>
      )}

      <CancelFlowModal
        opened={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={cancel}
        text={t('receive.cancelText')}
      />
    </PageContainer>
  )
}

/** /receive: goods came in (docs/design/simple-ui.md, «Приём товара»). */
export function ReceivePage() {
  useEffect(() => {
    void ReceiveDonePage.preload().catch(console.error)
  }, [])
  const { data: me } = useMe()
  if (!me) return <PageLoader />
  return <ReceiveFlow userId={me.id} />
}
