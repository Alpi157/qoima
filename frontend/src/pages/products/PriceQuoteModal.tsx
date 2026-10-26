import { Alert, Button, Group, Stack } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, unwrap, withDocumentTimeout } from '../../api/client'
import { useInvalidateBuyToday } from '../../api/invalidate'
import type { components } from '../../api/schema'
import { DocumentModal } from '../../components/flow/DocumentModal'
import { UnknownResult } from '../../components/flow/DocumentResult'
import { useDocumentModalStatus } from '../../components/flow/documentModalState'
import { useDocumentResult } from '../../components/flow/documentResultState'
import { MoneyInput } from '../../components/MoneyInput'
import { apiErrorText } from '../../i18n/errorText'
import { CURRENCY_SYMBOL, type Currency } from '../../lib/currency'
import { todayLocal } from '../../lib/dates'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { parseMoney } from '../../lib/money'
import { CurrencyChoice } from '../receive/CurrencyFields'

type QuoteCreate = components['schemas']['PriceQuoteCreate']

function PriceQuoteForm({ productId, onDone }: { productId: number; onDone: () => void }) {
  const { t, i18n } = useTranslation()
  const invalidate = useInvalidateBuyToday()
  const [requestId] = useState(() => crypto.randomUUID())
  const [currency, setCurrency] = useState<Currency>('KZT')
  const [price, setPrice] = useState('')
  const [date, setDate] = useState<string | null>(todayLocal)
  const [error, setError] = useState<string | null>(null)
  const submitted = useRef<QuoteCreate | null>(null)
  const result = useDocumentResult()
  const post = useMutation({
    meta: { handlesError: true },
    mutationFn: (body: QuoteCreate) =>
      withDocumentTimeout((signal) =>
        unwrap(
          api.POST('/api/products/{product_id}/price-quotes', {
            params: { path: { product_id: productId } },
            body,
            signal,
          }),
        ),
      ),
    onSuccess: () => {
      invalidate()
      onDone()
    },
    onError: (error: unknown) => {
      if (!result.acceptError(error)) setError(apiErrorText(error, t))
    },
  })
  const modal = useDocumentModalStatus(result.unknown, post.isPending)
  const submit = () => {
    if (post.isPending || result.conflict) return
    if (result.unknown && submitted.current) {
      post.mutate(submitted.current)
      return
    }
    const amount = parseMoney(price)
    if (amount === null || amount <= 0 || amount > 100_000_000_000) {
      setError(t('buyToday.priceRequired'))
      return
    }
    if (!date || date > todayLocal()) {
      setError(t('validation.date_in_future'))
      return
    }
    setError(null)
    submitted.current = { request_id: requestId, currency, price_minor: amount, quoted_on: date }
    post.mutate(submitted.current)
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      noValidate
    >
      <Stack gap="lg">
        <fieldset
          disabled={result.unknown || post.isPending || Boolean(result.conflict)}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <Stack gap="lg">
            <CurrencyChoice value={currency} onChange={setCurrency} />
            <MoneyInput
              data-autofocus
              label={t('buyToday.priceField', { symbol: CURRENCY_SYMBOL[currency] })}
              required
              showHint={false}
              value={price}
              onChange={setPrice}
              maw="100%"
              w={FIELD_WIDTH.price}
            />
            <DatePickerInput
              label={t('buyToday.dateField')}
              valueFormat={i18n.language === 'zh' ? 'YYYY/MM/DD' : 'DD.MM.YYYY'}
              required
              value={date}
              maxDate={todayLocal()}
              onChange={setDate}
              maw="100%"
              w={FIELD_WIDTH.date}
            />
          </Stack>
        </fieldset>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {result.unknown && <UnknownResult onRetry={submit} busy={post.isPending} />}
        {result.conflict && (
          <Alert color="orange" role="alert" data-testid="request-conflict">
            <Stack>
              <span>{apiErrorText(result.conflict, t)}</span>
              <Button variant="default" onClick={() => modal?.clear()}>
                {t('flow.draft.clear')}
              </Button>
            </Stack>
          </Alert>
        )}
        <Group justify="flex-end" className="q-modal-actions">
          <Button variant="default" onClick={() => modal?.close()} disabled={post.isPending}>
            {t('common.cancel')}
          </Button>
          {!result.unknown && !result.conflict && (
            <Button type="submit" loading={post.isPending}>
              {t('common.save')}
            </Button>
          )}
        </Group>
      </Stack>
    </form>
  )
}

export function PriceQuoteModal({
  productId,
  opened,
  onClose,
}: {
  productId: number
  opened: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const invalidate = useInvalidateBuyToday()
  return (
    <DocumentModal
      opened={opened}
      onClose={onClose}
      title={t('buyToday.newQuote')}
      invalidate={invalidate}
    >
      {opened && <PriceQuoteForm productId={productId} onDone={onClose} />}
    </DocumentModal>
  )
}
