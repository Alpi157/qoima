import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_STATUSES,
  MOVEMENT_KINDS,
  movementKindLabel,
  receiptStatusLabel,
  saleStatusLabel,
} from './labels'

describe('movementKindLabel', () => {
  it('matches the movement kinds allowed by the database', () => {
    // Keep in sync with MOVEMENT_KINDS in backend/app/inventory/models.py.
    expect([...MOVEMENT_KINDS]).toEqual([
      'receipt',
      'receipt_cancel',
      'sale',
      'sale_cancel',
      'adjustment',
    ])
  })

  it.each(MOVEMENT_KINDS)('%s has a Russian label', (kind) => {
    const label = movementKindLabel(kind)
    expect(label).not.toBe(kind)
    expect(label).toMatch(/^[А-ЯЁ]/)
  })

  it('shows an unknown kind as is', () => {
    expect(movementKindLabel('something_new')).toBe('something_new')
  })
})

describe('status labels', () => {
  it.each([
    ['posted', 'Проведён', 'Проведена'],
    ['cancelled', 'Отменён', 'Отменена'],
  ])('%s', (status, receipt, sale) => {
    expect(receiptStatusLabel(status)).toBe(receipt)
    expect(saleStatusLabel(status)).toBe(sale)
  })

  it('covers every status', () => {
    for (const status of DOCUMENT_STATUSES) {
      expect(receiptStatusLabel(status)).not.toBe(status)
      expect(saleStatusLabel(status)).not.toBe(status)
    }
  })
})
