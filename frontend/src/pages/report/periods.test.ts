import { describe, expect, it } from 'vitest'
import { isCalendarDate, periodDays, quickRange } from '../../lib/dates'
describe('Almaty report calendar boundaries', () => {
  it('starts a week on Monday, including on Sunday', () => {
    expect(quickRange('week', new Date('2026-09-27T10:00:00Z'))).toEqual([
      '2026-09-21',
      '2026-09-27',
    ])
    expect(quickRange('week', new Date('2026-09-27T20:00:00Z'))).toEqual([
      '2026-09-28',
      '2026-09-28',
    ])
  })
  it('takes the previous month across a year and in a leap year', () => {
    expect(quickRange('previousMonth', new Date('2026-12-31T20:00:00Z'))).toEqual([
      '2026-12-01',
      '2026-12-31',
    ])
    expect(quickRange('previousMonth', new Date('2024-03-01T10:00:00Z'))).toEqual([
      '2024-02-01',
      '2024-02-29',
    ])
  })
  it('counts both days and rejects nonexistent dates', () => {
    expect(periodDays('2024-01-01', '2024-12-31')).toBe(366)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2024-02-29')).toBe(true)
  })
})
