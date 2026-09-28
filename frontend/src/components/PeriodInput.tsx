import { Button, Group } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { quickRange, type QuickRange } from '../lib/dates'

type DateRange = [string | null, string | null]

const QUICK_RANGES = [
  { range: 'today', label: 'common.period.today' },
  { range: 'week', label: 'common.period.week' },
  { range: 'month', label: 'common.period.month' },
] as const satisfies readonly { range: QuickRange; label: string }[]

export interface PeriodInputProps {
  /** "2026-09-27" in Asia/Almaty, or '' for no bound. */
  from: string
  to: string
  /** Receives both ends at once; null removes a bound. */
  onChange: (from: string | null, to: string | null) => void
  /** Buttons "today", "week", "month" next to the picker. */
  withQuickRanges?: boolean
}

/** Date range filter; the first click of a range picks only its start and changes nothing yet. */
export function PeriodInput({ from, to, onChange, withQuickRanges }: PeriodInputProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<DateRange | null>(null)
  const value: DateRange = draft ?? [from || null, to || null]

  const change = (next: DateRange) => {
    if (next[0] && !next[1]) {
      setDraft(next)
      return
    }
    setDraft(null)
    onChange(next[0], next[1])
  }

  return (
    <Group align="flex-end" gap="xs">
      <DatePickerInput
        type="range"
        label={t('common.period.label')}
        placeholder={t('common.period.all')}
        valueFormat="DD.MM.YYYY"
        allowSingleDateInRange
        clearable
        value={value}
        onChange={change}
        miw={260}
      />
      {withQuickRanges &&
        QUICK_RANGES.map(({ range, label }) => (
          <Button key={range} variant="default" onClick={() => change(quickRange(range))}>
            {t(label)}
          </Button>
        ))}
    </Group>
  )
}
