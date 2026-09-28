import { describe, expect, it } from 'vitest'

import { makeProduct } from '../../test/fixtures'
import {
  exceedsStock,
  lineHasErrors,
  lineTotal,
  priceError,
  saleBody,
  type SaleLine,
  saleTotal,
} from './saleLines'

function line(overrides: Partial<SaleLine> = {}): SaleLine {
  return { key: 1, product: makeProduct({ id: 3, stock: 5 }), qty: 2, price: '12500', ...overrides }
}

const HEADER = { requestId: 'r-1', customerId: null, note: '', soldAt: null }

const PRICE_REQUIRED = 'Укажите цену'

describe('saleLines', () => {
  it('a price is required and must be an amount', () => {
    expect(priceError('')).toBe(PRICE_REQUIRED)
    expect(priceError('abc')).not.toBeNull()
    expect(priceError('0')).toBeNull()
    expect(lineHasErrors(line({ price: ' ' }))).toBe(true)
    expect(lineHasErrors(line({ qty: 0 }))).toBe(true)
    expect(lineHasErrors(line())).toBe(false)
  })

  it('compares the quantity with the stock', () => {
    expect(exceedsStock(line({ qty: 5 }))).toBe(false)
    expect(exceedsStock(line({ qty: 6 }))).toBe(true)
    expect(exceedsStock(line({ qty: '' }))).toBe(false)
  })

  it('sums lines in tiyn, skipping unfinished ones', () => {
    expect(lineTotal(line({ price: '12500,50' }))).toBe(2_500_100)
    expect(lineTotal(line({ qty: '' }))).toBeNull()
    expect(saleTotal([line(), line({ key: 2, qty: 1, price: '100' }), line({ price: '' })])).toBe(
      2_510_000,
    )
  })

  it('always sends unit_price and leaves out an untouched date', () => {
    const body = saleBody(HEADER, [line({ price: '12500' })])
    expect(body).toEqual({
      request_id: 'r-1',
      customer_id: null,
      note: null,
      lines: [{ product_id: 3, qty: 2, unit_price: 1_250_000 }],
    })
    expect('sold_at' in body).toBe(false)
  })

  it('sends a chosen customer, a note and a date', () => {
    const body = saleBody(
      { requestId: 'r-2', customerId: 7, note: ' Сдача ', soldAt: '2026-09-27T04:00:00.000Z' },
      [line()],
    )
    expect(body).toMatchObject({
      customer_id: 7,
      note: 'Сдача',
      sold_at: '2026-09-27T04:00:00.000Z',
    })
  })
})
