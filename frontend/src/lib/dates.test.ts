import i18n from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  dateParam,
  formatDate,
  formatDateTime,
  localInputToIso,
  nowLocalInput,
  quickRange,
  todayLocal,
} from './dates'

// Asia/Almaty is UTC+5 (since March 2024, same as Astana).

describe('formatDateTime', () => {
  it('formats in Asia/Almaty', () => {
    expect(formatDateTime('2026-09-27T09:30:00Z')).toBe('27.09.2026 14:30')
  })

  it('local midnight in Almaty is still the same local day', () => {
    expect(formatDateTime('2026-09-26T19:00:00Z')).toBe('27.09.2026 00:00')
  })

  it('UTC midnight is 05:00 in Almaty', () => {
    expect(formatDateTime('2026-09-27T00:00:00Z')).toBe('27.09.2026 05:00')
  })

  it('accepts a Date and an offset string', () => {
    expect(formatDateTime(new Date('2026-09-27T09:30:00Z'))).toBe('27.09.2026 14:30')
    expect(formatDateTime('2026-09-27T14:30:00+05:00')).toBe('27.09.2026 14:30')
  })
})

describe('formatDate', () => {
  it('switches to the next day at 19:00 UTC', () => {
    expect(formatDate('2026-09-27T18:59:00Z')).toBe('27.09.2026')
    expect(formatDate('2026-09-27T19:00:00Z')).toBe('28.09.2026')
  })

  it('UTC midnight belongs to the same Almaty day', () => {
    expect(formatDate('2026-09-27T00:00:00Z')).toBe('27.09.2026')
  })

  it('follows the language format', () => {
    expect(formatDate('2026-09-27T09:30:00Z', 'kk')).toBe('27.09.2026')
    expect(formatDate('2026-09-27T09:30:00Z', 'zh')).toBe('2026/09/27')
    expect(formatDateTime('2026-09-27T09:30:00Z', 'zh')).toBe('2026/09/27 14:30')
  })

  it('uses the current interface language by default', async () => {
    await i18n.changeLanguage('zh')
    expect(formatDate('2026-09-27T09:30:00Z')).toBe('2026/09/27')
  })
})

describe('todayLocal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses Almaty time, not the browser clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T20:00:00Z'))
    expect(todayLocal()).toBe('2026-09-28')
  })

  it('is still the previous day just before Almaty midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T18:59:59Z'))
    expect(todayLocal()).toBe('2026-09-27')
  })

  it('accepts an explicit moment', () => {
    expect(todayLocal(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01')
  })
})

describe('nowLocalInput', () => {
  it('is Almaty wall time in the date picker format', () => {
    expect(nowLocalInput(new Date('2026-09-27T20:15:42Z'))).toBe('2026-09-28 01:15:00')
  })
})

describe('localInputToIso', () => {
  it('reads the value as Almaty time', () => {
    expect(localInputToIso('2026-09-27 14:30:00')).toBe('2026-09-27T09:30:00.000Z')
    expect(localInputToIso('2026-09-28 00:00')).toBe('2026-09-27T19:00:00.000Z')
  })

  it('keeps seconds', () => {
    expect(localInputToIso('2026-09-27 14:30:15')).toBe('2026-09-27T09:30:15.000Z')
  })

  it('round-trips with nowLocalInput', () => {
    const now = new Date('2026-09-27T09:30:00Z')
    expect(localInputToIso(nowLocalInput(now))).toBe(now.toISOString())
  })

  it('rejects garbage', () => {
    expect(localInputToIso('')).toBeNull()
    expect(localInputToIso('27.09.2026')).toBeNull()
  })
})

describe('dateParam', () => {
  it('keeps a well-formed date and drops anything else', () => {
    expect(dateParam('2026-09-27')).toBe('2026-09-27')
    expect(dateParam('27.09.2026')).toBe('')
    expect(dateParam(null)).toBe('')
  })
})

describe('quickRange', () => {
  // Sunday 27.09.2026 00:30 in Almaty, while UTC is still Saturday.
  const sundayNight = new Date('2026-09-26T19:30:00Z')

  it('today is the Almaty date, not the UTC one', () => {
    expect(quickRange('today', sundayNight)).toEqual(['2026-09-27', '2026-09-27'])
  })

  it('week starts on Monday', () => {
    expect(quickRange('week', sundayNight)).toEqual(['2026-09-21', '2026-09-27'])
    // Monday itself: a one-day week.
    expect(quickRange('week', new Date('2026-09-28T04:00:00Z'))).toEqual([
      '2026-09-28',
      '2026-09-28',
    ])
  })

  it('month starts on the 1st, across the UTC month boundary', () => {
    expect(quickRange('month', sundayNight)).toEqual(['2026-09-01', '2026-09-27'])
    // 1 October 01:00 in Almaty is still 30 September in UTC.
    expect(quickRange('month', new Date('2026-09-30T20:00:00Z'))).toEqual([
      '2026-10-01',
      '2026-10-01',
    ])
  })
})
