import { Button, Collapse, Loader, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useTranslation } from 'react-i18next'
import { QueryError } from '../../components/QueryError'
import { RateCaptions } from '../../components/RateCaptions'
import { formatRoundedMoney } from '../../lib/money'
import { useStockBuyToday } from './api'

export function StockBuyToday() {
  const { t, i18n } = useTranslation()
  const query = useStockBuyToday()
  const [opened, details] = useDisclosure()
  if (query.isPending) return <Loader />
  if (query.isError) return <QueryError error={query.error} onRetry={() => query.refetch()} />
  const data = query.data
  const total = data.total
  const signed = (value: number) => `${value > 0 ? '+' : ''}${formatRoundedMoney(value)}`
  return (
    <Stack gap="xs" mt="md" data-testid="stock-buy-today">
      <Text fw={600}>
        {t('buyToday.stock')}:{' '}
        {data.groups.length || data.without_basis_count === 0
          ? formatRoundedMoney(total.buy_today_value)
          : '—'}
      </Text>
      {data.groups.length > 0 && (
        <Text c={total.difference > 0 ? 'var(--q-color-warning-text)' : undefined}>
          {total.difference_percent == null
            ? t('buyToday.differenceNoPercent', { diff: signed(total.difference) })
            : t('buyToday.difference', {
                diff: signed(total.difference),
                percent:
                  i18n.language === 'zh'
                    ? total.difference_percent
                    : total.difference_percent.replace('.', ','),
              })}
        </Text>
      )}
      {data.without_basis_count > 0 && (
        <Text size="sm" c="dimmed">
          {t('buyToday.withoutBasis', { count: data.without_basis_count })}
        </Text>
      )}
      <Button
        variant="subtle"
        size="sm"
        style={{ alignSelf: 'flex-start' }}
        aria-expanded={opened}
        onClick={details.toggle}
      >
        {t('receive.expenses.more')}
      </Button>
      <Collapse expanded={opened}>
        <Stack gap="sm">
          {data.groups.map((group) => (
            <Text key={group.currency}>
              {t('buyToday.group', {
                currency: t(`buyToday.currency.${group.currency}`),
                cost: formatRoundedMoney(group.cost_value),
                today: formatRoundedMoney(group.buy_today_value),
              })}
            </Text>
          ))}
          {data.without_basis_count > 0 && (
            <Text size="sm" c="dimmed">
              {t('buyToday.coverage', {
                cost: formatRoundedMoney(total.cost_value),
                excluded: formatRoundedMoney(data.without_basis_cost_value),
              })}
            </Text>
          )}
          <RateCaptions rates={data.rates} />
        </Stack>
      </Collapse>
    </Stack>
  )
}
