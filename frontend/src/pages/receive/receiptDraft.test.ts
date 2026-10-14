import { describe, expect, it } from 'vitest'

import { createReceiptDraft, parseReceiptDraft, receiptBody } from './receiptDraft'

const oldDraft = {
  version: 1,
  lines: [{ productId: 7, qty: 3, cost: '123,45' }],
  supplier: 'Supplier',
  note: 'Note',
  receivedAt: '2026-01-01T10:00',
  extrasOpen: true,
}

describe('receipt draft keys', () => {
  it('upgrades version 1 without losing unfinished work', () => {
    const draft = parseReceiptDraft(oldDraft)
    expect(draft).toEqual({ ...oldDraft, version: 2, requestId: expect.any(String) })
    expect(draft?.requestId).toMatch(/^[a-f0-9-]{36}$/)
    expect(parseReceiptDraft(draft)).toEqual(draft)
  })

  it('creates a different key for each new draft and sends it', () => {
    const first = createReceiptDraft()
    const second = createReceiptDraft()
    expect(first.requestId).not.toBe(second.requestId)
    first.lines = oldDraft.lines
    expect(receiptBody(first)).toMatchObject({
      request_id: first.requestId,
      lines: [{ product_id: 7, qty: 3, unit_cost: 12345 }],
    })
  })
})
