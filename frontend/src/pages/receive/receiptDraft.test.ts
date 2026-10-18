import { describe, expect, it } from 'vitest'
import { parseRate, convertMinor } from '../../lib/currency'
import { makeProduct } from '../../test/fixtures'
import {
  createReceiptDraft,
  emptyRate,
  parseReceiptDraft,
  purchasePrice,
  receiptBody,
  type ReceiptDraft,
} from './receiptDraft'

const lines = [{ productId: 7, qty: 3, cost: '123,45', priceCurrency: 'KZT' as const }]
const oldDraft = {
  version: 1,
  lines,
  supplier: 'Supplier',
  note: 'Note',
  receivedAt: '2026-01-01T10:00',
  extrasOpen: true,
}
describe('receipt draft keys', () => {
  it.each([1, 2])(
    'upgrades version %s without losing unfinished work, identity or unknown',
    (version) => {
      const requestId = crypto.randomUUID()
      const draft = parseReceiptDraft({ ...oldDraft, version, requestId, unknown: true })!
      expect(draft).toMatchObject({
        ...oldDraft,
        version: 3,
        requestId,
        unknown: true,
        currency: 'KZT',
        expenses: [],
      })
      expect(parseReceiptDraft(draft)).toEqual(draft)
    },
  )
  it('gives an old version 1 draft its missing key once', () => {
    const draft = parseReceiptDraft(oldDraft)!
    expect(draft.requestId).toMatch(/^[a-f0-9-]{36}$/)
    expect(parseReceiptDraft(draft)?.requestId).toBe(draft.requestId)
  })
  it('creates new identities and deterministic KZT requests with warning checking enabled', () => {
    const first = { ...createReceiptDraft(), lines }
    expect(first.requestId).not.toBe(createReceiptDraft().requestId)
    expect(receiptBody(first)).toMatchObject({
      request_id: first.requestId,
      currency: 'KZT',
      confirmed_warnings: [],
      lines: [{ product_id: 7, qty: 3, unit_price_minor: 12345 }],
    })
    expect(receiptBody(first)).toEqual(receiptBody(first))
  })
  it.each(['nbk', 'manual'] as const)(
    'serializes CNY %s without a floating point rate',
    (source) => {
      const draft: ReceiptDraft = {
        ...createReceiptDraft(),
        lines,
        currency: 'CNY',
        rate: { ...emptyRate(), value: '67,6200', source, date: '2026-10-17' },
      }
      const body = receiptBody(draft)
      expect(body).toMatchObject({ exchange_rate: '67.6200', rate_source: source })
      expect(body.rate_date).toBe(source === 'nbk' ? '2026-10-17' : undefined)
      expect(receiptBody(parseReceiptDraft(draft)!)).toEqual(body)
    },
  )
  it.each(['amount', 'quantity', 'selected', 'manual'] as const)(
    'serializes %s allocation and preserves manual tiyn',
    (method) => {
      const draft: ReceiptDraft = {
        ...createReceiptDraft(),
        lines,
        expenses: [
          {
            id: 'delivery',
            kind: 'delivery',
            amount: '100,50',
            currency: 'KZT',
            rate: emptyRate(),
            method,
            productIds: [7],
            manual: { 7: '100,50' },
            moreOpen: true,
          },
        ],
      }
      const expense = receiptBody(draft).expenses![0]
      expect(expense).toMatchObject({
        kind: 'delivery',
        amount_minor: 10050,
        allocation_method: method,
      })
      expect(expense.product_ids).toEqual(method === 'selected' ? [7] : undefined)
      expect(expense.manual).toEqual(
        method === 'manual' ? [{ product_id: 7, amount_tiyn: 10050 }] : undefined,
      )
      expect(receiptBody(parseReceiptDraft(draft)!)).toEqual(receiptBody(draft))
    },
  )
})
it.each(['67.6200', '67,6200', '0,0001'])('accepts decimal rate %s', (rate) =>
  expect(parseRate(rate)).toBe(rate.replace(',', '.')),
)
it.each(['67.62001', '0', '-1', '1e2', '', 'NaN', '123456789'])(
  'rejects malformed rate %s',
  (rate) => expect(parseRate(rate)).toBeNull(),
)
it('converts the whole reference 5 line exactly', () =>
  expect(convertMinor(3n * 3333n, '67.83')).toBe(678232n))

it.each(['nbk', 'manual'] as const)('serializes a USD expense with its own %s rate', (source) => {
  const draft: ReceiptDraft = {
    ...createReceiptDraft(),
    lines,
    expenses: [
      {
        id: 'fee',
        kind: 'bank',
        amount: '12,34',
        currency: 'USD',
        rate: { ...emptyRate(), value: '452,1200', source, date: '2026-10-17' },
        method: 'amount',
        productIds: [],
        manual: {},
        moreOpen: false,
      },
    ],
  }
  const expense = receiptBody(draft).expenses![0]
  expect(expense).toMatchObject({
    currency: 'USD',
    amount_minor: 1234,
    exchange_rate: '452.1200',
    rate_source: source,
  })
  expect(expense.rate_date).toBe(source === 'nbk' ? '2026-10-17' : undefined)
})
it('prefills purchase prices only for the same currency, including KZT', () => {
  const product = makeProduct({
    last_cost: 700000,
    last_purchase_currency: 'CNY',
    last_purchase_price_minor: 10000,
  })
  expect(purchasePrice(product, 'CNY')).toBe(10000)
  expect(purchasePrice(product, 'KZT')).toBeNull()
  expect(purchasePrice(product, 'USD')).toBeNull()
  expect(purchasePrice(makeProduct({ last_cost: 12345 }), 'KZT')).toBe(12345)
})
