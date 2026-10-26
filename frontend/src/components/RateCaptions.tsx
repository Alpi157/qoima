import { Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { components } from '../api/schema'
import { displayRate } from '../lib/currency'
import { formatDate, todayLocal } from '../lib/dates'

export function RateCaptions({ rates }: { rates: components['schemas']['TodayRateOut'][] }) {
  const { t } = useTranslation()
  return (
    <Stack gap="xs">
      {rates.map((rate) => (
        <Text key={rate.currency} size="sm" c="dimmed">
          {t(`buyToday.currency.${rate.currency}`)}:{' '}
          {rate.rate !== null && rate.rate_date !== null ? (
            <>
              {displayRate(rate.rate)} ₸ ·{' '}
              {rate.exact
                ? t('receive.fx.exact', { date: formatDate(rate.rate_date) })
                : t('receive.fx.fallback', {
                    date: formatDate(todayLocal()),
                    rateDate: formatDate(rate.rate_date),
                  })}
            </>
          ) : (
            t('buyToday.noRate')
          )}
        </Text>
      ))}
    </Stack>
  )
}
