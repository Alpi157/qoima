import { Group, Stack, Text, Tooltip, VisuallyHidden } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { WIDE_SCREEN } from '../../lib/breakpoints'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { Card, SectionTitle } from '../../components/ui'
import { formatDate } from '../../lib/dates'
import { formatMoney, formatRoundedMoney } from '../../lib/money'
import type { ReportDay } from './api'
import './ReportChart.css'

/** Amounts remain integer tiyn; only the visual proportions use division. */
export function ReportChart({ days }: { days: ReportDay[] }) {
  const { t } = useTranslation()
  const maximum = Math.max(1, ...days.map((day) => Math.max(day.revenue, day.profit)))
  const minimum = Math.min(0, ...days.map((day) => day.profit))
  const span = maximum - minimum
  const below = (-minimum / span) * 100
  const wide = useMediaQuery(WIDE_SCREEN)
  const stride = Math.ceil(days.length / (wide ? 4 : 2))
  return (
    <Card>
      <Stack gap="md">
        <SectionTitle>{t('report.days')}</SectionTitle>
        <Group gap="lg">
          <Text size="sm">
            <span className="report-legend-revenue" />
            {t('report.revenue')}
          </Text>
          <Text size="sm">
            <span className="report-legend-profit" />
            {t('report.profit')}
          </Text>
        </Group>
        <div
          className="report-chart"
          data-testid="report-chart"
          data-negative={minimum < 0}
          style={{ '--report-zero': String(below / 100) } as CSSProperties}
        >
          {days.map((day, index) => {
            const date = formatDate(day.date)
            return (
              <div key={day.date} className="report-day">
                <Tooltip
                  multiline
                  w={240}
                  withArrow
                  events={{ hover: true, focus: true, touch: true }}
                  label={
                    <Stack gap="xs">
                      <Text size="sm">{date}</Text>
                      <Text size="sm">
                        {t('report.revenue')}: {formatMoney(day.revenue)}
                      </Text>
                      <Text size="sm">
                        {t('report.profit')}: {formatRoundedMoney(day.profit)}
                      </Text>
                    </Stack>
                  }
                >
                  <div
                    tabIndex={0}
                    className="report-column"
                    aria-label={`${date}. ${t('report.revenue')}: ${formatMoney(day.revenue)}. ${t('report.profit')}: ${formatRoundedMoney(day.profit)}`}
                  >
                    <div
                      className="report-revenue"
                      style={{ height: `${(day.revenue / span) * 100}%`, bottom: `${below}%` }}
                    />
                    <div
                      className={day.profit < 0 ? 'report-loss' : 'report-profit'}
                      style={{
                        height: `${(Math.abs(day.profit) / span) * 100}%`,
                        bottom: `${day.profit < 0 ? below + (day.profit / span) * 100 : below}%`,
                      }}
                    />
                  </div>
                </Tooltip>
                <Text size="sm" className="report-date">
                  {index % stride === 0 ? date : '\u00a0'}
                </Text>
              </div>
            )
          })}
        </div>
        <VisuallyHidden>
          <table>
            <caption>{t('report.days')}</caption>
            <thead>
              <tr>
                <th>{t('report.date')}</th>
                <th>{t('report.revenue')}</th>
                <th>{t('report.profit')}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td>{formatDate(day.date)}</td>
                  <td>{formatMoney(day.revenue)}</td>
                  <td>{formatRoundedMoney(day.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </VisuallyHidden>
      </Stack>
    </Card>
  )
}
