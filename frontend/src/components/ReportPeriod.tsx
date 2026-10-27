import { Button, Group, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from './ui'
import { PeriodInput } from './PeriodInput'
import { formatDate, quickRange } from '../lib/dates'

const PERIODS = [
  { value: 'today', label: 'report.today' },
  { value: 'week', label: 'report.week' },
  { value: 'month', label: 'report.month' },
  { value: 'previousMonth', label: 'report.previousMonth' },
] as const

export function ReportPeriod({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  const { t } = useTranslation()
  const [custom, setCustom] = useState(false)
  const preset = PERIODS.find(({ value }) => {
    const range = quickRange(value)
    return range[0] === from && range[1] === to
  })?.value
  return (
    <Card>
      <Stack gap="md">
        <Group gap="xs" role="group" aria-label={t('common.period.label')}>
          {PERIODS.map(({ value, label }) => (
            <Button
              key={value}
              variant={!custom && preset === value ? 'light' : 'default'}
              aria-pressed={!custom && preset === value}
              onClick={() => {
                setCustom(false)
                onChange(...quickRange(value))
              }}
            >
              {t(label)}
            </Button>
          ))}
          <Button
            variant={custom || !preset ? 'light' : 'default'}
            aria-pressed={custom || !preset}
            onClick={() => setCustom(true)}
          >
            {t('report.custom')}
          </Button>
        </Group>
        {custom || !preset ? (
          <PeriodInput
            from={from}
            to={to}
            onChange={(start, end) =>
              onChange(...(start && end ? ([start, end] as [string, string]) : quickRange('month')))
            }
          />
        ) : (
          <Text c="dimmed">
            {formatDate(from)} · {formatDate(to)}
          </Text>
        )}
      </Stack>
    </Card>
  )
}
