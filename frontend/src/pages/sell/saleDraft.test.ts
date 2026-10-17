import { describe, expect, it } from 'vitest'

import { lineDiscount, parseSaleDraft } from './saleDraft'
import { makeProduct } from '../../test/fixtures'

describe('sale draft payment compatibility', () => {
  it('reads the existing version without payment as full and preserves the request id', () => {
    const draft = parseSaleDraft({ version: 1, requestId: 'existing', lines: [], customer: 'none' })
    expect(draft?.version).toBe(1)
    expect(draft?.requestId).toBe('existing')
    expect(draft?.payment).toEqual({ mode: 'full', paid: '', method: 'cash' })
  })

  it('restores debt text with a customer but resets debt without a customer', () => {
    const raw = {
      version: 1,
      requestId: 'existing',
      lines: [],
      customer: { id: 7, name: 'Ержан' },
      payment: { mode: 'debt', paid: '12,50', method: 'cash' },
    }
    expect(parseSaleDraft(raw)?.payment).toEqual(raw.payment)
    expect(parseSaleDraft({ ...raw, customer: 'none' })?.payment.mode).toBe('full')
  })
})

it('keeps a very large draft discount exact before the server rejects its amount', () => {
  expect(
    lineDiscount(
      { productId: 1, qty: 100000, price: '0' },
      makeProduct({ sale_price: 100_000_000_000 }),
    ),
  ).toEqual({ amount: 10_000_000_000_000_000n, percent: 100 })
})

it('does not invent discounts for a zero list price or invalid input', () => {
  const line = { productId: 1, qty: 1, price: '0' }
  expect(lineDiscount(line, makeProduct({ sale_price: 0 }))).toBeNull()
  expect(lineDiscount({ ...line, price: '' }, makeProduct())).toBeNull()
  expect(lineDiscount({ ...line, qty: '' }, makeProduct())).toBeNull()
})
