import i18n from 'i18next'
import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_STATUSES,
  MOVEMENT_KINDS,
  movementKindLabel,
  receiptStatusLabel,
  saleStatusLabel,
  UNITS,
  unitLabel,
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

describe('unitLabel', () => {
  it('keeps the stored unit in Russian', () => {
    for (const unit of UNITS) expect(unitLabel(unit)).toBe(unit)
  })

  it.each([
    ['kk', 'дана'],
    ['zh', '件'],
  ])('shows "шт" in %s as %s', async (language, label) => {
    await i18n.changeLanguage(language)
    expect(unitLabel('шт')).toBe(label)
  })

  it('translates every unit', async () => {
    for (const language of ['kk', 'zh']) {
      await i18n.changeLanguage(language)
      for (const unit of UNITS.filter((unit) => !['л', 'кг', 'м'].includes(unit))) {
        expect(unitLabel(unit)).not.toBe(unit)
      }
    }
  })

  it('shows an unknown unit as is', async () => {
    await i18n.changeLanguage('zh')
    expect(unitLabel('рулон')).toBe('рулон')
  })
})
