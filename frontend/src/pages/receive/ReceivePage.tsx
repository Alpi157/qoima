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
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { type ApiError, isServerOrNetworkError } from '../../api/errors'
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
import { apiErrorText } from '../../i18n/errorText'
import { nowLocalInput } from '../../lib/dates'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { unitLabel } from '../../lib/labels'
import { formatMoney, parseMoney } from '../../lib/money'
import { qtyError } from '../../lib/validation'
import { ReceiveDonePage } from '../lazyPages'
import { type Product, useRememberProduct } from '../products/api'
import { usePostReceipt } from '../receipts/api'
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
} from './receiptDraft'

function ReceiveFlow({ userId }: { userId: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const rememberProduct = useRememberProduct()
  const post = usePostReceipt()

  const draft = useDraft({
    userId,
    flow: 'receipt',
    create: createReceiptDraft,
    parse: parseReceiptDraft,
    isEmpty: isReceiptDraftEmpty,
  })
  const { value, update, clear } = draft
  const [query, setQuery] = useState('')
  // The article of a product being created from the search, or null.
  const [newArticle, setNewArticle] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [saveError, setSaveError] = useState<ReactNode>(null)
  const [checking, setChecking] = useState(false)
  const [conflict, setConflict] = useState<ApiError | null>(null)
  const [removed, setRemoved] = useState<string[]>([])
  const [costsSubmitted, setCostsSubmitted] = useState(false)
  const [focusCostId, setFocusCostId] = useState<number | null>(null)
  const costInputs = useRef(new Map<number, HTMLInputElement>())

  useEffect(() => {
    if (focusCostId === null) return
    const input = costInputs.current.get(focusCostId)
    if (input) {
      input.focus()
      input.scrollIntoView?.({ block: 'center' })
      setFocusCostId(null)
    }
  }, [focusCostId])

  const change = useCallback(
    (changes: Partial<ReceiptDraft>) => {
      update((current) => ({ ...current, ...changes }))
      setSaveError(null)
    },
    [update],
  )
  const changeLines = useCallback(
    (fn: (lines: ReceiptDraftLine[]) => ReceiptDraftLine[]) => {
      update((current) => ({ ...current, lines: fn(current.lines) }))
      setSaveError(null)
    },
    [update],
  )
  const changeLine = (productId: number, changes: Partial<ReceiptDraftLine>) =>
    changeLines((lines) =>
      lines.map((line) => (line.productId === productId ? { ...line, ...changes } : line)),
    )
  const dropMissing = useCallback(
    (ids: number[], products: Map<number, Product>) => {
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
    [changeLines, value.lines, t],
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
      addReceiptLine(lines, product.id, product.last_cost, {
        article: product.article,
        name: product.name,
      }),
    )
    setNewArticle(null)
  }

  const warnings = views.map(({ line }) => receiptLineWarning(line))
  const kinds = value.lines.length
  const pieces = value.lines.reduce(
    (sum, line) => sum + (qtyError(line.qty) === null ? (line.qty as number) : 0),
    0,
  )
  const purchaseTotal = value.lines.reduce(
    (sum, line) =>
      sum + (qtyError(line.qty) === null ? (line.qty as number) * (parseMoney(line.cost) ?? 0) : 0),
    0,
  )
  const blockedReason = incomplete
    ? t('flow.blocked.loading')
    : value.lines.length === 0
      ? t('flow.blocked.empty')
      : warnings.some(Boolean)
        ? t('flow.blocked.fix')
        : null

  const cancel = () => {
    clear()
    setConflict(null)
    setRemoved([])
    setConfirmCancel(false)
    navigate('/')
  }

  const submit = () => {
    if (post.isPending || blockedReason) return
    setCostsSubmitted(true)
    const missing = value.lines.find((line) => parseMoney(line.cost) === null)
    if (missing) {
      setFocusCostId(missing.productId)
      return
    }
    setSaveError(null)
    setConflict(null)
    setChecking(value.unknown === true)
    update((current) => ({ ...current, unknown: true }))
    post.mutate(receiptBody(value), {
      onSuccess: (receipt) => {
        clear()
        navigate(`/receive/done/${receipt.id}`)
      },
      onError: (error) => {
        update((current) => ({ ...current, unknown: isServerOrNetworkError(error) }))
        if (isServerOrNetworkError(error)) return
        if (isRequestConflict(error)) {
          setConflict(error)
          return
        }
        setSaveError(
          <Alert color="red" role="alert">
            {apiErrorText(error, t)}
          </Alert>,
        )
      },
    })
  }

  return (
    <PageContainer>
      <PageHeader title={t('receive.title')} />
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
              disabled={Boolean(blockedReason)}
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
            const expensive = cost !== null && cost >= product.sale_price
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
                      {cost === null || qtyError(line.qty) !== null ? '—' : formatMoney(qty * cost)}
                    </Text>
                  </Group>
                }
                hint={
                  <Text c="dimmed">
                    {t('receive.after', { stock: product.stock, after: product.stock + qty, unit })}
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
                    label={t('receive.cost')}
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
                    onChange={(cost) => changeLine(product.id, { cost })}
                    w={FIELD_WIDTH.date}
                    styles={{ wrapper: { maxWidth: FIELD_WIDTH.price } }}
                  />
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
          actionLabel={t('receive.submit')}
          actionColor="blue"
          onAction={submit}
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
                {t('sell.sum')}: <b>{formatMoney(purchaseTotal)}</b>
              </Text>
            </Stack>
          }
        >
          <Text>
            <Trans i18nKey="flow.kinds" values={{ kinds }} components={{ b: <b /> }} />
          </Text>
        </TotalsPanel>
      </div>

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
