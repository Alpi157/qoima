import { Anchor, Group, Stack, Text } from '@mantine/core'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Card, SectionTitle } from '../../components/ui'
import { formatRoundedMoney } from '../../lib/money'
import type { ReportSummary } from './api'

export function ProfitSteps({ data, from, to }: { data: ReportSummary; from: string; to: string }) {
  const { t } = useTranslation()
  if (
    ![data.revenue, data.write_off_value, data.surplus_value, data.operating_total].some(
      (value) => value !== 0,
    )
  )
    return null
  const row = (label: ReactNode, amount: number, strong = false) => (
    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
      <Text fw={strong ? 700 : undefined} style={{ minWidth: 0 }}>
        {label}
      </Text>
      <Text
        fw={strong ? 700 : undefined}
        c={strong && amount < 0 ? 'red' : undefined}
        style={{ flexShrink: 0 }}
        data-testid={strong ? 'profit-after-expenses' : undefined}
      >
        {strong && amount < 0 && amount > -50
          ? `-${formatRoundedMoney(amount)}`
          : formatRoundedMoney(amount)}
      </Text>
    </Group>
  )
  return (
    <Card>
      <Stack gap="md" data-testid="profit-steps">
        <SectionTitle>{t('profit.title')}</SectionTitle>
        {row(t('report.revenue'), data.revenue)}
        {row(t('profit.cost'), -data.cost)}
        {row(t('profit.purchase'), data.profit)}
        {data.defect_loss > 0 && (
          <Text c="dimmed" size="sm">
            {t('profit.defect', { amount: formatRoundedMoney(data.defect_loss) })}
          </Text>
        )}
        {data.write_off_value > 0 && row(t('profit.writeOff'), -data.write_off_value)}
        {data.surplus_value > 0 && row(t('profit.surplus'), data.surplus_value)}
        {data.expenses_total > 0 && (
          <Stack gap="xs">
            {row(t('expenses.title'), -data.expenses_total)}
            <Anchor component={Link} to={`/expenses?${new URLSearchParams({ from, to })}`}>
              {t('report.showAdjustments')}
            </Anchor>
            {data.expenses_by_category.map((item) => (
              <div key={item.category}>
                {row(
                  <Text span c="dimmed" size="sm">
                    {t(`expenses.categories.${item.category}`)}
                  </Text>,
                  -item.amount,
                )}
              </div>
            ))}
          </Stack>
        )}
        {data.card_commission > 0 &&
          row(
            t('profit.commission', { percent: data.card_commission_percent }),
            -data.card_commission,
          )}
        {data.tax_estimate > 0 &&
          row(t('profit.tax', { percent: data.tax_percent }), -data.tax_estimate)}
        {row(t('profit.after'), data.profit_after_expenses, true)}
        {data.rate_effect !== 0 && (
          <Text>
            {t(data.rate_effect > 0 ? 'profit.rateMore' : 'profit.rateLess', {
              amount: formatRoundedMoney(Math.abs(data.rate_effect)),
            })}
          </Text>
        )}
        {data.buy_today_unknown_count > 0 && (
          <Text c="dimmed" size="sm">
            {t('profit.unknown', { count: data.buy_today_unknown_count })}
          </Text>
        )}
        {data.card_commission_percent === '0' && data.tax_percent === '0' && data.revenue > 0 && (
          <Text c="dimmed" size="sm">
            <Trans
              i18nKey="profit.noRates"
              components={{ settings: <Anchor component={Link} to="/settings" /> }}
            />
          </Text>
        )}
      </Stack>
    </Card>
  )
}
