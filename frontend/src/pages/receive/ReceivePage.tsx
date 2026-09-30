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
import { type ReactNode, useCallback, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

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
import { ChevronRightIcon, PlusIcon } from '../../components/icons'
import { MoneyInput } from '../../components/MoneyInput'
import { PageLoader } from '../../components/PageLoader'
import { Card, PageContainer, PageHeader } from '../../components/ui'
import { apiErrorText } from '../../i18n/errorText'
import { nowLocalInput } from '../../lib/dates'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { unitLabel } from '../../lib/labels'
import { qtyError } from '../../lib/validation'
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
    (ids: number[]) =>
      changeLines((lines) => lines.filter((line) => !ids.includes(line.productId))),
    [changeLines],
  )
  const { views, isPending: loadingLines } = useLineProducts(value.lines, dropMissing)

  const addProduct = (product: Product) => {
    rememberProduct(product)
    changeLines((lines) => addReceiptLine(lines, product.id))
    setNewArticle(null)
  }

  const warnings = views.map(({ line }) => receiptLineWarning(line))
  const kinds = views.length
  const pieces = views.reduce(
    (sum, { line }) => sum + (qtyError(line.qty) === null ? (line.qty as number) : 0),
    0,
  )
  const blockedReason =
    value.lines.length === 0 || loadingLines
      ? t('flow.blocked.empty')
      : warnings.some(Boolean)
        ? t('flow.blocked.fix')
        : null

  const cancel = () => {
    clear()
    setConfirmCancel(false)
    navigate('/')
  }

  const submit = () => {
    if (post.isPending || blockedReason) return
    setSaveError(null)
    post.mutate(receiptBody(value), {
      onSuccess: (receipt) => {
        clear()
        navigate(`/receive/done/${receipt.id}`)
      },
      onError: (error) =>
        setSaveError(
          <Alert color="red" role="alert">
            {apiErrorText(error, t)}
          </Alert>,
        ),
    })
  }

  return (
    <PageContainer>
      <PageHeader title={t('receive.title')} />
      {draft.restored && (
        <DraftNotice
          text={t('receive.draftRestored')}
          onClear={clear}
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
          {loadingLines && <Loader />}
          {!loadingLines && views.length === 0 && (
            <div className="flow-empty">{t('flow.empty')}</div>
          )}
          {views.map(({ line, product }, index) => {
            const unit = unitLabel(product.unit)
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
              </LineCard>
            )
          })}

          <Stack gap="md">
            <Group>
              <Button
                variant="default"
                onClick={() => change({ extrasOpen: !value.extrasOpen })}
                aria-expanded={value.extrasOpen}
                aria-controls="receive-extras"
                leftSection={
                  <span
                    style={{
                      display: 'inline-flex',
                      transform: value.extrasOpen ? 'rotate(90deg)' : undefined,
                      transition: 'transform var(--q-motion-press)',
                    }}
                  >
                    <ChevronRightIcon size={20} />
                  </span>
                }
              >
                {t('receive.extras.toggle')}
              </Button>
            </Group>
            {value.extrasOpen && (
              <Card id="receive-extras">
                <Stack gap="lg">
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
                  {views.length > 0 && (
                    <Stack gap="md">
                      <Text fw={600}>{t('receive.extras.costs')}</Text>
                      {views.map(({ line, product }) => (
                        <Group key={product.id} justify="space-between" gap="md" wrap="wrap">
                          <Stack gap={0} miw={0} style={{ flex: '1 1 200px' }}>
                            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
                              {product.article}
                            </Text>
                            <Text c="dimmed">{product.name}</Text>
                          </Stack>
                          <MoneyInput
                            showHint={false}
                            aria-label={t('receive.extras.costOf', { article: product.article })}
                            value={line.cost}
                            onChange={(cost) => changeLine(product.id, { cost })}
                            w={FIELD_WIDTH.price}
                          />
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Card>
            )}
          </Stack>
        </Stack>

        <TotalsPanel
          actionLabel={t('receive.submit')}
          actionColor="blue"
          onAction={submit}
          blockedReason={blockedReason}
          loading={post.isPending}
          error={saveError}
          onCancel={() => (value.lines.length > 0 ? setConfirmCancel(true) : cancel())}
          summary={
            <Text>
              <Trans i18nKey="flow.pieces" values={{ qty: pieces }} components={{ b: <b /> }} />
            </Text>
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
  const { data: me } = useMe()
  if (!me) return <PageLoader />
  return <ReceiveFlow userId={me.id} />
}
