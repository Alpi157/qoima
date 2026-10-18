import { Button, Group, Loader, Stack, Text, TextInput } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CURRENCIES, type Currency, parseRate } from '../../lib/currency'
import { formatDate } from '../../lib/dates'
import { FIELD_WIDTH } from '../../lib/fieldWidths'
import { fetchRate } from '../receipts/api'
import { type DraftRate, emptyRate } from './receiptDraft'

export function CurrencyChoice({
  value,
  onChange,
}: {
  value: Currency
  onChange: (value: Currency) => void
}) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs">
      <Text fw={600}>{t('receive.fx.title')}</Text>
      <Group gap="xs" role="group" aria-label={t('receive.fx.title')}>
        {CURRENCIES.map((currency) => (
          <Button
            key={currency}
            px="sm"
            variant={value === currency ? 'light' : 'default'}
            aria-pressed={value === currency}
            onClick={() => onChange(currency)}
          >
            {t(`receive.fx.${currency}`)}
          </Button>
        ))}
      </Group>
    </Stack>
  )
}

/** A decimal text field; background responses never overwrite manual input. */
export function CurrencyFields({
  currency,
  rate,
  date,
  unknown,
  onCurrency,
  onRate,
  id,
}: {
  currency: Currency
  rate: DraftRate
  date: string
  unknown: boolean
  onCurrency: (currency: Currency) => void
  onRate: (rate: DraftRate) => void
  id: string
}) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const ticket = useRef(0)
  const latest = useRef({ currency, date, rate, unknown, onRate })
  useEffect(() => {
    latest.current = { currency, date, rate, unknown, onRate }
  })
  const previous = useRef({ currency, date })
  const attempted = useRef<string | null>(null)
  const load = useCallback(async () => {
    const start = latest.current
    if (start.currency === 'KZT') return
    const current = ++ticket.current
    attempted.current = `${start.currency}:${start.date}`
    setLoading(true)
    setFailed(false)
    start.onRate({ ...emptyRate(), requestedDate: start.date })
    try {
      const result = await fetchRate(start.currency, start.date)
      const now = latest.current
      if (
        ticket.current !== current ||
        now.currency !== start.currency ||
        now.date !== start.date ||
        (now.unknown && !start.unknown)
      )
        return
      now.onRate({
        value: result.rate,
        source: 'nbk',
        date: result.rate_date,
        requestedDate: result.requested_date,
        exact: result.exact,
        edited: false,
      })
    } catch {
      if (ticket.current === current) setFailed(true)
    } finally {
      if (ticket.current === current) setLoading(false)
    }
  }, [])
  const cancelLoad = useCallback(() => {
    ticket.current++
  }, [])
  useEffect(() => {
    const changed = previous.current.currency !== currency || previous.current.date !== date
    previous.current = { currency, date }
    if (
      currency !== 'KZT' &&
      rate.source === 'nbk' &&
      (changed ||
        (!unknown &&
          !rate.value &&
          (attempted.current !== `${currency}:${date}` || rate.requestedDate === null)))
    )
      void load()
  }, [currency, date, unknown, rate.source, rate.value, rate.requestedDate, load])
  useEffect(() => cancelLoad, [cancelLoad])
  return (
    <Group gap="lg" align="flex-start" id={id} style={{ scrollMarginTop: 96 }}>
      <CurrencyChoice
        value={currency}
        onChange={(next) => {
          if (next === currency) {
            onCurrency(next)
            return
          }
          ticket.current++
          setFailed(false)
          setLoading(false)
          onCurrency(next)
        }}
      />
      {currency !== 'KZT' && (
        <Stack gap="xs" miw={0} style={{ flex: '1 1 240px' }}>
          <TextInput
            label={t('receive.fx.rate')}
            value={rate.value}
            inputMode="decimal"
            autoComplete="off"
            w={FIELD_WIDTH.date}
            maw="100%"
            rightSection={loading ? <Loader size="sm" /> : null}
            onChange={(event) => {
              ticket.current++
              setLoading(false)
              setFailed(false)
              onRate({
                ...rate,
                value: event.currentTarget.value,
                source: 'manual',
                date: null,
                edited: true,
              })
            }}
            error={
              rate.source === 'manual' && !rate.value
                ? t('validation.rate_required')
                : rate.value && !parseRate(rate.value)
                  ? t('validation.rate_format')
                  : undefined
            }
          />
          {rate.source === 'manual' ? (
            <>
              <Text c="dimmed">{t('receive.fx.manual')}</Text>
              <Button
                variant="subtle"
                onClick={() => void load()}
                style={{ whiteSpace: 'normal', height: 'auto', minHeight: 56 }}
              >
                {t('receive.fx.restore')}
              </Button>
            </>
          ) : rate.date ? (
            <Text c="dimmed">
              {rate.exact
                ? t('receive.fx.exact', { date: formatDate(rate.date) })
                : t('receive.fx.fallback', {
                    date: formatDate(rate.requestedDate ?? date),
                    rateDate: formatDate(rate.date),
                  })}
            </Text>
          ) : (
            !loading && <Text c="var(--q-color-warning-text)">{t('receive.fx.unavailable')}</Text>
          )}
          {failed && rate.source === 'manual' && <Text>{t('receive.fx.unavailable')}</Text>}
        </Stack>
      )}
    </Group>
  )
}
