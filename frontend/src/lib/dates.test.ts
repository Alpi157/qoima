import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatDate, formatDateTime, todayLocal } from './dates'

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
