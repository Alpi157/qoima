import { Button, Group } from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { useState } from 'react'

import { quickRange, type QuickRange } from '../lib/dates'

type DateRange = [string | null, string | null]

const QUICK_RANGES: { range: QuickRange; label: string }[] = [
  { range: 'today', label: 'Сегодня' },
  { range: 'week', label: 'Неделя' },
  { range: 'month', label: 'Месяц' },
]

export interface PeriodInputProps {
  /** "2026-09-27" in Asia/Almaty, or '' for no bound. */
  from: string
  to: string
  /** Receives both ends at once; null removes a bound. */
  onChange: (from: string | null, to: string | null) => void
  /** Buttons "Сегодня", "Неделя", "Месяц" next to the picker. */
  withQuickRanges?: boolean
}

/** Date range filter; the first click of a range picks only its start and changes nothing yet. */
export function PeriodInput({ from, to, onChange, withQuickRanges }: PeriodInputProps) {
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
        label="Период"
        placeholder="Все даты"
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
            {label}
          </Button>
        ))}
    </Group>
  )
}
